import { Queue, Worker } from "bullmq";
import type { Job } from "bullmq";
import "./loadEnv";
import { loadWorkerConfig } from "./config";
import type { WorkerConfig } from "./config";
import { LiveAppBundler } from "./build";
import { ConvexRuntimeClient } from "./convex";
import {
  processPendingArtifactPurgeTask,
  processJobById,
  pollPendingJob,
  reclaimStaleRunningJobs,
  syncAppTemplateSourceStatuses,
} from "./jobs";
import { R2Uploader } from "./r2";

function queueJobId(jobId: string): string {
  return `job-${jobId.replace(/:/g, "-")}`;
}

async function enqueuePendingJob(
  config: WorkerConfig,
  queue: Queue,
  pendingJobId: string,
): Promise<void> {
  const jobId = queueJobId(pendingJobId);
  const existing = await queue.getJob(jobId);
  if (existing) {
    const existingState = await existing.getState();
    if (existingState === "completed" || existingState === "failed") {
      await existing.remove();
    } else {
      return;
    }
  }

  await queue.add(
    "process-job",
    { jobId: pendingJobId },
    {
      jobId,
      attempts: config.queueAttempts,
      backoff: {
        type: "fixed",
        delay: config.queueBackoffMs,
      },
      removeOnComplete: true,
      removeOnFail: false,
    },
  );
}

async function shutdown({
  queue,
  worker,
  bundler,
}: {
  queue: Queue;
  worker: Worker;
  bundler: LiveAppBundler;
}) {
  await worker.close();
  await queue.close();
  await bundler.dispose();
}

async function main(): Promise<void> {
  const config = loadWorkerConfig();

  console.log(
    `[worker] ready for multi-app processing with agent command '${config.agentCommand}', model ${config.agentModel ?? "default"}, project root '${config.projectRoot}', and ${config.agentTimeoutMs}ms agent timeout`,
  );

  const convex = new ConvexRuntimeClient(config);
  const bundler = new LiveAppBundler(config);
  const uploader = new R2Uploader(config);

  const queue = new Queue(config.queueName, {
    connection: {
      url: config.redisUrl,
    },
  });

  const worker = new Worker(
    config.queueName,
    async (job: Job<{ jobId: string }>) => {
      const jobId = typeof job.data?.jobId === "string" ? job.data.jobId : null;
      if (!jobId) {
        return;
      }

      try {
        const startedAt = Date.now();
        const started = await processJobById(config, convex, bundler, uploader, jobId);
        if (!started) {
          console.log(`[worker] queue job ${job.id} skipped for job ${jobId} (already claimed)`);
          return;
        }
        console.log(
          `[worker] queue job ${job.id} completed for job ${jobId} in ${Date.now() - startedAt}ms`,
        );
      } catch (error) {
        console.error(
          `[worker] queue job ${job.id} crashed for job ${jobId}`,
          error instanceof Error ? error.message : String(error),
        );
        const currentJob = await convex.getJob(jobId).catch(() => null);
        await convex.recordBuildFailure({
          appId: currentJob?.appId ?? config.appId,
          jobId,
          buildLog:
            error instanceof Error
              ? `Queue worker crashed during processing: ${error.stack ?? error.message}`
              : `Queue worker crashed during processing: ${String(error)}`,
        });
        throw error;
      }
    },
    {
      connection: {
        url: config.redisUrl,
      },
      concurrency: config.queueConcurrency,
      autorun: true,
    },
  );

  worker.on("failed", (job: Job | undefined, error: Error) => {
    console.error(
      `[worker] queue job ${job?.id} failed`,
      error instanceof Error ? error.message : String(error),
    );
  });

  worker.on("error", (error: Error) => {
    console.error("[worker] bullmq error", error instanceof Error ? error.message : String(error));
  });

  let isPolling = false;
  const pollAndQueue = async () => {
    if (isPolling) {
      return;
    }
    isPolling = true;
    try {
      await processPendingArtifactPurgeTask(convex, uploader);
      await syncAppTemplateSourceStatuses(config, convex);
      await reclaimStaleRunningJobs(config, convex);
      const pendingJobId = await pollPendingJob(convex);
      if (!pendingJobId) {
        return;
      }

      await enqueuePendingJob(config, queue, pendingJobId);
    } catch (error) {
      console.error(
        "[worker] polling cycle failed",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      isPolling = false;
    }
  };

  const pollHandle = setInterval(() => {
    void pollAndQueue();
  }, config.pollIntervalMs);
  await pollAndQueue();

  const shutdownIfRunning = async () => {
    clearInterval(pollHandle);
    await shutdown({ queue, worker, bundler });
    process.exit(0);
  };

  process.on("SIGINT", shutdownIfRunning);
  process.on("SIGTERM", shutdownIfRunning);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
