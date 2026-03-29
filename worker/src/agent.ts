import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { basename, join, relative } from "node:path";
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
  liveAppInstructionsPath?: string;
  latestBuildError: string | null;
  latestRuntimeError: string | null;
  currentState: LiveAppState | null;
  codexThreadId?: string | null;
  openClawSessionId?: string | null;
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
  openClaw?: {
    baseUrl: string;
    token: string;
    agentId: string;
    sessionKeyPrefix: string;
  };
};

export type CodexThreadState = {
  threadId: string | null;
  openClawSessionId?: string | null;
};

export type AgentRunMode = "codex_sdk" | "openclaw_ws" | "cli";

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
  sessionKey: string | null;
  sessionId: string | null;
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

function isOpenClawCommand(command: string): boolean {
  return basename(command).toLowerCase().startsWith("openclaw");
}

export function getCodexThreadKey(config: Pick<AgentCliConfig, "appId" | "projectRoot" | "liveAppRoot">): string {
  return [
    config.appId,
    config.projectRoot,
    config.liveAppRoot,
  ].join("\u0000");
}

export function buildOpenClawSessionKey(
  config: Pick<AgentCliConfig, "appId"> & {
    openClaw: {
      agentId: string;
      sessionKeyPrefix: string;
    };
  },
): string {
  const agentId = normalizeOpenClawSessionSegment(config.openClaw.agentId);
  const prefix = normalizeOpenClawSessionSegment(config.openClaw.sessionKeyPrefix);
  const appId = normalizeOpenClawSessionSegment(config.appId);
  const restSegments = [
    prefix !== agentId ? prefix : null,
    appId,
  ].filter((value): value is string => Boolean(value));
  return `agent:${agentId}:${restSegments.join(":")}`;
}

function normalizeOpenClawSessionSegment(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "main"
  );
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
  const instructionsPath =
    request.liveAppInstructionsPath ?? `${request.liveAppLabel}/AGENTS.md`;
  const sections = [
    `Read ${instructionsPath} before making changes.`,
    `User request:\n${request.prompt}`,
  ];

  if (request.primaryTargetFiles?.length) {
    sections.push(
      `Likely files to inspect first:\n${request.primaryTargetFiles.join("\n")}`,
    );
  }

  return sections.join("\n\n");
}

function buildLiveAppInstructionsPath(projectRoot: string, liveAppRoot: string): string {
  return `${relative(projectRoot, liveAppRoot).replaceAll("\\", "/") || "."}/AGENTS.md`;
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
    `- session_key: ${observation.sessionKey ?? "n/a"}`,
    `- session_id: ${observation.sessionId ?? "n/a"}`,
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
      summary: `Agent updated ${scopedChangedPaths.length} file(s) in ${liveAppLabel}/src.`,
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

function extractTextFromOpenClawMessageContent(content: unknown): string[] {
  if (!Array.isArray(content)) {
    return [];
  }

  const text: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") {
      continue;
    }
    const candidate = part as {
      type?: unknown;
      text?: unknown;
    };
    if (
      (candidate.type === "output_text" || candidate.type === "text") &&
      typeof candidate.text === "string"
    ) {
      text.push(candidate.text);
    }
  }
  return text;
}

function extractTextFromOpenClawGatewayPayloads(payloads: unknown): string[] {
  if (!Array.isArray(payloads)) {
    return [];
  }

  const text: string[] = [];
  for (const payload of payloads) {
    if (!payload || typeof payload !== "object") {
      continue;
    }
    const candidate = payload as {
      text?: unknown;
      type?: unknown;
      content?: unknown;
    };
    if (typeof candidate.text === "string" && candidate.text.trim()) {
      text.push(candidate.text.trim());
      continue;
    }
    if (candidate.type === "message") {
      text.push(...extractTextFromOpenClawMessageContent(candidate.content));
    }
  }

  return text;
}

export function extractOpenClawResponseText(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const candidate = payload as {
    result?: unknown;
    output_text?: unknown;
    output?: unknown;
    response?: unknown;
  };

  if (candidate.result && typeof candidate.result === "object") {
    const result = candidate.result as {
      payloads?: unknown;
    };
    const gatewayText = extractTextFromOpenClawGatewayPayloads(result.payloads);
    if (gatewayText.length > 0) {
      return gatewayText.join("\n\n").trim();
    }
  }

  if (typeof candidate.output_text === "string" && candidate.output_text.trim()) {
    return candidate.output_text.trim();
  }

  if (candidate.response && typeof candidate.response === "object") {
    const nested = extractOpenClawResponseText(candidate.response);
    if (nested) {
      return nested;
    }
  }

  if (!Array.isArray(candidate.output)) {
    return "";
  }

  const collected: string[] = [];
  for (const item of candidate.output) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const message = item as {
      type?: unknown;
      text?: unknown;
      content?: unknown;
    };
    if (typeof message.text === "string" && message.text.trim()) {
      collected.push(message.text.trim());
      continue;
    }
    if (message.type === "message") {
      collected.push(...extractTextFromOpenClawMessageContent(message.content));
    }
  }

  return collected.join("\n\n").trim();
}

