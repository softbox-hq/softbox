import type { AgentCliConfig, AgentObservation } from "./agent";
import { buildBoxId, inferProviderFromModel, type BoxPolicy, type BoxStatus } from "./boxes";
import type { WorkerConfig } from "./config";
import type { AppConfigRecord, ConvexRuntimeClient } from "./convex";
import {
  buildConfiguredOpenClawAgentId,
  buildOpenClawBoxPolicy,
  normalizeOpenClawModelId,
} from "./openClawAgents";

export type BoxEngineContext = {
  boxId: string;
  subjectId: string;
  subjectKind: string;
  appId: string | null;
  engine: string;
  agentId: string | null;
  targetPath: string | null;
  workspacePath: string | null;
  sessionId: string | null;
  provider: string | null;
  model: string | null;
  policy: BoxPolicy;
  rewriteConfigPatch: Pick<AgentCliConfig, "openClaw">;
};

export type BoxRunUpdate = {
  status: BoxStatus;
  agentId?: string | null;
  sessionId?: string | null;
  model?: string | null;
  provider?: string | null;
  lastRunAt?: number | null;
  lastError?: string | null;
};

export function resolveBoxEngineContext(args: {
  config: WorkerConfig;
  appId: string;
  liveAppRoot: string;
  appConfig: AppConfigRecord;
}): BoxEngineContext | null {
  const { config, appId, liveAppRoot, appConfig } = args;

  if (
    !config.openClawGatewayBaseUrl ||
    !config.openClawGatewayToken ||
    (!config.openClawAgentId && !config.openClawAgentIdPrefix)
  ) {
    return null;
  }

  const agentId = buildConfiguredOpenClawAgentId(appId, {
    agentId: config.openClawAgentId ?? null,
    agentIdPrefix: config.openClawAgentIdPrefix ?? null,
  });
  const policy = buildOpenClawBoxPolicy({
    agentId: config.openClawAgentId ?? null,
    agentIdPrefix: config.openClawAgentIdPrefix ?? null,
    sessionKeyPrefix: config.openClawSessionKeyPrefix,
  });
  const workspacePath =
    policy.routingMode === "per_app"
      ? liveAppRoot
      : policy.routingMode === "shared"
        ? config.projectRoot
        : null;
  const model = normalizeOpenClawModelId(config.agentModel ?? null);

  return {
    boxId: buildBoxId("openclaw", appId),
    subjectId: appId,
    subjectKind: "app",
    appId,
    engine: "openclaw",
    agentId,
    targetPath: workspacePath,
    workspacePath,
    sessionId: appConfig.openClawSessionId ?? null,
    provider: inferProviderFromModel(model),
    model,
    policy,
    rewriteConfigPatch: {
      openClaw: {
        baseUrl: config.openClawGatewayBaseUrl,
        token: config.openClawGatewayToken,
        agentId: config.openClawAgentId ?? null,
        agentIdPrefix: config.openClawAgentIdPrefix ?? null,
        sessionKeyPrefix: config.openClawSessionKeyPrefix,
      },
    },
  };
}

export function buildBoxUpsertArgs(
  context: BoxEngineContext,
  update: BoxRunUpdate,
): {
  boxId: string;
  subjectId: string;
  subjectKind: string;
  appId?: string | null;
  engine: string;
  agentId?: string | null;
  targetPath?: string | null;
  workspacePath?: string | null;
  sessionId?: string | null;
  provider?: string | null;
  model: string | null;
  status: BoxStatus;
  policy: BoxPolicy;
  lastRunAt?: number | null;
  lastError?: string | null;
} {
  return {
    boxId: context.boxId,
    subjectId: context.subjectId,
    subjectKind: context.subjectKind,
    appId: context.appId,
    engine: context.engine,
    agentId:
      Object.prototype.hasOwnProperty.call(update, "agentId")
        ? (update.agentId ?? null)
        : context.agentId,
    targetPath: context.targetPath,
    workspacePath: context.workspacePath,
    sessionId:
      Object.prototype.hasOwnProperty.call(update, "sessionId")
        ? (update.sessionId ?? null)
        : context.sessionId,
    provider:
      Object.prototype.hasOwnProperty.call(update, "provider")
        ? (update.provider ?? null)
        : context.provider,
    model:
      Object.prototype.hasOwnProperty.call(update, "model")
        ? (update.model ?? null)
        : context.model,
    status: update.status,
    policy: context.policy,
    lastRunAt: update.lastRunAt,
    lastError:
      Object.prototype.hasOwnProperty.call(update, "lastError")
        ? (update.lastError ?? null)
        : undefined,
  };
}

export async function persistBoxRunUpdate(
  convex: ConvexRuntimeClient,
  context: BoxEngineContext | null,
  update: BoxRunUpdate,
): Promise<void> {
  if (!context) {
    return;
  }

  await convex.upsertBox(buildBoxUpsertArgs(context, update));
}

export async function persistBoxEngineSession(
  convex: ConvexRuntimeClient,
  context: BoxEngineContext | null,
  sessionId: string | null | undefined,
): Promise<void> {
  if (!context || context.engine !== "openclaw") {
    return;
  }

  if (sessionId === null || sessionId === undefined || sessionId === context.sessionId) {
    return;
  }

  await convex.setAppOpenClawSession({
    appId: context.subjectId,
    sessionId,
  });
}

export function buildSuccessfulBoxRunUpdate(args: {
  context: BoxEngineContext;
  observation: Pick<AgentObservation, "agentId" | "model">;
  sessionId: string | null;
}): BoxRunUpdate {
  const normalizedModel = normalizeOpenClawModelId(args.observation.model);
  return {
    status: "ready",
    agentId: args.observation.agentId ?? args.context.agentId,
    sessionId: args.sessionId ?? args.context.sessionId,
    provider: inferProviderFromModel(normalizedModel),
    model: normalizedModel,
    lastRunAt: Date.now(),
    lastError: null,
  };
}

export function buildFailedBoxRunUpdate(
  context: BoxEngineContext,
  message: string,
): BoxRunUpdate {
  return {
    status: "error",
    agentId: context.agentId,
    sessionId: context.sessionId,
    provider: context.provider,
    model: context.model,
    lastRunAt: Date.now(),
    lastError: message,
  };
}
