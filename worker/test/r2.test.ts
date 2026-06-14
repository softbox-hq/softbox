import { describe, expect, it, vi } from "vitest";
import { R2Uploader } from "../src/r2";
import type { WorkerConfig } from "../src/config";

function buildConfig(overrides?: Partial<WorkerConfig>): WorkerConfig {
  return {
    convexUrl: "https://example.convex.cloud",
    agentCommand: "openclaw",
    agentModel: "gpt-5.4-mini",
    agentTimeoutMs: 120000,
    redisUrl: "redis://127.0.0.1:6379",
    artifactStorageProvider: "minio",
    artifactStorageLabel: "MinIO",
    r2Endpoint: "http://127.0.0.1:9000",
    r2Bucket: "softbox-artifacts",
    r2AccessKeyId: "softbox",
    r2SecretAccessKey: "softboxminio",
    publicDevelopmentUrl: "http://127.0.0.1:9000/softbox-artifacts",
    s3Api: "http://127.0.0.1:9000/softbox-artifacts",
    appId: "demo",
    pollIntervalMs: 1500,
    staleJobTimeoutMs: 1800000,
    queueName: "softbox-jobs",
    queueConcurrency: 1,
    queueAttempts: 2,
    queueBackoffMs: 800,
    r2UploadConcurrency: 2,
    projectRoot: "/tmp/softbox",
    openClawGatewayBaseUrl: "http://127.0.0.1:18789",
    openClawGatewayToken: "token",
    openClawAgentId: undefined,
    openClawAgentIdPrefix: "softbox-",
    openClawSessionKeyPrefix: "softbox",
    openClawAllowModelOverrides: false,
    ...overrides,
  };
}

describe("R2Uploader", () => {
  it("rejects concurrent upload failures without leaking unhandled rejections", async () => {
    const uploader = new R2Uploader(buildConfig());
    const unhandled: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      (uploader as any).objectExists = vi.fn().mockResolvedValue(false);
      (uploader as any).client = {
        send: vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:9000")),
      };

      await expect(
        uploader.uploadArtifacts([
          {
            key: "apps/demo/v1/entry.js",
            body: new Uint8Array([1, 2, 3]),
            contentType: "text/javascript",
          },
          {
            key: "apps/demo/v1/manifest.json",
            body: new Uint8Array([4, 5, 6]),
            contentType: "application/json",
          },
        ]),
      ).rejects.toThrow("ECONNREFUSED");

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }
  });
});
