import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { Codex, type ThreadOptions } from "@openai/codex-sdk";
import type { LiveAppState } from "./shared/liveApp";
import {
  normalizeSourcePath,
  readLiveAppFiles,
  type SourceFile,
} from "./filesystem";

const editableClaudeTools = "Read,Glob,Grep,Edit,Write,Bash";
const codexThreads = new Map<string, ReturnType<Codex["startThread"]>>();

export type ClaudeStructuredOutput = {
  summary: string;
  changed_files: string[];
  notes?: string;
};

export type SourceFileDiff = {
  writtenFiles: SourceFile[];
  deletedPaths: string[];
};

export type RewriteRequest = {
  prompt: string;
  files: SourceFile[];
  liveAppLabel: string;
  latestBuildError: string | null;
  latestRuntimeError: string | null;
  currentState: LiveAppState | null;
  codexThreadId?: string | null;
  primaryTargetFiles?: string[];
};

export type AgentCliConfig = {
  appId: string;
  command: string;
  model?: string;
  timeoutMs: number;
  projectRoot: string;
  liveAppRoot: string;
  liveAppLabel: string;
};

export type CodexThreadState = {
  threadId: string | null;
};

export type AgentRunMode = "codex_sdk" | "cli";

export type AgentRunMetrics = {
  mode: AgentRunMode;
  reusedThread: boolean | null;
  argsCount: number | null;
  stdoutChars: number;
  stderrChars: number;
  runMs: number;
};

export type AgentObservation = {
  mode: AgentRunMode;
  model: string | null;
  command: string;
  thread: "reused" | "new" | "n/a";
  timeoutMs: number;
  requestChars: number;
  promptChars: number;
  editableFiles: number;
  sourceBytes: number;
  likelyTargetFiles: string[];
  timings: {
    buildPromptMs: number;
    agentRunMs: number;
    rereadFilesMs: number;
    diffMs: number;
    summarizeMs: number;
    totalRewriteMs: number;
  };
  output: {
    stdoutChars: number;
    stderrChars: number;
    changedPaths: number;
    writtenFiles: number;
    deletedPaths: number;
    changedPreview: string[];
  };
};

function isCodexCommand(command: string): boolean {
  return basename(command).toLowerCase().startsWith("codex");
}

export function getCodexThreadKey(config: Pick<AgentCliConfig, "appId" | "projectRoot" | "liveAppRoot">): string {
  return [
    config.appId,
    config.projectRoot,
    config.liveAppRoot,
  ].join("\u0000");
}

export function buildCodexThreadOptions(
  config: AgentCliConfig,
): ThreadOptions {
  return {
    model: config.model,
    sandboxMode: "workspace-write",
    workingDirectory: config.projectRoot,
    skipGitRepoCheck: true,
    approvalPolicy: "never",
    networkAccessEnabled: true,
    additionalDirectories: [config.liveAppRoot],
  };
}

export function buildAgentArgs(
  config: AgentCliConfig,
  prompt: string,
  outputFile?: string,
): string[] {
  if (isCodexCommand(config.command)) {
    const args = [
      "exec",
      "--sandbox",
      "workspace-write",
      "--skip-git-repo-check",
      "--color",
      "never",
      "--cd",
      config.projectRoot,
    ];

    if (outputFile) {
      args.push("--output-last-message", outputFile);
    }

    if (config.model) {
      args.push("--model", config.model);
    }

    args.push(prompt);
    return args;
  }

  const args = [
    "-p",
    prompt,
    "--no-session-persistence",
    "--dangerously-skip-permissions",
    "--tools",
    editableClaudeTools,
  ];

  if (config.model) {
    args.push("--model", config.model);
  }

  return args;
}

