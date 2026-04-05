import { describe, expect, it } from "vitest";
import {
  getLatestAgentResult,
  getRuntimeStatus,
  parseStateJson,
  resolveMountedAppId,
} from "./state";

describe("parseStateJson", () => {
  it("parses valid live app state json", () => {
    expect(
      parseStateJson(
        JSON.stringify({
          camera: {
            position: { x: 0, y: 0, z: 8 },
            fov: 50,
          },
          selectedObjectId: "A",
          objects: [
            {
              id: "A",
              label: "A",
              position: { x: 0, y: 0, z: 0 },
              rotation: { x: 0, y: 0, z: 0 },
              scale: { x: 1, y: 1, z: 1 },
              color: "#ffffff",
            },
          ],
        }),
      ),
    ).toEqual({
      camera: {
        position: { x: 0, y: 0, z: 8 },
        fov: 50,
      },
      selectedObjectId: "A",
      objects: [
        {
          id: "A",
          label: "A",
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          color: "#ffffff",
        },
      ],
    });
  });

  it("returns null for invalid json", () => {
    expect(parseStateJson("not json")).toBeNull();
  });
});

describe("getRuntimeStatus", () => {
  it("reports workspace loading when shell state is undefined", () => {
    expect(getRuntimeStatus(undefined)).toEqual({
      title: "Getting things ready",
      body: "Loading the shell workspace and checking for available apps.",
    });
  });

  it("reports runtime errors when present", () => {
    expect(
      getRuntimeStatus({
        activeVersion: { versionNumber: 1 },
        lastRuntimeError: "boom",
      }),
    ).toEqual({
      title: "Runtime Error",
      body: "boom",
    });
  });
});

describe("resolveMountedAppId", () => {
  it("starts with no mounted app when nothing is selected", () => {
    expect(
      resolveMountedAppId(
        [
          { appId: "app-1" },
          { appId: "app-2" },
        ],
        null,
      ),
    ).toBeNull();
  });

  it("mounts the explicitly selected app when it exists", () => {
    expect(
      resolveMountedAppId(
        [
          { appId: "app-1" },
          { appId: "app-2" },
        ],
        { selectedAppId: "app-2" },
      ),
    ).toBe("app-2");
  });

  it("keeps the selected app mounted while the app list is still loading", () => {
    expect(resolveMountedAppId(undefined, { selectedAppId: "app-2" })).toBe("app-2");
  });

  it("keeps the previously mounted app while shell selection is still loading", () => {
    expect(
      resolveMountedAppId(
        [
          { appId: "app-1" },
          { appId: "app-2" },
        ],
        undefined,
        "app-2",
      ),
    ).toBe("app-2");
  });

  it("keeps the selected app mounted across a transient app-list gap", () => {
    expect(
      resolveMountedAppId(
        [{ appId: "app-1" }],
        { selectedAppId: "app-2" },
        "app-2",
      ),
    ).toBe("app-2");
  });

  it("leaves the shell unmounted when the stored app no longer exists", () => {
    expect(
      resolveMountedAppId([{ appId: "app-1" }], { selectedAppId: "app-2" }),
    ).toBeNull();
  });
});

describe("getLatestAgentResult", () => {
  it("prefers the latest completed job result", () => {
    expect(
      getLatestAgentResult({
        latestJob: {
          status: "running",
        },
        latestCompletedJob: {
          agentResult: {
            summary: "Moved A",
            changed_files: ["src/objects.ts"],
          },
        },
        activeVersion: {
          agentResult: {
            summary: "Old result",
            changed_files: ["src/scene.tsx"],
          },
        },
      }),
    ).toEqual({
      summary: "Moved A",
      changed_files: ["src/objects.ts"],
    });
  });

  it("falls back to the active version when no completed job exists", () => {
    expect(
      getLatestAgentResult({
        latestJob: {
          status: "running",
        },
        activeVersion: {
          agentResult: {
            summary: "Old result",
            changed_files: ["src/scene.tsx"],
          },
        },
      }),
    ).toEqual({
      summary: "Old result",
      changed_files: ["src/scene.tsx"],
    });
  });

  it("falls back to the active or ready version when there is no latest job", () => {
    expect(
      getLatestAgentResult({
        nextReadyVersion: {
          agentResult: {
            summary: "Preview result",
            changed_files: ["src/ui.tsx"],
            notes: "Ready to mount.",
          },
        },
      }),
    ).toEqual({
      summary: "Preview result",
      changed_files: ["src/ui.tsx"],
      notes: "Ready to mount.",
    });
  });
});
