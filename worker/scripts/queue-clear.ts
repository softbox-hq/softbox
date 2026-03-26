import { Queue } from "bullmq";
import { loadWorkerConfig } from "../src/config";

async function main(): Promise<void> {
  const config = loadWorkerConfig();
  const queue = new Queue(config.queueName, {
    connection: {
      url: config.redisUrl,
    },
  });

  const before = await queue.getJobCounts("wait", "active", "completed", "failed", "delayed", "paused");
  console.log("[queue] state before clear", before);

  await queue.obliterate({ force: true });
  const after = await queue.getJobCounts("wait", "active", "completed", "failed", "delayed", "paused");
  console.log("[queue] state after clear", after);

  await queue.close();
  console.log("[queue] cleared");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