export function selectLikelyTargetFiles(
  prompt: string,
  files: SourceFile[],
  liveAppLabel: string,
): string[] {
  const normalizedPrompt = prompt.toLowerCase();
  const available = new Set(files.map((file) => file.path));
  const availableByLowercasePath = new Map(
    files.map((file) => [file.path.toLowerCase(), file.path]),
  );
  const targets = new Set<string>();

  const add = (...paths: string[]) => {
    for (const path of paths) {
      const resolved =
        available.has(path) ? path : availableByLowercasePath.get(path.toLowerCase());
      if (resolved) {
        targets.add(resolved);
      }
    }
  };

  const looksLikeCrm = liveAppLabel.includes("crm");
  const looksLikeStandaloneVite =
    available.has("src/App.tsx") ||
    available.has("src/main.tsx") ||
    available.has("src/App.jsx") ||
    available.has("src/main.jsx");

  if (looksLikeCrm) {
    add("src/app.tsx", "src/styles.css", "src/defaultState.ts", "src/types.ts");
    if (
      /\b(css|style|layout|card|table|button|panel|modal|drawer|spacing|color|font)\b/.test(
        normalizedPrompt,
      )
    ) {
      add("src/app.tsx", "src/styles.css");
    }
    if (
      /\b(data|deal|contact|customer|lead|pipeline|record|csv)\b/.test(
        normalizedPrompt,
      )
    ) {
      add("src/defaultState.ts", "src/types.ts", "src/app.tsx");
    }
  } else if (looksLikeStandaloneVite) {
    add(
      "src/App.tsx",
      "src/App.css",
      "src/index.css",
      "src/defaultState.ts",
      "src/sqlite.ts",
      "src/types.ts",
    );
    if (
      /\b(button|click|show|list|render|display|table|card|panel|modal|input|form|counter)\b/.test(
        normalizedPrompt,
      )
    ) {
      add("src/App.tsx", "src/App.css", "src/index.css");
    }
    if (
      /\b(sqlite|db|database|customer|customers|lead|leads|prospect|prospects|record|records|seed|query)\b/.test(
        normalizedPrompt,
      )
    ) {
      add("src/sqlite.ts", "src/App.tsx");
    }
    if (/\b(state|default|initial|shell|adapter)\b/.test(normalizedPrompt)) {
      add("src/defaultState.ts", "src/types.ts", "src/adapter/AppShell.tsx");
    }
  } else {
    add(
      "src/app.tsx",
      "src/scene.tsx",
      "src/defaultState.ts",
      "src/objects.ts",
      "src/styles.css",
    );
    if (
      /\b(camera|grid|plane|scene|canvas|orbit|pan|zoom|rotate|three|object|cube|sphere|torus|mesh|position|rotation|scale|color)\b/.test(
        normalizedPrompt,
      )
    ) {
      add(
        "src/scene.tsx",
        "src/defaultState.ts",
        "src/objects.ts",
        "src/app.tsx",
      );
    }
    if (/\b(style|label|css|font|ui)\b/.test(normalizedPrompt)) {
      add("src/styles.css", "src/scene.tsx", "src/app.tsx");
    }
    if (/\b(state|default|initial|seed|reset)\b/.test(normalizedPrompt)) {
      add("src/defaultState.ts", "src/app.tsx", "src/objects.ts");
    }
  }

  if (targets.size === 0) {
    return files.slice(0, Math.min(4, files.length)).map((file) => file.path);
  }

  return [...targets].sort((left, right) => left.localeCompare(right));
}

export function countSourceBytes(files: SourceFile[]): number {
  return files.reduce(
    (sum, file) => sum + Buffer.byteLength(file.content, "utf8"),
    0,
  );
}

export function buildClaudePrompt(request: RewriteRequest): string {
  const sections = [
    `Read ${request.liveAppLabel}/AGENTS.md before making changes.`,
    `User request:\n${request.prompt}`,
  ];

  if (request.primaryTargetFiles?.length) {
    sections.push(
      `Likely files to inspect first:\n${request.primaryTargetFiles.join("\n")}`,
    );
  }

  return sections.join("\n\n");
}

function formatMs(value: number): string {
  return `${value.toFixed(1)}ms`;
}

