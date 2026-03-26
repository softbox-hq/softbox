import { describe, expect, it } from "vitest";
import { normalizeSourcePath } from "../src/filesystem";
describe("normalizeSourcePath", () => {
    it("accepts editable src paths", () => {
        expect(normalizeSourcePath("src/scene.tsx")).toBe("src/scene.tsx");
    });
    it("rejects path traversal", () => {
        expect(() => normalizeSourcePath("../secret.ts")).toThrow(/Invalid editable path/);
    });
    it("rejects non-src files", () => {
        expect(() => normalizeSourcePath("package.json")).toThrow(/Invalid editable path/);
    });
});
