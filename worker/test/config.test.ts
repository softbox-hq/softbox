import { describe, expect, it } from "vitest";
import { parseS3ApiUrl } from "../src/config";
import {
  buildCheckoutScopedOpenClawAgentIdPrefix,
  legacyOpenClawAgentIdPrefix,
  resolveOpenClawAgentIdPrefix,
} from "../src/openClawRouting";

describe("parseS3ApiUrl", () => {
  it("extracts the endpoint and bucket from the Cloudflare dashboard S3 API URL", () => {
    expect(
      parseS3ApiUrl("https://example-account.r2.cloudflarestorage.com/live-code-runtime"),
    ).toEqual({
      s3Api: "https://example-account.r2.cloudflarestorage.com/live-code-runtime",
      endpoint: "https://example-account.r2.cloudflarestorage.com",
      bucket: "live-code-runtime",
    });
  });

  it("rejects URLs without exactly one bucket segment", () => {
    expect(() =>
      parseS3ApiUrl("https://example-account.r2.cloudflarestorage.com"),
    ).toThrow(/exactly one bucket path segment/i);

    expect(() =>
      parseS3ApiUrl("https://example-account.r2.cloudflarestorage.com/a/b"),
    ).toThrow(/exactly one bucket path segment/i);
  });
});

describe("resolveOpenClawAgentIdPrefix", () => {
  it("generates a checkout-scoped prefix when the env value is blank", () => {
    const projectRoot = "/tmp/softbox";
    expect(
      resolveOpenClawAgentIdPrefix({
        projectRoot,
        agentId: null,
        agentIdPrefix: "",
      }),
    ).toBe(buildCheckoutScopedOpenClawAgentIdPrefix(projectRoot));
  });

  it("replaces the legacy shared prefix with a checkout-scoped prefix", () => {
    const projectRoot = "/tmp/softbox";
    expect(
      resolveOpenClawAgentIdPrefix({
        projectRoot,
        agentId: null,
        agentIdPrefix: legacyOpenClawAgentIdPrefix,
      }),
    ).toBe(buildCheckoutScopedOpenClawAgentIdPrefix(projectRoot));
  });

  it("keeps an explicit non-legacy per-app prefix unchanged", () => {
    expect(
      resolveOpenClawAgentIdPrefix({
        projectRoot: "/tmp/softbox",
        agentId: null,
        agentIdPrefix: "softbox-demo-",
      }),
    ).toBe("softbox-demo-");
  });

  it("disables per-app prefix generation when a shared agent id is configured", () => {
    expect(
      resolveOpenClawAgentIdPrefix({
        projectRoot: "/tmp/softbox",
        agentId: "shared-agent",
        agentIdPrefix: "",
      }),
    ).toBeUndefined();
  });
});
