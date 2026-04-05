import { describe, expect, it } from "vitest";
import type { WorkerConfig } from "../src/config";
import { backfillOpenClawBoxProfiles } from "../src/engineProfiles";

function buildWorkerConfig(overrides?: Partial<WorkerConfig>): WorkerConfig {
  return {
    convexUrl: "https://example.convex.cloud",
    agentCommand: "openclaw",
    agentModel: "gpt-5.4-mini",
    agentTimeoutMs: 600000,
    redisUrl: "redis://127.0.0.1:6379",
    artifactStorageProvider: "r2",
    artifactStorageLabel: "R2",
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

describe("backfillOpenClawBoxProfiles", () => {
  it("propagates the configured worker model instead of preserving a stale box model", async () => {
    const upsertProviderProfileCalls: any[] = [];
    const upsertBoxCalls: any[] = [];
    const convex = {
      async listBoxes() {
        return [
          {
            boxId: "openclaw:vite-default",
            subjectId: "vite-default",
            subjectKind: "app",
            appId: "vite-default",
            engine: "openclaw",
            engineProfileId: null,
            providerProfileId: null,
            agentId: "softbox-demo-vite-default",
            targetPath: "/tmp/softbox/apps/vite-default",
            workspacePath: "/tmp/softbox/apps/vite-default",
            sessionId: "session_123",
            sessionKeyGeneration: 0,
            provider: "anthropic",
            model: "anthropic/claude-sonnet-4",
            status: "ready",
            policy: {},
            lastRunAt: null,
            lastError: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ];
      },
      async upsertEngineProfile() {
        return undefined;
      },
      async upsertProviderProfile(args: any) {
        upsertProviderProfileCalls.push(args);
      },
      async upsertBox(args: any) {
        upsertBoxCalls.push(args);
      },
    };

    await backfillOpenClawBoxProfiles(
      convex as any,
      buildWorkerConfig({ agentModel: "gpt-5.4-mini" }),
    );

    expect(upsertProviderProfileCalls[0]).toMatchObject({
      model: "openai-codex/gpt-5.4-mini",
      provider: "openai-codex",
    });
    expect(upsertBoxCalls[0]).toMatchObject({
      model: "openai-codex/gpt-5.4-mini",
      provider: "openai-codex",
    });
  });
});
