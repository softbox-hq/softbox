import { describe, expect, it } from "vitest";
import { getLatestAgentResult, getRuntimeStatus, parseStateJson } from "./state";

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
