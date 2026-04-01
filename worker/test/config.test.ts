import { describe, expect, it } from "vitest";
import { parseS3ApiUrl } from "../src/config";

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
