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
import { backfillOpenClawBoxProfiles } from "./engineProfiles";
import { R2Uploader } from "./r2";

function queueJobId(jobId: string): string {
  return `job-${jobId.replace(/:/g, "-")}`;
}

function parseRedisTarget(redisUrl: string): { host: string; port: number } | null {
  try {
    const parsed = new URL(redisUrl);
    return {
      host: parsed.hostname || "127.0.0.1",
      port: parsed.port ? Number(parsed.port) : 6379,
    };
  } catch {
    return null;
  }
}

function isLocalRedisTarget(redisUrl: string): boolean {
  const target = parseRedisTarget(redisUrl);
  if (!target) {
    return false;
  }
  return target.host === "127.0.0.1" || target.host === "localhost" || target.host === "::1";
}

function isRedisConnectionRefused(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("ECONNREFUSED");
}

function logRedisConnectionHelpOnce(
  config: WorkerConfig,
  error: unknown,
  state: { shown: boolean },
) : boolean {
  if (!isRedisConnectionRefused(error)) {
    return false;
  }

  if (state.shown) {
    return true;
  }

  state.shown = true;

  if (isLocalRedisTarget(config.redisUrl)) {
    console.error("[worker] REDIS IS NOT STARTED. START WITH FOLLOWING COMMAND: docker compose up -d redis");
    return true;
  }

  console.error(`[worker] Redis is not reachable at ${config.redisUrl}. Check REDIS_URL or start that Redis instance.`);
  return true;
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
  const redisHelpState = { shown: false };

  try {
    const profileBackfill = await backfillOpenClawBoxProfiles(convex, config);
    if (profileBackfill.updatedBoxes > 0) {
      console.log(
        `[worker] backfilled ${profileBackfill.updatedBoxes} OpenClaw box profile link(s) using ${profileBackfill.engineProfileId} / ${profileBackfill.providerProfileId}`,
      );
    }
  } catch (error) {
    console.warn(
      "[worker] failed to backfill OpenClaw box profiles",
      error instanceof Error ? error.message : String(error),
    );
  }

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
    if (logRedisConnectionHelpOnce(config, error, redisHelpState)) {
      return;
    }
    console.error(
      `[worker] queue job ${job?.id} failed`,
      error instanceof Error ? error.message : String(error),
    );
  });

  worker.on("error", (error: Error) => {
    if (logRedisConnectionHelpOnce(config, error, redisHelpState)) {
      return;
    }
    console.error("[worker] bullmq error", error instanceof Error ? error.message : String(error));
  });

  queue.on("error", (error: Error) => {
    if (logRedisConnectionHelpOnce(config, error, redisHelpState)) {
      return;
    }
    console.error("[worker] queue connection error", error instanceof Error ? error.message : String(error));
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
      if (logRedisConnectionHelpOnce(config, error, redisHelpState)) {
        return;
      }
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