export function buildAgentStageStartDetail(args: {
  command: string;
  model?: string;
  timeoutMs: number;
  requestChars: number;
  editableFiles: number;
  sourceBytes: number;
  likelyTargetFiles: string[];
}): string {
  return [
    "starting agent rewrite",
    `- command: ${args.command}`,
    `- model: ${args.model ?? "default"}`,
    `- timeout_ms: ${args.timeoutMs}`,
    `- request_chars: ${args.requestChars}`,
    `- editable_files: ${args.editableFiles}`,
    `- source_bytes: ${args.sourceBytes}`,
    `- likely_targets: ${args.likelyTargetFiles.join(", ") || "none inferred"}`,
  ].join("\n");
}

export function formatAgentObservation(observation: AgentObservation): string {
  return [
    "agent observation",
    `- mode: ${observation.mode}`,
    `- command: ${observation.command}`,
    `- model: ${observation.model ?? "default"}`,
    `- thread: ${observation.thread}`,
    `- timeout_ms: ${observation.timeoutMs}`,
    `- request_chars: ${observation.requestChars}`,
    `- prompt_chars: ${observation.promptChars}`,
    `- editable_files: ${observation.editableFiles}`,
    `- source_bytes: ${observation.sourceBytes}`,
    `- likely_targets: ${observation.likelyTargetFiles.join(", ") || "none inferred"}`,
    "- timing:",
    `  build_prompt: ${formatMs(observation.timings.buildPromptMs)}`,
    `  agent_turn: ${formatMs(observation.timings.agentRunMs)}`,
    `  reread_files: ${formatMs(observation.timings.rereadFilesMs)}`,
    `  diff: ${formatMs(observation.timings.diffMs)}`,
    `  summarize: ${formatMs(observation.timings.summarizeMs)}`,
    `  total_rewrite: ${formatMs(observation.timings.totalRewriteMs)}`,
    "- output:",
    `  stdout_chars: ${observation.output.stdoutChars}`,
    `  stderr_chars: ${observation.output.stderrChars}`,
    `  changed_paths: ${observation.output.changedPaths}`,
    `  written_files: ${observation.output.writtenFiles}`,
    `  deleted_paths: ${observation.output.deletedPaths}`,
    `  changed_preview: ${observation.output.changedPreview.join(", ") || "none"}`,
  ].join("\n");
}

export function diffEditedSourceFiles(
  beforeFiles: SourceFile[],
  afterFiles: SourceFile[],
): SourceFileDiff {
  const beforeByPath = new Map(
    beforeFiles.map((file) => [file.path, file.content]),
  );
  const afterByPath = new Map(
    afterFiles.map((file) => [file.path, file.content]),
  );

  const deletedPaths = beforeFiles
    .filter((file) => !afterByPath.has(file.path))
    .map((file) => file.path)
    .sort((left, right) => left.localeCompare(right));

  const writtenFiles = afterFiles
    .filter((file) => beforeByPath.get(file.path) !== file.content)
    .map((file) => ({
      path: normalizeSourcePath(file.path),
      content: file.content,
    }));

  return {
    writtenFiles,
    deletedPaths,
  };
}

export function summarizeClaudeOutput(
  stdout: string,
  changedPaths: string[],
  liveAppLabel = "live-app-template",
): ClaudeStructuredOutput {
  const cleaned = stdout.trim();
  const scopedChangedPaths = changedPaths.map(
    (path) => `${liveAppLabel}/${path}`,
  );

  if (!cleaned) {
    return {
      summary: `Claude updated ${scopedChangedPaths.length} file(s) in ${liveAppLabel}/src.`,
      changed_files: scopedChangedPaths,
    };
  }

  const firstParagraph = cleaned.split(/\n\s*\n/u)[0] ?? cleaned;
  const firstUsefulLine =
    firstParagraph
      .split("\n")
      .map((line) => line.replace(/^[-*]\s+/, "").trim())
      .find(Boolean) ?? cleaned;
  const summary =
    firstUsefulLine.length > 240
      ? `${firstUsefulLine.slice(0, 237)}...`
      : firstUsefulLine;

  return {
    summary,
    changed_files: scopedChangedPaths,
    notes: cleaned === summary ? undefined : cleaned,
  };
}

