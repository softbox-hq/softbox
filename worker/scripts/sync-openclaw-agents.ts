import "../src/loadEnv";
import { resolve } from "node:path";
import { loadWorkerConfig } from "../src/config";
import { ConvexRuntimeClient } from "../src/convex";
import {
  buildConfiguredOpenClawAgentId,
  createOpenClawAgent,
  deleteOpenClawAgent,
  isPerAppOpenClawRouting,
  listOpenClawAgents,
  normalizeOpenClawModelId,
} from "../src/openClawAgents";
import { discoverWrappedApps } from "../src/templates";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const config = loadWorkerConfig();
  const convex = new ConvexRuntimeClient(config);
  const expectedModel = normalizeOpenClawModelId(config.agentModel ?? null);

  if (!config.openClawAgentIdPrefix) {
    throw new Error(
      "Per-app OpenClaw mode is not enabled. Set OPENCLAW_AGENT_ID_PREFIX to something like 'softbox-' before syncing agents.",
    );
  }

  if (
    !isPerAppOpenClawRouting({
      agentIdPrefix: config.openClawAgentIdPrefix,
    })
  ) {
    throw new Error("OPENCLAW_AGENT_ID_PREFIX is empty.");
  }

  const discovery = discoverWrappedApps(config.projectRoot);
  if (discovery.apps.length === 0) {
    throw new Error("No wrapped apps found under /apps.");
  }

  const existingAgents = await listOpenClawAgents({
    command: config.agentCommand,
    projectRoot: config.projectRoot,
  });
  let createdCount = 0;
  let hasConflict = false;

  for (const app of discovery.apps) {
    const agentId = buildConfiguredOpenClawAgentId(app.appId, {
      agentIdPrefix: config.openClawAgentIdPrefix,
      agentId: config.openClawAgentId ?? null,
    });
    const expectedWorkspace = resolve(app.root);
    const existingAgent = existingAgents.find((agent) => agent.id === agentId);

    if (existingAgent) {
      const hasWorkspaceMismatch = existingAgent.workspace !== expectedWorkspace;
      const hasModelMismatch =
        expectedModel !== null && existingAgent.model !== expectedModel;

      if (hasWorkspaceMismatch || hasModelMismatch) {
        const reasons = [
          hasWorkspaceMismatch
            ? `workspace is '${existingAgent.workspace ?? "unknown"}', expected '${expectedWorkspace}'`
            : null,
          hasModelMismatch
            ? `model is '${existingAgent.model ?? "unknown"}', expected '${expectedModel}'`
            : null,
        ].filter((value): value is string => Boolean(value));

        if (!apply) {
          hasConflict = true;
          console.error(`[sync-openclaw-agents] conflict ${agentId}: ${reasons.join("; ")}`);
          continue;
        }

        await deleteOpenClawAgent({
          command: config.agentCommand,
          projectRoot: config.projectRoot,
          agentId,
        });
        await createOpenClawAgent({
          command: config.agentCommand,
          projectRoot: config.projectRoot,
          agentId,
          workspace: expectedWorkspace,
          model: config.agentModel,
        });
        await convex.setAppOpenClawSession({
          appId: app.appId,
          sessionId: null,
        });
        createdCount += 1;
        console.log(
          `[sync-openclaw-agents] repaired ${agentId} -> ${expectedWorkspace}${expectedModel ? ` (${expectedModel})` : ""} and cleared stored session`,
        );
      } else {
        console.log(`[sync-openclaw-agents] ok ${agentId} -> ${expectedWorkspace}`);
      }
      continue;
    }

    if (!apply) {
      console.log(
        `[sync-openclaw-agents] missing ${agentId} -> ${expectedWorkspace} (dry run; re-run with --apply to create)`,
      );
      continue;
    }

    await createOpenClawAgent({
      command: config.agentCommand,
      projectRoot: config.projectRoot,
      agentId,
      workspace: expectedWorkspace,
      model: config.agentModel,
    });
    await convex.setAppOpenClawSession({
      appId: app.appId,
      sessionId: null,
    });
    createdCount += 1;
    console.log(
      `[sync-openclaw-agents] created ${agentId} -> ${expectedWorkspace}${expectedModel ? ` (${expectedModel})` : ""} and cleared stored session`,
    );
  }

  if (hasConflict) {
    process.exitCode = 1;
  }

  if (apply) {
    console.log(`[sync-openclaw-agents] created ${createdCount} agent(s)`);
  } else {
    console.log("[sync-openclaw-agents] dry run only");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
