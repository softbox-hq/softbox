import { Queue } from "bullmq";
import { loadWorkerConfig } from "../src/config";
import { ConvexRuntimeClient } from "../src/convex";

async function main(): Promise<void> {
  const config = loadWorkerConfig();
  const convex = new ConvexRuntimeClient(config);
  const queue = new Queue(config.queueName, {
    connection: {
      url: config.redisUrl,
    },
  });

  const shellState = await convex.getShellState(config.appId);
  console.log("[state] latest job:", shellState?.latestJob ?? null);
  console.log("[state] next ready version:", shellState?.nextReadyVersion?.versionNumber ?? null);
  console.log("[state] active version:", shellState?.activeVersion?.versionNumber ?? null);

  const counts = await queue.getJobCounts("wait", "active", "completed", "failed", "delayed", "paused");
  console.log("[queue] counts:", counts);

  const activeJobs = await queue.getJobs(["active"], 0, 20);
  if (activeJobs.length) {
    console.log(
      "[queue] active jobs:",
      activeJobs.map((job) => ({ id: job.id, name: job.name, data: job.data })),
    );
  }

  const waitingJobs = await queue.getJobs(["wait"], 0, 20);
  if (waitingJobs.length) {
    console.log(
      "[queue] waiting jobs:",
      waitingJobs.map((job) => ({ id: job.id, name: job.name, data: job.data })),
    );
  }

  const failedJobs = await queue.getJobs(["failed"], 0, 10);
  if (failedJobs.length) {
    console.log(
      "[queue] failed jobs:",
      failedJobs.map((job) => ({
        id: job.id,
        name: job.name,
        failedReason: job.failedReason,
      })),
    );
  }

  await queue.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
