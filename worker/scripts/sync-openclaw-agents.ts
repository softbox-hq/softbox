import "../src/loadEnv";
import { resolve } from "node:path";
import { buildBoxId, inferProviderFromModel } from "../src/boxes";
import { loadWorkerConfig } from "../src/config";
import { ConvexRuntimeClient } from "../src/convex";
import { ensureDefaultOpenClawProfiles } from "../src/engineProfiles";
import {
  buildConfiguredOpenClawAgentId,
  buildOpenClawBoxPolicy,
  createOpenClawAgent,
  deleteOpenClawAgent,
  isPerAppOpenClawRouting,
  listOpenClawAgents,
  normalizeOpenClawModelId,
} from "../src/openClawAgents";
import { discoverWrappedApps } from "../src/templates";

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const config = loadWorkerConfig();
  const convex = new ConvexRuntimeClient(config);
  const expectedModel = normalizeOpenClawModelId(config.agentModel ?? null);
  let defaultProfiles:
    | {
        engineProfileId: string;
        providerProfileId: string;
      }
    | null = null;

  try {
    defaultProfiles = await ensureDefaultOpenClawProfiles(convex, config);
  } catch (error) {
    console.warn(
      `[sync-openclaw-agents] could not persist default OpenClaw profiles in Convex: ${formatError(error)}`,
    );
  }

  if (!config.openClawAgentIdPrefix) {
    throw new Error(
      "Per-app OpenClaw mode is not enabled. Set OPENCLAW_AGENT_ID_PREFIX or leave it blank so Softbox can generate a checkout-scoped prefix automatically.",
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
    let appConfig = null;
    let appConfigError: string | null = null;
    try {
      appConfig = await convex.getAppConfig(app.appId);
    } catch (error) {
      appConfigError = formatError(error);
      console.warn(
        `[sync-openclaw-agents] could not read Convex app config for ${app.appId}: ${appConfigError}`,
      );
    }

    const agentId = buildConfiguredOpenClawAgentId(app.appId, {
      agentIdPrefix: config.openClawAgentIdPrefix,
      agentId: config.openClawAgentId ?? null,
    });
    const expectedWorkspace = resolve(app.root);
    const boxId = buildBoxId("openclaw", app.appId);
    const boxPolicy = buildOpenClawBoxPolicy({
      agentIdPrefix: config.openClawAgentIdPrefix,
      agentId: config.openClawAgentId ?? null,
      sessionKeyPrefix: config.openClawSessionKeyPrefix,
    });
    const existingAgent = existingAgents.find((agent) => agent.id === agentId);
    const canPersistBox = Boolean(appConfig && defaultProfiles);
    const skipBoxUpsertReason = !defaultProfiles
      ? "default OpenClaw engine/provider profiles are not available in Convex yet"
      : appConfigError
        ? "Convex app config is currently unavailable"
        : appConfig
          ? null
          : "no Convex app record exists yet";

    async function clearStoredSession(): Promise<void> {
      try {
        await convex.setAppOpenClawSession({
          appId: app.appId,
          sessionId: null,
        });
      } catch (error) {
        console.warn(
          `[sync-openclaw-agents] could not clear stored OpenClaw session for ${app.appId}: ${formatError(error)}`,
        );
      }
    }

    async function persistBox(sessionId: string | null): Promise<boolean> {
      if (!canPersistBox || !defaultProfiles) {
        return false;
      }

      try {
        await convex.upsertBox({
          boxId,
          subjectId: app.appId,
          subjectKind: "app",
          appId: app.appId,
          engine: "openclaw",
          engineProfileId: defaultProfiles.engineProfileId,
          providerProfileId: defaultProfiles.providerProfileId,
          agentId,
          targetPath: expectedWorkspace,
          workspacePath: expectedWorkspace,
          sessionId,
          provider: inferProviderFromModel(expectedModel ?? existingAgent?.model ?? null),
          model: expectedModel ?? existingAgent?.model ?? null,
          status: "ready",
          policy: boxPolicy,
          lastError: null,
        });
        return true;
      } catch (error) {
        console.warn(
          `[sync-openclaw-agents] could not upsert box ${boxId}: ${formatError(error)}`,
        );
        return false;
      }
    }

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
        await clearStoredSession();
        const boxPersisted = await persistBox(null);
        createdCount += 1;
        console.log(
          `[sync-openclaw-agents] repaired ${agentId} -> ${expectedWorkspace}${expectedModel ? ` (${expectedModel})` : ""} and cleared stored session`,
        );
        if (!boxPersisted && skipBoxUpsertReason) {
          console.log(
            `[sync-openclaw-agents] skipped box upsert for ${app.appId}; ${skipBoxUpsertReason}`,
          );
        }
      } else {
        const boxPersisted = apply ? await persistBox(appConfig?.openClawSessionId ?? null) : false;
        console.log(`[sync-openclaw-agents] ok ${agentId} -> ${expectedWorkspace}`);
        if (apply && !boxPersisted && skipBoxUpsertReason) {
          console.log(
            `[sync-openclaw-agents] skipped box upsert for ${app.appId}; ${skipBoxUpsertReason}`,
          );
        }
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
    await clearStoredSession();
    const boxPersisted = await persistBox(null);
    createdCount += 1;
    console.log(
      `[sync-openclaw-agents] created ${agentId} -> ${expectedWorkspace}${expectedModel ? ` (${expectedModel})` : ""} and cleared stored session`,
    );
    if (!boxPersisted && skipBoxUpsertReason) {
      console.log(
        `[sync-openclaw-agents] skipped box upsert for ${app.appId}; ${skipBoxUpsertReason}`,
      );
    }
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
