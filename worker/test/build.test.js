import { describe, expect, it } from "vitest";
import { artifactKeyForVersion } from "../src/build";
describe("artifactKeyForVersion", () => {
    it("builds versioned artifact keys under apps/{appId}/v{n}", () => {
        expect(artifactKeyForVersion("demo", 45, "entry.js")).toBe("apps/demo/v45/entry.js");
        expect(artifactKeyForVersion("demo", 45, "chunk-7f2a.js")).toBe("apps/demo/v45/chunk-7f2a.js");
        expect(artifactKeyForVersion("demo", 45, "manifest.json")).toBe("apps/demo/v45/manifest.json");
    });
});
