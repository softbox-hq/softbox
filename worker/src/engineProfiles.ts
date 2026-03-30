import type { BoxPolicy } from "./boxes";
import { inferProviderFromModel } from "./boxes";
import type { WorkerConfig } from "./config";
import type { BoxRecord, ConvexRuntimeClient } from "./convex";
import { normalizeOpenClawModelId } from "./openClawAgents";

export const defaultOpenClawEngineProfileId = "openclaw:default";

function readTrimmed(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized ? normalized : null;
}

function readTrimmedOr(value: string | null | undefined, fallback: string | null) {
  return readTrimmed(value) ?? fallback;
}

function inferSharedValue<T>(values: T[]): T | null {
  if (values.length === 0) {
    return null;
  }
  const first = values[0];
  return values.every((value) => value === first) ? first : null;
}

function inferOpenClawRoutingHints(boxes: BoxRecord[]) {
  const policies = boxes
    .map((box) => box.policy ?? {})
    .filter((policy): policy is BoxPolicy => Boolean(policy));
  const routingMode = inferSharedValue(
    policies
      .map((policy) => readTrimmed(policy.routingMode))
      .filter((value): value is string => Boolean(value)),
  );
  const sessionKeyPrefix = inferSharedValue(
    policies
      .map((policy) => readTrimmed(policy.sessionKeyPrefix))
      .filter((value): value is string => Boolean(value)),
  );
  const appAgentPairs = boxes.filter(
    (box): box is BoxRecord & { appId: string; agentId: string } =>
      Boolean(box.appId && box.agentId),
  );
  const inferredAgentIdPrefix = inferSharedValue(
    appAgentPairs
      .map((box) =>
        box.agentId.endsWith(box.appId) ? box.agentId.slice(0, box.agentId.length - box.appId.length) : null,
      )
      .filter((value): value is string => Boolean(value)),
  );

  return {
    routingMode,
    sessionKeyPrefix,
    agentIdPrefix: inferredAgentIdPrefix,
  };
}

export function buildDefaultOpenClawEngineProfile(
  config: WorkerConfig,
  options?: {
    gatewayBaseUrl?: string | null;
    routingMode?: string | null;
    sessionKeyPrefix?: string | null;
    agentId?: string | null;
    agentIdPrefix?: string | null;
    tokenConfigured?: boolean;
  },
) {
  const gatewayBaseUrl = readTrimmedOr(options?.gatewayBaseUrl, config.openClawGatewayBaseUrl ?? null);
  const routingMode =
    readTrimmed(options?.routingMode) ??
    (config.openClawAgentIdPrefix ? "per_app" : config.openClawAgentId ? "shared" : null);
  const sessionKeyPrefix =
    readTrimmed(options?.sessionKeyPrefix) ?? config.openClawSessionKeyPrefix;
  const agentId = readTrimmedOr(options?.agentId, config.openClawAgentId ?? null);
  const agentIdPrefix = readTrimmedOr(options?.agentIdPrefix, config.openClawAgentIdPrefix ?? null);
  const tokenConfigured = options?.tokenConfigured ?? Boolean(config.openClawGatewayToken);

  return {
    engineProfileId: defaultOpenClawEngineProfileId,
    engine: "openclaw",
    name: "OpenClaw Default",
    description: "Default Softbox OpenClaw engine setup sourced from the worker environment.",
    status:
      gatewayBaseUrl && tokenConfigured
        ? ("ready" as const)
        : ("needs_setup" as const),
    isDefault: true,
    config: {
      gatewayBaseUrl,
      routingMode,
      sessionKeyPrefix,
      agentId,
      agentIdPrefix,
      tokenConfigured,
    },
  };
}

export function buildDefaultProviderProfile(
  config: WorkerConfig,
  options?: {
    model?: string | null;
    provider?: string | null;
  },
) {
  const normalizedModel =
    normalizeOpenClawModelId(options?.model ?? null) ??
    normalizeOpenClawModelId(config.agentModel ?? null);
  const provider =
    readTrimmed(options?.provider) ??
    inferProviderFromModel(normalizedModel) ??
    "openai-codex";
  return {
    providerProfileId: `${provider}:default`,
    engineProfileId: defaultOpenClawEngineProfileId,
    provider,
    name: `${provider} Default`,
    description: "Default provider profile derived from the worker model configuration.",
    model: normalizedModel,
    status: normalizedModel ? ("ready" as const) : ("needs_auth" as const),
    isDefault: true,
    config: {
      authMethod: "external_oauth_or_api_key",
      authTarget: provider,
    },
  };
}

