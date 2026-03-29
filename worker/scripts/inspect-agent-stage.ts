import "../src/loadEnv";
import { loadWorkerConfig } from "../src/config";
import { ConvexRuntimeClient } from "../src/convex";

function parseArg(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return null;
  }
  return process.argv[index + 1] ?? null;
}

function formatDuration(durationMs: number | null | undefined) {
  if (typeof durationMs !== "number" || Number.isNaN(durationMs)) {
    return "running";
  }
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }
  if (durationMs < 60000) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  }
  return `${Math.floor(durationMs / 60000)}m ${Math.round((durationMs % 60000) / 1000)}s`;
}

async function main(): Promise<void> {
  const config = loadWorkerConfig();
  const appId = parseArg("--app-id") ?? config.appId;
  const convex = new ConvexRuntimeClient(config);
  const shellState = await convex.getShellState(appId);

  if (!shellState?.latestPipelineRun) {
    console.log(`[agent-stage] no pipeline run found for '${appId}'`);
    return;
  }

  const run = shellState.latestPipelineRun;
  const agentStage = (run.stages ?? []).find((stage: any) => stage.key === "agent") ?? null;

  console.log(`[agent-stage] app: ${appId}`);
  console.log(`[agent-stage] run: ${run._id}`);
  console.log(`[agent-stage] prompt: ${run.prompt}`);
  console.log("[agent-stage] stages:");
  for (const stage of run.stages ?? []) {
    console.log(
      `- ${stage.key}: ${stage.status} (${formatDuration(stage.durationMs ?? null)})`,
    );
  }

  if (!agentStage) {
    console.log("[agent-stage] no agent stage found on latest run");
    return;
  }

  console.log("");
  console.log("[agent-stage] detail:");
  console.log(agentStage.detail ?? "(no detail)");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
