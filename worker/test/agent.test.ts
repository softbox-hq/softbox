import { describe, expect, it } from "vitest";
import {
  buildAgentArgs,
  buildCodexThreadOptions,
  buildClaudePrompt,
  buildOpenClawGatewayArgs,
  buildOpenClawSessionKey,
  countSourceBytes,
  diffEditedSourceFiles,
  extractOpenClawResponseText,
  getCodexThreadKey,
  selectLikelyTargetFiles,
  summarizeClaudeOutput,
} from "../src/agent";
import {
  buildConfiguredOpenClawAgentId,
  normalizeOpenClawModelId,
} from "../src/openClawAgents";

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

  it("includes selected box behavior when a box is targeted", () => {
    const prompt = buildClaudePrompt({
      prompt: "Who are you?",
      files: [{ path: "src/App.tsx", content: "export default function App() { return null; }" }],
      liveAppLabel: "vite-default",
      liveAppInstructionsPath: "apps/vite-default/AGENTS.md",
      latestBuildError: null,
      latestRuntimeError: null,
      currentState: null,
      boxContext: {
        boxId: "openclaw:vite-default:critic",
        engine: "openclaw",
        role: "critic",
        instructions: "Identify yourself as the critic box before doing anything else.",
        readOnly: true,
        proposalOnly: true,
        canPromote: false,
      },
      primaryTargetFiles: ["src/App.tsx"],
    });

    expect(prompt).toContain("box_id: openclaw:vite-default:critic");
    expect(prompt).toContain("role: critic");
    expect(prompt).toContain("read_only: true");
    expect(prompt).toContain("proposal_only: true");
    expect(prompt).toContain("Identify yourself as the critic box");
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

  it("uses the box identity so boxes on the same app do not share a thread", () => {
    expect(
      getCodexThreadKey({
        appId: "vite-default",
        boxId: "openclaw:vite-default:critic",
        projectRoot: "/tmp/project",
        liveAppRoot: "/tmp/project/live-app-template",
      }),
    ).not.toBe(
      getCodexThreadKey({
        appId: "vite-default",
        boxId: "openclaw:vite-default:reviewer",
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

  it("creates a deterministic per-box session key when boxId is provided", () => {
    expect(
      buildOpenClawSessionKey({
        appId: "softbox",
        boxId: "openclaw:softbox:critic",
        openClaw: {
          agentId: "softbox",
          sessionKeyPrefix: "softbox",
        },
      }),
    ).toBe("agent:softbox:openclaw-softbox-critic");
  });

  it("rotates the session key when the session generation increments", () => {
    expect(
      buildOpenClawSessionKey({
        appId: "softbox",
        boxId: "openclaw:softbox:critic",
        openClaw: {
          agentId: "softbox",
          sessionKeyPrefix: "softbox",
          sessionKeyGeneration: 2,
        },
      }),
    ).toBe("agent:softbox:openclaw-softbox-critic:g2");
  });
});

describe("buildOpenClawGatewayArgs", () => {
  const baseConfig = {
    appId: "vite-default",
    command: "openclaw",
    model: "openai-codex/gpt-5.4",
    timeoutMs: 1000,
    projectRoot: "/tmp/project",
    liveAppRoot: "/tmp/project/apps/vite-default",
    liveAppLabel: "vite-default",
    openClaw: {
      baseUrl: "http://127.0.0.1:18789",
      token: "test-token",
      agentIdPrefix: "softbox-demo-",
      sessionKeyPrefix: "softbox",
    },
  };

  it("omits model overrides by default for OpenClaw gateway calls", () => {
    const args = buildOpenClawGatewayArgs(
      baseConfig,
      "prompt",
      "softbox-demo-vite-default",
      "agent:softbox-demo-vite-default:vite-default",
      null,
    );
    const params = JSON.parse(args[args.indexOf("--params") + 1]);

    expect(params.model).toBeUndefined();
  });

  it("includes model overrides only when explicitly enabled", () => {
    const args = buildOpenClawGatewayArgs(
      {
        ...baseConfig,
        openClaw: {
          ...baseConfig.openClaw,
          allowModelOverrides: true,
        },
      },
      "prompt",
      "softbox-demo-vite-default",
      "agent:softbox-demo-vite-default:vite-default",
      null,
    );
    const params = JSON.parse(args[args.indexOf("--params") + 1]);

    expect(params.model).toBe("openai-codex/gpt-5.4");
  });
});

describe("buildConfiguredOpenClawAgentId", () => {
  it("uses a shared configured agent id when no prefix is set", () => {
    expect(
      buildConfiguredOpenClawAgentId("vite-default", {
        agentId: "softbox",
        agentIdPrefix: null,
      }),
    ).toBe("softbox");
  });

  it("derives a per-app agent id when a prefix is set", () => {
    expect(
      buildConfiguredOpenClawAgentId("vite-default", {
        agentId: "softbox",
        agentIdPrefix: "softbox-",
      }),
    ).toBe("softbox-vite-default");
  });
});

describe("normalizeOpenClawModelId", () => {
  it("prefixes bare gpt models for OpenClaw", () => {
    expect(normalizeOpenClawModelId("gpt-5.4")).toBe("openai-codex/gpt-5.4");
  });

  it("keeps provider-qualified models unchanged", () => {
    expect(normalizeOpenClawModelId("openai-codex/gpt-5.4")).toBe("openai-codex/gpt-5.4");
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
