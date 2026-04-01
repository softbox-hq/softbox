import { describe, expect, it } from "vitest";
import type { WorkerConfig } from "../src/config";
import type { BoxEngineContext } from "../src/boxEngines";
import { buildRewriteAgentConfig } from "../src/jobs";

function buildWorkerConfig(overrides?: Partial<WorkerConfig>): WorkerConfig {
  return {
    convexUrl: "https://example.convex.cloud",
    agentCommand: "openclaw",
    agentModel: "gpt-5.4-mini",
    agentTimeoutMs: 600000,
    redisUrl: "redis://127.0.0.1:6379",
    r2Endpoint: "https://example.r2.cloudflarestorage.com",
    r2Bucket: "softbox-r2",
    r2AccessKeyId: "key",
    r2SecretAccessKey: "secret",
    publicDevelopmentUrl: "https://cdn.example.com",
    s3Api: "https://example.r2.cloudflarestorage.com/softbox-r2",
    appId: "vite-default",
    pollIntervalMs: 1500,
    staleJobTimeoutMs: 120000,
    queueName: "softbox-jobs",
    queueConcurrency: 1,
    queueAttempts: 2,
    queueBackoffMs: 800,
    r2UploadConcurrency: 6,
    projectRoot: "/tmp/softbox",
    openClawGatewayBaseUrl: "http://127.0.0.1:18789",
    openClawGatewayToken: "test-token",
    openClawAgentId: undefined,
    openClawAgentIdPrefix: "softbox-demo-",
    openClawSessionKeyPrefix: "softbox",
    ...overrides,
  };
}

function buildBoxContext(): BoxEngineContext {
  return {
    boxId: "box_123",
    subjectId: "vite-default",
    subjectKind: "app",
    appId: "vite-default",
    engine: "openclaw",
    engineProfileId: "engine_123",
    providerProfileId: null,
    agentId: "box-agent",
    targetPath: "/tmp/softbox/apps/vite-default",
    workspacePath: "/tmp/softbox/apps/vite-default",
    sessionId: null,
    sessionKeyGeneration: 4,
    provider: "openai-codex",
    model: "openai-codex/gpt-5.4-mini",
    engineProfile: null,
    providerProfile: null,
    policy: {},
    rewriteConfigPatch: {
      openClaw: {
        baseUrl: "http://127.0.0.1:19000",
        token: "box-token",
        agentId: "box-agent",
        agentIdPrefix: null,
        sessionKeyPrefix: "box-scope",
        sessionKeyGeneration: 4,
      },
    },
  };
}

describe("buildRewriteAgentConfig", () => {
  it("falls back to repo-level OpenClaw settings when no box routing patch exists", () => {
    const config = buildWorkerConfig();

    const rewriteConfig = buildRewriteAgentConfig({
      config,
      appId: "vite-default",
      selectedBoxId: null,
      liveAppRoot: "/tmp/softbox/apps/vite-default",
      liveAppLabel: "vite-default",
      boxEngineContext: null,
      usesOpenClawSession: true,
    });

    expect(rewriteConfig.openClaw).toEqual({
      baseUrl: "http://127.0.0.1:18789",
      token: "test-token",
      agentId: null,
      agentIdPrefix: "softbox-demo-",
      sessionKeyPrefix: "softbox",
      sessionKeyGeneration: 0,
    });
  });

  it("lets box routing override the repo-level OpenClaw settings", () => {
    const config = buildWorkerConfig();

    const rewriteConfig = buildRewriteAgentConfig({
      config,
      appId: "vite-default",
      selectedBoxId: "box_123",
      liveAppRoot: "/tmp/softbox/apps/vite-default",
      liveAppLabel: "vite-default",
      boxEngineContext: buildBoxContext(),
      usesOpenClawSession: true,
    });

    expect(rewriteConfig.openClaw).toEqual({
      baseUrl: "http://127.0.0.1:19000",
      token: "box-token",
      agentId: "box-agent",
      agentIdPrefix: null,
      sessionKeyPrefix: "box-scope",
      sessionKeyGeneration: 4,
    });
  });
});