function extractOpenClawSessionId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const result = (payload as { result?: unknown }).result;
  if (!result || typeof result !== "object") {
    return null;
  }

  const meta = (result as { meta?: unknown }).meta;
  if (!meta || typeof meta !== "object") {
    return null;
  }

  const agentMeta = (meta as { agentMeta?: unknown }).agentMeta;
  if (
    agentMeta &&
    typeof agentMeta === "object" &&
    typeof (agentMeta as { sessionId?: unknown }).sessionId === "string"
  ) {
    return (agentMeta as { sessionId: string }).sessionId;
  }

  const report = (meta as { systemPromptReport?: unknown }).systemPromptReport;
  if (
    report &&
    typeof report === "object" &&
    typeof (report as { sessionId?: unknown }).sessionId === "string"
  ) {
    return (report as { sessionId: string }).sessionId;
  }

  return null;
}

function extractOpenClawSessionKey(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const result = (payload as { result?: unknown }).result;
  if (!result || typeof result !== "object") {
    return null;
  }

  const meta = (result as { meta?: unknown }).meta;
  if (!meta || typeof meta !== "object") {
    return null;
  }

  const report = (meta as { systemPromptReport?: unknown }).systemPromptReport;
  if (
    report &&
    typeof report === "object" &&
    typeof (report as { sessionKey?: unknown }).sessionKey === "string"
  ) {
    return (report as { sessionKey: string }).sessionKey;
  }

  return null;
}

function extractOpenClawModel(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const result = (payload as { result?: unknown }).result;
  if (!result || typeof result !== "object") {
    return null;
  }

  const meta = (result as { meta?: unknown }).meta;
  if (!meta || typeof meta !== "object") {
    return null;
  }

  const agentMeta = (meta as { agentMeta?: unknown }).agentMeta;
  if (
    agentMeta &&
    typeof agentMeta === "object" &&
    typeof (agentMeta as { model?: unknown }).model === "string"
  ) {
    return (agentMeta as { model: string }).model;
  }

  const report = (meta as { systemPromptReport?: unknown }).systemPromptReport;
  if (
    report &&
    typeof report === "object" &&
    typeof (report as { model?: unknown }).model === "string"
  ) {
    return (report as { model: string }).model;
  }

  return null;
}

function normalizeOpenClawGatewayUrl(baseUrl: string): string {
  const raw = baseUrl.trim();
  const url = new URL(raw.includes("://") ? raw : `ws://${raw}`);
  if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol === "https:") {
    url.protocol = "wss:";
  }
  return url.toString().replace(/\/$/, "");
}

function buildOpenClawGatewayArgs(
  config: AgentCliConfig,
  prompt: string,
  sessionKey: string,
  sessionId: string | null,
): string[] {
  if (!config.openClaw) {
    throw new Error(
      "OpenClaw command selected, but OpenClaw gateway settings are missing. Set OPENCLAW_GATEWAY_BASE_URL, OPENCLAW_GATEWAY_TOKEN, and OPENCLAW_AGENT_ID.",
    );
  }

  const params: Record<string, unknown> = {
    message: prompt,
    agentId: config.openClaw.agentId,
    sessionKey,
    timeout: Math.max(1, Math.ceil(config.timeoutMs / 1000)),
    idempotencyKey: `softbox-${config.appId}-${randomUUID()}`,
  };

  if (sessionId) {
    params.sessionId = sessionId;
  }

  if (config.model) {
    params.model = config.model;
  }

  return [
    "gateway",
    "call",
    "agent",
    "--expect-final",
    "--json",
    "--url",
    normalizeOpenClawGatewayUrl(config.openClaw.baseUrl),
    "--token",
    config.openClaw.token,
    "--timeout",
    String(Math.max(10_000, config.timeoutMs + 30_000)),
    "--params",
    JSON.stringify(params),
  ];
}

type AgentExecutionResult = {
  stdout: string;
  stderr: string;
  metrics: AgentRunMetrics;
  codexThreadId: string | null;
  openClawSessionId: string | null;
  sessionKey: string | null;
  model: string | null;
};

