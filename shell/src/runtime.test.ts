import { describe, expect, it, vi } from "vitest";
import {
  loadManifest,
  shouldLoadCandidateVersion,
} from "./runtime";

const validManifest = {
  version: 2,
  entryUrl: "https://cdn.example.com/apps/demo/v2/entry.js",
  chunkBaseUrl: "https://cdn.example.com/apps/demo/v2/",
  createdAt: Date.now(),
  appId: "demo",
  stateSchemaVersion: 1,
  stateJson: JSON.stringify({
    camera: {
      position: { x: 0, y: 0, z: 0 },
      fov: 45,
    },
    objects: [],
    selectedObjectId: null,
  }),
};

describe("loadManifest", () => {
  it("loads the runtime manifest shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => validManifest,
      }),
    );

    await expect(loadManifest(validManifest.entryUrl)).resolves.toMatchObject({
      appId: "demo",
      version: 2,
    });
  });

  it("rejects malformed manifest payloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ...validManifest, entryUrl: 42 }),
      }),
    );

    await expect(loadManifest(validManifest.entryUrl)).rejects.toThrow();
  });
});

describe("shouldLoadCandidateVersion", () => {
  it("allows a newer candidate version", () => {
    expect(
      shouldLoadCandidateVersion({
        activeVersion: {
          _id: "version-1",
          appId: "demo",
          versionNumber: 1,
          status: "active",
          manifestUrl: "https://cdn.example.com/apps/demo/v1/manifest.json",
          stateJson: validManifest.stateJson,
        },
        nextReadyVersion: {
          _id: "version-2",
          appId: "demo",
          versionNumber: 2,
          status: "ready",
          manifestUrl: "https://cdn.example.com/apps/demo/v2/manifest.json",
          stateJson: validManifest.stateJson,
        },
        previewVersionId: null,
      }),
    ).toBe(true);
  });

  it("skips a candidate already being previewed", () => {
    expect(
      shouldLoadCandidateVersion({
        activeVersion: null,
        nextReadyVersion: {
          _id: "version-2",
          appId: "demo",
          versionNumber: 2,
          status: "ready",
          manifestUrl: "https://cdn.example.com/apps/demo/v2/manifest.json",
          stateJson: validManifest.stateJson,
        },
        previewVersionId: "version-2",
      }),
    ).toBe(false);
  });
});
