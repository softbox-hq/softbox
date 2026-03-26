import { describe, expect, it } from "vitest";
import { manifestKeyForVersion, sharedArtifactKey } from "../src/artifacts";

describe("artifact keys", () => {
  it("builds shared content-addressed bundle keys and versioned manifest keys", () => {
    expect(sharedArtifactKey("demo", "entry-ABC123.js")).toBe(
      "apps/demo/shared/entry-ABC123.js",
    );
    expect(sharedArtifactKey("demo", "chunk-7f2a.js")).toBe(
      "apps/demo/shared/chunk-7f2a.js",
    );
    expect(manifestKeyForVersion("demo", 45)).toBe(
      "apps/demo/v45/manifest.json",
    );
  });
});
