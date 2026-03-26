import { loadWorkerConfig } from "../src/config";
import { ConvexRuntimeClient } from "../src/convex";

async function main(): Promise<void> {
  const config = loadWorkerConfig();
  const convex = new ConvexRuntimeClient(config);

  const shellState = await convex.getShellState(config.appId);
  const latestJob = shellState?.latestJob;
  if (!latestJob) {
    console.log("[recover] no latest job found");
    return;
  }

  if (latestJob.status !== "running") {
    console.log("[recover] latest job is not running:", latestJob.status);
    return;
  }

  await convex.recordBuildFailure({
    appId: config.appId,
    jobId: latestJob._id,
    buildLog: "Manual recovery: force-failed stale running job from operator.",
  });

  console.log("[recover] forced latest running job to failed:", latestJob._id);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