async function runOpenClawGateway(
  config: AgentCliConfig,
  prompt: string,
  sessionState?: CodexThreadState | null,
): Promise<AgentExecutionResult> {
  if (!config.openClaw) {
    throw new Error(
      "OpenClaw command selected, but OpenClaw gateway settings are missing. Set OPENCLAW_GATEWAY_BASE_URL, OPENCLAW_GATEWAY_TOKEN, and OPENCLAW_AGENT_ID.",
    );
  }

  const sessionKey = buildOpenClawSessionKey({
    appId: config.appId,
    openClaw: {
      agentId: config.openClaw.agentId,
      sessionKeyPrefix: config.openClaw.sessionKeyPrefix,
    },
  });
  const args = buildOpenClawGatewayArgs(
    config,
    prompt,
    sessionKey,
    sessionState?.openClawSessionId ?? null,
  );
  const startedAt = performance.now();

  console.log(
    `[worker] invoking OpenClaw gateway agent over WS with ${args.length} args`,
  );

  return await new Promise<AgentExecutionResult>((resolve, reject) => {
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
      reject(
        new Error(
          `OpenClaw gateway run timed out after ${config.timeoutMs}ms. Check the gateway, agent workspace, and timeout settings.`,
        ),
      );
    }, config.timeoutMs + 30_000);

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
          `Failed to start OpenClaw gateway command '${config.command}': ${error.message}`,
        ),
      );
    });

    child.on("close", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);

      if (code !== 0) {
        reject(
          new Error(
            [
              `OpenClaw gateway command exited with ${signal ? `signal ${signal}` : `code ${code}`}.`,
              stderr.trim() ? `stderr:\n${stderr.trim()}` : "",
              stdout.trim() ? `stdout:\n${stdout.trim()}` : "",
            ]
              .filter(Boolean)
              .join("\n\n"),
          ),
        );
        return;
      }

      let payload: unknown = null;
      try {
        payload = stdout.trim() ? JSON.parse(stdout) : null;
      } catch (error) {
        reject(
          new Error(
            `OpenClaw gateway returned non-JSON output: ${error instanceof Error ? error.message : "Unknown parse error"}`,
          ),
        );
        return;
      }

      const openClawSessionId = extractOpenClawSessionId(payload);
      if (!openClawSessionId) {
        reject(
          new Error(
            "OpenClaw gateway returned no session id for the agent run.",
          ),
        );
        return;
      }

      if (
        sessionState?.openClawSessionId &&
        openClawSessionId !== sessionState.openClawSessionId
      ) {
        reject(
          new Error(
            `OpenClaw gateway returned session ${openClawSessionId} while resuming ${sessionState.openClawSessionId}.`,
          ),
        );
        return;
      }

      resolve({
        stdout: extractOpenClawResponseText(payload),
        stderr,
        codexThreadId: null,
        openClawSessionId,
        sessionKey: extractOpenClawSessionKey(payload) ?? sessionKey,
        model: extractOpenClawModel(payload) ?? config.model ?? null,
        metrics: {
          mode: "openclaw_ws",
          reusedThread: sessionState?.openClawSessionId ? true : false,
          argsCount: args.length,
          stdoutChars: extractOpenClawResponseText(payload).length,
          stderrChars: stderr.length,
          runMs: performance.now() - startedAt,
        },
      });
    });
  });
}

async function runAgentCli(
  config: AgentCliConfig,
  prompt: string,
): Promise<AgentExecutionResult> {
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

    return await new Promise<AgentExecutionResult>(
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
              codexThreadId: null,
              openClawSessionId: null,
              sessionKey: null,
              model: config.model ?? null,
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
): Promise<AgentExecutionResult> {
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
      codexThreadId: thread.id,
      openClawSessionId: null,
      sessionKey: null,
      model: config.model ?? null,
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
): Promise<AgentExecutionResult> {
  if (isCodexCommand(config.command)) {
    return runCodexSdk(config, prompt, threadState);
  }

  if (isOpenClawCommand(config.command)) {
    return runOpenClawGateway(config, prompt, threadState);
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
  openClawSessionId: string | null;
  files: SourceFile[];
  deletedPaths: string[];
  allFiles: SourceFile[];
}> {
  const totalStartedAt = performance.now();
  const buildPromptStartedAt = performance.now();
  const prompt = buildClaudePrompt({
    ...request,
    liveAppInstructionsPath: buildLiveAppInstructionsPath(
      config.projectRoot,
      config.liveAppRoot,
    ),
  });
  const buildPromptMs = performance.now() - buildPromptStartedAt;
  const result = await runAgent(config, prompt, {
    threadId: request.codexThreadId ?? null,
    openClawSessionId: request.openClawSessionId ?? null,
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
    model: result.model ?? config.model ?? null,
    command: config.command,
    thread:
      result.metrics.reusedThread === null
        ? "n/a"
        : result.metrics.reusedThread
          ? "reused"
          : "new",
    sessionKey: result.sessionKey,
    sessionId: result.openClawSessionId,
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
        "Agent made no source-file changes for this request.",
      details: {
        ...details,
        changed_files: [],
        notes:
          details.notes ??
          [
            `Agent completed without changing ${config.liveAppLabel}/src files.`,
            result.stdout.trim() ? `stdout:\n${result.stdout.trim()}` : "",
            result.stderr.trim() ? `stderr:\n${result.stderr.trim()}` : "",
          ]
            .filter(Boolean)
            .join("\n\n"),
      },
      observation,
      codexThreadId: result.codexThreadId,
      openClawSessionId: result.openClawSessionId,
      files: [],
      deletedPaths: [],
      allFiles: nextFiles,
    };
  }

  return {
    summary:
      details.summary.trim() ||
      `Agent changed ${changedPaths.length} file(s)`,
    details,
    observation,
    codexThreadId: result.codexThreadId,
    openClawSessionId: result.openClawSessionId,
    files: diff.writtenFiles,
    deletedPaths: diff.deletedPaths,
    allFiles: nextFiles,
  };
}