export async function ensureDefaultOpenClawProfiles(
  convex: ConvexRuntimeClient,
  config: WorkerConfig,
): Promise<{
  engineProfileId: string;
  providerProfileId: string;
}> {
  const engineProfile = buildDefaultOpenClawEngineProfile(config);
  const providerProfile = buildDefaultProviderProfile(config);

  await convex.upsertEngineProfile(engineProfile);
  await convex.upsertProviderProfile(providerProfile);

  return {
    engineProfileId: engineProfile.engineProfileId,
    providerProfileId: providerProfile.providerProfileId,
  };
}

export async function backfillOpenClawBoxProfiles(
  convex: ConvexRuntimeClient,
  config: WorkerConfig,
): Promise<{
  engineProfileId: string | null;
  providerProfileId: string | null;
  updatedBoxes: number;
}> {
  const boxes = await convex.listBoxes();
  const openClawBoxes = boxes.filter((box) => box.engine === "openclaw");
  if (openClawBoxes.length === 0) {
    return {
      engineProfileId: null,
      providerProfileId: null,
      updatedBoxes: 0,
    };
  }

  const routingHints = inferOpenClawRoutingHints(openClawBoxes);
  const exemplarBox = openClawBoxes.find((box) => box.model || box.provider) ?? openClawBoxes[0];
  const engineProfile = buildDefaultOpenClawEngineProfile(config, {
    routingMode: routingHints.routingMode,
    sessionKeyPrefix: routingHints.sessionKeyPrefix,
    agentIdPrefix: routingHints.agentIdPrefix,
  });
  const providerProfile = buildDefaultProviderProfile(config, {
    model: exemplarBox?.model ?? null,
    provider: exemplarBox?.provider ?? null,
  });

  await convex.upsertEngineProfile(engineProfile);
  await convex.upsertProviderProfile(providerProfile);

  let updatedBoxes = 0;
  for (const box of openClawBoxes) {
    if (
      box.engineProfileId === engineProfile.engineProfileId &&
      box.providerProfileId === providerProfile.providerProfileId
    ) {
      continue;
    }

    await convex.upsertBox({
      boxId: box.boxId,
      subjectId: box.subjectId,
      subjectKind: box.subjectKind,
      appId: box.appId,
      engine: box.engine,
      engineProfileId: engineProfile.engineProfileId,
      providerProfileId: providerProfile.providerProfileId,
      agentId: box.agentId,
      targetPath: box.targetPath,
      workspacePath: box.workspacePath,
      sessionId: box.sessionId,
      provider: box.provider ?? providerProfile.provider,
      model: box.model ?? providerProfile.model,
      status: box.status,
      policy: box.policy,
      lastRunAt: box.lastRunAt,
      lastError: box.lastError,
    });
    updatedBoxes += 1;
  }

  return {
    engineProfileId: engineProfile.engineProfileId,
    providerProfileId: providerProfile.providerProfileId,
    updatedBoxes,
  };
}

export function resolveOpenClawRouting(args: {
  config: WorkerConfig;
  engineProfile?: {
    config?: {
      gatewayBaseUrl?: string | null;
      routingMode?: string | null;
      sessionKeyPrefix?: string | null;
      agentId?: string | null;
      agentIdPrefix?: string | null;
    };
  } | null;
  providerProfile?: {
    model?: string | null;
    provider?: string | null;
  } | null;
}) {
  return {
    baseUrl: readTrimmed(args.engineProfile?.config?.gatewayBaseUrl) ?? args.config.openClawGatewayBaseUrl,
    token: args.config.openClawGatewayToken,
    agentId: readTrimmed(args.engineProfile?.config?.agentId) ?? args.config.openClawAgentId,
    agentIdPrefix:
      readTrimmed(args.engineProfile?.config?.agentIdPrefix) ?? args.config.openClawAgentIdPrefix,
    sessionKeyPrefix:
      readTrimmed(args.engineProfile?.config?.sessionKeyPrefix) ?? args.config.openClawSessionKeyPrefix,
    routingMode: readTrimmed(args.engineProfile?.config?.routingMode),
    model:
      normalizeOpenClawModelId(args.providerProfile?.model ?? null) ??
      normalizeOpenClawModelId(args.config.agentModel ?? null),
  };
}