async function runAgentCli(
  config: AgentCliConfig,
  prompt: string,
): Promise<{ stdout: string; stderr: string; metrics: AgentRunMetrics; threadId: string | null }> {
  let tempDir: string | null = null;
  let outputFile: string | undefined;

  if (isCodexCommand(config.command)) {
    tempDir = await mkdtemp(join(tmpdir(), "codex-exec-"));
    outputFile = join(tempDir, "last-message.txt");
  }

  try {
    const args = buildAgentArgs(config, prompt, outputFile);
    console.log(
      `[worker] invoking agent command ${config.command} with ${args.length} args`,
    );
    const startedAt = performance.now();

    return await new Promise<{ stdout: string; stderr: string; metrics: AgentRunMetrics; threadId: string | null }>(
      (resolve, reject) => {
        const child = spawn(config.command, args, {
          cwd: config.projectRoot,
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";
        let settled = false;

        const timer = setTimeout(() => {
          if (settled) {
            return;
          }
          settled = true;
          child.kill("SIGTERM");
          reject(new Error(`Agent CLI timed out after ${config.timeoutMs}ms`));
        }, config.timeoutMs);

        child.stdout.on("data", (chunk) => {
          stdout += String(chunk);
        });
        child.stderr.on("data", (chunk) => {
          stderr += String(chunk);
        });

        child.on("error", (error) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          reject(
            new Error(
              `Failed to start agent command '${config.command}': ${error.message}`,
            ),
          );
        });

        child.on("close", async (code, signal) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);

          if (code === 0) {
            let finalStdout = stdout;
            if (outputFile) {
              try {
                finalStdout = await readFile(outputFile, "utf8");
              } catch {
                finalStdout = stdout;
              }
            }
            resolve({
              stdout: finalStdout,
              stderr,
              threadId: null,
              metrics: {
                mode: "cli",
                reusedThread: null,
                argsCount: args.length,
                stdoutChars: finalStdout.length,
                stderrChars: stderr.length,
                runMs: performance.now() - startedAt,
              },
            });
            return;
          }

          reject(
            new Error(
              [
                `Agent CLI exited with ${signal ? `signal ${signal}` : `code ${code}`}.`,
                stderr.trim() ? `stderr:\n${stderr.trim()}` : "",
                stdout.trim() ? `stdout:\n${stdout.trim()}` : "",
              ]
                .filter(Boolean)
                .join("\n\n"),
            ),
          );
        });
      },
    );
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  }
}

