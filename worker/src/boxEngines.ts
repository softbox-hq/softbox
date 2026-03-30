import type { AgentCliConfig, AgentObservation } from "./agent";
import { buildBoxId, inferProviderFromModel, type BoxPolicy, type BoxStatus } from "./boxes";
import type { WorkerConfig } from "./config";
import type {
  AppConfigRecord,
  ConvexRuntimeClient,
  EngineProfileRecord,
  ProviderProfileRecord,
} from "./convex";
import { defaultOpenClawEngineProfileId, resolveOpenClawRouting } from "./engineProfiles";
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
  engineProfileId: string | null;
  providerProfileId: string | null;
  agentId: string | null;
  targetPath: string | null;
  workspacePath: string | null;
  sessionId: string | null;
  provider: string | null;
  model: string | null;
  engineProfile: EngineProfileRecord | null;
  providerProfile: ProviderProfileRecord | null;
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

  const box = appConfig.box ?? null;
  if (!box) {
    return null;
  }
  const primaryBoxId = appConfig.primaryBox?.boxId ?? null;
  const isPrimaryBox = primaryBoxId ? box.boxId === primaryBoxId : true;

  const engineProfile = appConfig.engineProfile ?? null;
  const providerProfile = appConfig.providerProfile ?? null;
  const engine = box.engine ?? engineProfile?.engine ?? "openclaw";
  const defaultPolicy =
    engine === "openclaw"
      ? buildOpenClawBoxPolicy({
          agentId: config.openClawAgentId ?? null,
          agentIdPrefix: config.openClawAgentIdPrefix ?? null,
          sessionKeyPrefix: config.openClawSessionKeyPrefix,
        })
      : {};
  const policy = {
    ...defaultPolicy,
    ...(box.policy ?? {}),
  };
  const workspacePath =
    box.workspacePath ??
    box.targetPath ??
    liveAppRoot;
  const targetPath = box.targetPath ?? workspacePath;
  const model = normalizeOpenClawModelId(
    providerProfile?.model ?? box.model ?? config.agentModel ?? null,
  );
  const context: BoxEngineContext = {
    boxId: box.boxId,
    subjectId: box.subjectId ?? appId,
    subjectKind: box.subjectKind ?? "app",
    appId: box.appId ?? appId,
    engine,
    engineProfileId: box.engineProfileId ?? engineProfile?.engineProfileId ?? null,
    providerProfileId: box.providerProfileId ?? providerProfile?.providerProfileId ?? null,
    agentId: box.agentId ?? null,
    targetPath,
    workspacePath,
    sessionId:
      box.sessionId ??
      (isPrimaryBox
        ? (engine === "openclaw" ? appConfig.openClawSessionId : appConfig.codexThreadId)
        : null) ??
      null,
    provider: box.provider ?? providerProfile?.provider ?? inferProviderFromModel(model),
    model: box.model ?? model,
    engineProfile,
    providerProfile,
    policy,
    rewriteConfigPatch: {},
  };

  if (engine !== "openclaw") {
    return context;
  }

  const routing = resolveOpenClawRouting({
    config,
    engineProfile,
    providerProfile,
  });

  if (!routing.baseUrl || !routing.token || (!routing.agentId && !routing.agentIdPrefix)) {
    return context;
  }

  const agentId = buildConfiguredOpenClawAgentId(appId, {
    agentId: routing.agentId ?? null,
    agentIdPrefix: routing.agentIdPrefix ?? null,
  });
  const routedPolicy = {
    ...buildOpenClawBoxPolicy({
      agentId: routing.agentId ?? null,
      agentIdPrefix: routing.agentIdPrefix ?? null,
      sessionKeyPrefix: routing.sessionKeyPrefix ?? config.openClawSessionKeyPrefix,
    }),
    ...(box.policy ?? {}),
  };
  const routedWorkspacePath =
    box.workspacePath ??
    box.targetPath ??
    ((routing.routingMode ?? routedPolicy.routingMode) === "per_app"
      ? liveAppRoot
      : (routing.routingMode ?? routedPolicy.routingMode) === "shared"
        ? config.projectRoot
        : null);
  const routedModel = normalizeOpenClawModelId(providerProfile?.model ?? box.model ?? routing.model ?? null);

  return {
    boxId: box.boxId ?? buildBoxId("openclaw", appId),
    subjectId: box.subjectId ?? appId,
    subjectKind: box.subjectKind ?? "app",
    appId: box.appId ?? appId,
    engine,
    engineProfileId: box.engineProfileId ?? engineProfile?.engineProfileId ?? defaultOpenClawEngineProfileId,
    providerProfileId: box.providerProfileId ?? providerProfile?.providerProfileId ?? null,
    agentId: box.agentId ?? agentId,
    targetPath: box.targetPath ?? routedWorkspacePath,
    workspacePath: routedWorkspacePath,
    sessionId: box.sessionId ?? (isPrimaryBox ? appConfig.openClawSessionId ?? null : null),
    provider: box.provider ?? providerProfile?.provider ?? inferProviderFromModel(routedModel),
    model: box.model ?? routedModel,
    engineProfile,
    providerProfile,
    policy: routedPolicy,
    rewriteConfigPatch: {
      openClaw: {
        baseUrl: routing.baseUrl,
        token: routing.token,
        agentId: routing.agentId ?? null,
        agentIdPrefix: routing.agentIdPrefix ?? null,
        sessionKeyPrefix: routing.sessionKeyPrefix ?? config.openClawSessionKeyPrefix,
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
  engineProfileId?: string | null;
  providerProfileId?: string | null;
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
    engineProfileId: context.engineProfileId,
    providerProfileId: context.providerProfileId,
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
