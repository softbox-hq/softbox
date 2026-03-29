import { describe, expect, it } from "vitest";
import {
  buildAgentArgs,
  buildCodexThreadOptions,
  buildClaudePrompt,
  buildOpenClawSessionKey,
  countSourceBytes,
  diffEditedSourceFiles,
  extractOpenClawResponseText,
  getCodexThreadKey,
  selectLikelyTargetFiles,
  summarizeClaudeOutput,
} from "../src/agent";

describe("buildClaudePrompt", () => {
  it("points the agent at the template AGENTS.md and only includes the user request", () => {
    const prompt = buildClaudePrompt({
      prompt: "Move object D to the bottom left",
      files: [{ path: "src/objects.ts", content: "export const objects = [];" }],
      liveAppLabel: "live-app-template",
      liveAppInstructionsPath: "apps/vite-default/AGENTS.md",
      latestBuildError: null,
      latestRuntimeError: null,
      currentState: null,
      primaryTargetFiles: ["src/objects.ts"],
    });

    expect(prompt).toContain("Move object D to the bottom left");
    expect(prompt).toContain("Read apps/vite-default/AGENTS.md");
    expect(prompt).not.toContain("live-app-template/src/");
    expect(prompt).not.toContain("Current editable files");
  });
});

describe("selectLikelyTargetFiles", () => {
  it("targets scene-related files for threejs prompts", () => {
    expect(
      selectLikelyTargetFiles(
        "move the cube and adjust the camera",
        [
          { path: "src/app.tsx", content: "" },
          { path: "src/scene.tsx", content: "" },
          { path: "src/defaultState.ts", content: "" },
          { path: "src/objects.ts", content: "" },
        ],
        "live-app-template",
      ),
    ).toEqual([
      "src/app.tsx",
      "src/defaultState.ts",
      "src/objects.ts",
      "src/scene.tsx",
    ]);
  });

  it("targets layout files for crm prompts", () => {
    expect(
      selectLikelyTargetFiles(
        "change the table layout and button style",
        [
          { path: "src/app.tsx", content: "" },
          { path: "src/styles.css", content: "" },
          { path: "src/defaultState.ts", content: "" },
        ],
        "live-app-template-crm",
      ),
    ).toEqual([
      "src/app.tsx",
      "src/defaultState.ts",
      "src/styles.css",
    ]);
  });
});

describe("countSourceBytes", () => {
  it("sums utf8 byte length across files", () => {
    expect(
      countSourceBytes([
        { path: "src/a.ts", content: "abc" },
        { path: "src/b.ts", content: "12345" },
      ]),
    ).toBe(8);
  });
});

describe("buildAgentArgs", () => {
  it("runs Claude-compatible args with editing tools from the project root", () => {
    expect(
      buildAgentArgs(
        {
          appId: "app-1",
          command: "claude",
          timeoutMs: 1000,
          projectRoot: "/tmp/project",
          liveAppRoot: "/tmp/project/live-app-template",
          liveAppLabel: "live-app-template",
        },
        "prompt",
      ),
    ).toEqual([
      "-p",
      "prompt",
      "--no-session-persistence",
      "--dangerously-skip-permissions",
      "--tools",
      "Read,Glob,Grep,Edit,Write,Bash",
    ]);
  });

});

describe("buildCodexThreadOptions", () => {
  it("matches the SDK thread configuration used for Codex runs", () => {
    expect(
      buildCodexThreadOptions({
        appId: "app-1",
        command: "codex",
        model: "gpt-5.4-mini",
        timeoutMs: 1000,
        projectRoot: "/tmp/project",
        liveAppRoot: "/tmp/project/live-app-template",
        liveAppLabel: "live-app-template",
      }),
    ).toEqual({
      model: "gpt-5.4-mini",
      sandboxMode: "workspace-write",
      workingDirectory: "/tmp/project",
      skipGitRepoCheck: true,
      approvalPolicy: "never",
      networkAccessEnabled: true,
      additionalDirectories: ["/tmp/project/live-app-template"],
    });
  });
});

describe("getCodexThreadKey", () => {
  it("uses the app identity so apps on the same template do not share a thread", () => {
    expect(
      getCodexThreadKey({
        appId: "app-1",
        projectRoot: "/tmp/project",
        liveAppRoot: "/tmp/project/live-app-template",
      }),
    ).not.toBe(
      getCodexThreadKey({
        appId: "app-2",
        projectRoot: "/tmp/project",
        liveAppRoot: "/tmp/project/live-app-template",
      }),
    );
  });
});

describe("buildOpenClawSessionKey", () => {
  it("creates a deterministic per-app session key", () => {
    expect(
      buildOpenClawSessionKey({
        appId: "softbox",
        openClaw: {
          agentId: "softbox",
          sessionKeyPrefix: "softbox",
        },
      }),
    ).toBe("agent:softbox:softbox");
  });
});

describe("extractOpenClawResponseText", () => {
  it("extracts assistant text from an OpenClaw gateway agent payload", () => {
    expect(
      extractOpenClawResponseText({
        runId: "run_123",
        result: {
          payloads: [
            {
              text: "Updated the dashboard layout.",
              mediaUrl: null,
            },
          ],
          meta: {
            agentMeta: {
              sessionId: "session_123",
              model: "gpt-5.4",
            },
          },
        },
      }),
    ).toBe("Updated the dashboard layout.");
  });

  it("extracts assistant text from a standard responses payload", () => {
    expect(
      extractOpenClawResponseText({
        id: "resp_123",
        output: [
          {
            type: "message",
            role: "assistant",
            content: [
              { type: "output_text", text: "Updated the dashboard layout." },
            ],
          },
        ],
      }),
    ).toBe("Updated the dashboard layout.");
  });

  it("prefers top-level output_text when present", () => {
    expect(
      extractOpenClawResponseText({
        output_text: "Changed the app shell wrapper.",
        output: [],
      }),
    ).toBe("Changed the app shell wrapper.");
  });
});

describe("summarizeClaudeOutput", () => {
  it("builds a structured UI payload from plain-text Claude output and the diff", () => {
    expect(
      summarizeClaudeOutput(
        "Moved object A to the center.\n\nKept the mount contract intact.",
        ["src/objects.ts"],
      ),
    ).toEqual({
      summary: "Moved object A to the center.",
      changed_files: ["live-app-template/src/objects.ts"],
      notes: "Moved object A to the center.\n\nKept the mount contract intact.",
    });
  });

  it("falls back to a generated summary when Claude prints nothing", () => {
    expect(
      summarizeClaudeOutput("", ["src/objects.ts", "src/scene.tsx"]),
    ).toEqual({
      summary: "Agent updated 2 file(s) in live-app-template/src.",
      changed_files: [
        "live-app-template/src/objects.ts",
        "live-app-template/src/scene.tsx",
      ],
    });
  });
});

describe("diffEditedSourceFiles", () => {
  it("returns changed and newly created src files", () => {
    expect(
      diffEditedSourceFiles(
        [{ path: "src/objects.ts", content: "old" }],
        [
          { path: "src/objects.ts", content: "new" },
          { path: "src/scene.tsx", content: "created" },
        ],
      ),
    ).toEqual({
      writtenFiles: [
        { path: "src/objects.ts", content: "new" },
        { path: "src/scene.tsx", content: "created" },
      ],
      deletedPaths: [],
    });
  });

  it("tracks deleted files", () => {
    expect(
      diffEditedSourceFiles(
        [{ path: "src/objects.ts", content: "old" }],
        [],
      ),
    ).toEqual({
      writtenFiles: [],
      deletedPaths: ["src/objects.ts"],
    });
  });
});