async function runCodexSdk(
  config: AgentCliConfig,
  prompt: string,
  threadState?: CodexThreadState | null,
): Promise<{ stdout: string; stderr: string; metrics: AgentRunMetrics; threadId: string | null }> {
  const threadKey = getCodexThreadKey(config);
  let thread = codexThreads.get(threadKey);
  let reusedThread = true;

  if (!thread) {
    const codex = new Codex({
      codexPathOverride: config.command,
      env: process.env as Record<string, string>,
    });
    if (threadState?.threadId) {
      thread = codex.resumeThread(threadState.threadId, buildCodexThreadOptions(config));
    } else {
      reusedThread = false;
      thread = codex.startThread(buildCodexThreadOptions(config));
    }
    codexThreads.set(threadKey, thread);
  }

  console.log(
    `[worker] invoking Codex SDK thread (${reusedThread ? "reused" : "new"})`,
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const startedAt = performance.now();

  try {
    const turn = await thread.run(prompt, { signal: controller.signal });
    return {
      stdout: turn.finalResponse,
      stderr: "",
      threadId: thread.id,
      metrics: {
        mode: "codex_sdk",
        reusedThread,
        argsCount: null,
        stdoutChars: turn.finalResponse.length,
        stderrChars: 0,
        runMs: performance.now() - startedAt,
      },
    };
  } catch (error) {
    codexThreads.delete(threadKey);
    if (controller.signal.aborted) {
      throw new Error(
        `Codex SDK run timed out after ${config.timeoutMs}ms. The worker sent a short prompt and workspace access, then aborted the run when the agent did not finish in time.`,
      );
    }
    const message =
      error instanceof Error ? error.message : "Unknown Codex SDK error";
    throw new Error(
      threadState?.threadId
        ? `Codex SDK failed while resuming thread ${threadState.threadId}: ${message}`
        : `Codex SDK run failed: ${message}`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function runAgent(
  config: AgentCliConfig,
  prompt: string,
  threadState?: CodexThreadState | null,
): Promise<{ stdout: string; stderr: string; metrics: AgentRunMetrics; threadId: string | null }> {
  if (isCodexCommand(config.command)) {
    return runCodexSdk(config, prompt, threadState);
  }

  return runAgentCli(config, prompt);
}

export async function rewriteLiveAppFiles(
  config: AgentCliConfig,
  request: RewriteRequest,
): Promise<{
  summary: string;
  details: ClaudeStructuredOutput;
  observation: AgentObservation;
  codexThreadId: string | null;
  files: SourceFile[];
  deletedPaths: string[];
  allFiles: SourceFile[];
}> {
  const totalStartedAt = performance.now();
  const buildPromptStartedAt = performance.now();
  const prompt = buildClaudePrompt(request);
  const buildPromptMs = performance.now() - buildPromptStartedAt;
  const result = await runAgent(config, prompt, {
    threadId: request.codexThreadId ?? null,
  });
  const rereadStartedAt = performance.now();
  const nextFiles = await readLiveAppFiles(config.liveAppRoot);
  const rereadFilesMs = performance.now() - rereadStartedAt;
  const diffStartedAt = performance.now();
  const diff = diffEditedSourceFiles(request.files, nextFiles);
  const diffMs = performance.now() - diffStartedAt;
  const changedPaths = [
    ...diff.writtenFiles.map((file) => file.path),
    ...diff.deletedPaths,
  ].sort((left, right) => left.localeCompare(right));
  const summarizeStartedAt = performance.now();
  const details = summarizeClaudeOutput(
    result.stdout,
    changedPaths,
    config.liveAppLabel,
  );
  const summarizeMs = performance.now() - summarizeStartedAt;
  const observation: AgentObservation = {
    mode: result.metrics.mode,
    model: config.model ?? null,
    command: config.command,
    thread:
      result.metrics.reusedThread === null
        ? "n/a"
        : result.metrics.reusedThread
          ? "reused"
          : "new",
    timeoutMs: config.timeoutMs,
    requestChars: request.prompt.trim().length,
    promptChars: prompt.length,
    editableFiles: request.files.length,
    sourceBytes: countSourceBytes(request.files),
    likelyTargetFiles: request.primaryTargetFiles ?? [],
    timings: {
      buildPromptMs,
      agentRunMs: result.metrics.runMs,
      rereadFilesMs,
      diffMs,
      summarizeMs,
      totalRewriteMs: performance.now() - totalStartedAt,
    },
    output: {
      stdoutChars: result.metrics.stdoutChars,
      stderrChars: result.metrics.stderrChars,
      changedPaths: changedPaths.length,
      writtenFiles: diff.writtenFiles.length,
      deletedPaths: diff.deletedPaths.length,
      changedPreview: changedPaths.slice(0, 8),
    },
  };

  if (changedPaths.length === 0) {
    return {
      summary:
        details.summary.trim() ||
        "Claude Code made no source-file changes for this request.",
      details: {
        ...details,
        changed_files: [],
        notes:
          details.notes ??
          [
            `Claude Code completed without changing ${config.liveAppLabel}/src files.`,
            result.stdout.trim() ? `stdout:\n${result.stdout.trim()}` : "",
            result.stderr.trim() ? `stderr:\n${result.stderr.trim()}` : "",
          ]
            .filter(Boolean)
            .join("\n\n"),
      },
      observation,
      codexThreadId: result.threadId,
      files: [],
      deletedPaths: [],
      allFiles: nextFiles,
    };
  }

  return {
    summary:
      details.summary.trim() ||
      `Claude Code changed ${changedPaths.length} file(s)`,
    details,
    observation,
    codexThreadId: result.threadId,
    files: diff.writtenFiles,
    deletedPaths: diff.deletedPaths,
    allFiles: nextFiles,
  };
}
