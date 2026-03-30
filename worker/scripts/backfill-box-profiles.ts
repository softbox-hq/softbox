import "../src/loadEnv";
import { loadWorkerConfig } from "../src/config";
import { ConvexRuntimeClient } from "../src/convex";
import { backfillOpenClawBoxProfiles } from "../src/engineProfiles";

async function main(): Promise<void> {
  const config = loadWorkerConfig();
  const convex = new ConvexRuntimeClient(config);
  const result = await backfillOpenClawBoxProfiles(convex, config);

  if (!result.engineProfileId || !result.providerProfileId) {
    console.log("[backfill-box-profiles] no OpenClaw boxes found");
    return;
  }

  console.log(
    `[backfill-box-profiles] linked ${result.updatedBoxes} OpenClaw box(es) to ${result.engineProfileId} / ${result.providerProfileId}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
