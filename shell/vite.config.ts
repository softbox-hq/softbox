import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { cpus, freemem, hostname, platform, release, totalmem, arch } from "node:os";
import { Socket } from "node:net";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { config as loadEnv, parse as parseDotenv } from "dotenv";
import { systemServices } from "./src/systemServices";
import type {
  OpenClawGatewayRuntime,
  OpenClawOnboardSession,
  OpenClawStatus,
  OpenClawRoutingMode,
} from "./src/openClaw";

loadEnv({ path: resolve(import.meta.dirname, "../.env.local"), quiet: true });
loadEnv({ path: resolve(import.meta.dirname, "../.env"), quiet: true });

const projectRoot = resolve(import.meta.dirname, "..");
const envLocalPath = resolve(projectRoot, ".env.local");
const openClawConfigPath = resolve("/home/fvrlak/.openclaw/openclaw.json");

type JsonRecord = Record<string, unknown>;
type UnwrappedAppRecord = {
  appId: string;
  relativePath: string;
};
type WrappedAppRecord = {
  appId: string;
  relativePath: string;
};

type MutableOnboardSession = OpenClawOnboardSession & {
  child: ChildProcess | null;
};

type MutableGatewayRuntime = OpenClawGatewayRuntime & {
  child: ChildProcess | null;
};

const idleOnboardSession = (): OpenClawOnboardSession => ({
  status: "idle",
  startedAt: null,
  endedAt: null,
  authChoice: null,
  command: null,
  logs: [],
  authUrl: null,
  awaitingInput: false,
  inputPrompt: null,
  logFilePath: null,
  error: null,
  exitCode: null,
});

const idleGatewayRuntime = (): OpenClawGatewayRuntime => ({
  status: "idle",
  startedAt: null,
  endedAt: null,
  command: null,
  logs: [],
  error: null,
  exitCode: null,
});

let openClawOnboardSession: MutableOnboardSession = {
  ...idleOnboardSession(),
  child: null,
};

let openClawGatewayRuntime: MutableGatewayRuntime = {
  ...idleGatewayRuntime(),
  child: null,
};

function serializeOnboardSession(): OpenClawOnboardSession {
  return {
    status: openClawOnboardSession.status,
    startedAt: openClawOnboardSession.startedAt,
    endedAt: openClawOnboardSession.endedAt,
    authChoice: openClawOnboardSession.authChoice,
    command: openClawOnboardSession.command,
    logs: openClawOnboardSession.logs,
    authUrl: openClawOnboardSession.authUrl,
    awaitingInput: openClawOnboardSession.awaitingInput,
    inputPrompt: openClawOnboardSession.inputPrompt,
    logFilePath: openClawOnboardSession.logFilePath,
    error: openClawOnboardSession.error,
    exitCode: openClawOnboardSession.exitCode,
  };
}

async function readEnvFileSource(filePath: string) {
  if (!existsSync(filePath)) {
    return "";
  }
  return await readFile(filePath, "utf8");
}

function normalizeEnvValue(value: string | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized ? normalized : null;
}

function readEnvValue(source: string, name: string) {
  const parsed = parseDotenv(source);
  return normalizeEnvValue(parsed[name]);
}

function tryParseJson(source: string) {
  try {
    return JSON.parse(source) as JsonRecord;
  } catch {
    return null;
  }
}

function upsertEnvValue(source: string, name: string, value: string) {
  const escapedValue = /[\s#"']/u.test(value) ? JSON.stringify(value) : value;
  const nextLine = `${name}=${escapedValue}`;
  if (new RegExp(`^${name}=.*$`, "m").test(source)) {
    return source.replace(new RegExp(`^${name}=.*$`, "m"), nextLine);
  }
  return `${source}${source.endsWith("\n") || source.length === 0 ? "" : "\n"}${nextLine}\n`;
}

async function updateLocalEnv(updates: Record<string, string>) {
  let source = await readEnvFileSource(envLocalPath);
  for (const [name, value] of Object.entries(updates)) {
    source = upsertEnvValue(source, name, value);
    process.env[name] = value;
  }
  await writeFile(envLocalPath, source, "utf8");
}

function toWsGatewayUrl(rawUrl: string | null) {
  if (!rawUrl) {
    return null;
  }
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith("ws://") || trimmed.startsWith("wss://")) {
    return trimmed;
  }
  if (trimmed.startsWith("http://")) {
    return `ws://${trimmed.slice("http://".length)}`;
  }
  if (trimmed.startsWith("https://")) {
    return `wss://${trimmed.slice("https://".length)}`;
  }
  return trimmed;
}

function parseGatewayPort(rawUrl: string | null) {
  if (!rawUrl) {
    return null;
  }
  try {
    const parsed = new URL(rawUrl);
    return parsed.port || (parsed.protocol === "https:" || parsed.protocol === "wss:" ? "443" : "80");
  } catch {
    return null;
  }
}

function inferRoutingMode(agentId: string | null, agentIdPrefix: string | null): OpenClawRoutingMode {
  return agentId ? "shared" : "per_app";
}

function readOpenClawConfigValue(root: JsonRecord | null, path: string[]) {
  let current: unknown = root;
  for (const segment of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return null;
    }
    current = (current as JsonRecord)[segment];
  }
  return current ?? null;
}

function readSecretRefSource(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return typeof value === "string" && value.trim() ? "inline" : null;
  }
  const record = value as JsonRecord;
  const source = typeof record.source === "string" ? record.source : null;
  const id = typeof record.id === "string" ? record.id : null;
  return source && id ? `${source}:${id}` : source;
}

function resolveSecretRefValue(value: unknown, envSource: string) {
  if (typeof value === "string") {
    return normalizeEnvValue(value);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as JsonRecord;
  if (record.source !== "env" || typeof record.id !== "string") {
    return null;
  }
  return readEnvValue(envSource, record.id) ?? normalizeEnvValue(process.env[record.id]);
}

async function runExecFile(command: string, args: string[], options?: { cwd?: string }) {
  return await new Promise<{ stdout: string; stderr: string }>((resolvePromise, rejectPromise) => {
    execFile(command, args, { cwd: options?.cwd ?? projectRoot, env: process.env }, (error, stdout, stderr) => {
      if (error) {
        rejectPromise(new Error(stderr.trim() || error.message));
        return;
      }
      resolvePromise({ stdout, stderr });
    });
  });
}

async function listUnwrappedApps(projectRootPath: string): Promise<UnwrappedAppRecord[]> {
  const appsRoot = resolve(projectRootPath, "apps");
  if (!existsSync(appsRoot)) {
    return [];
  }

  const entries = await readdir(appsRoot, { withFileTypes: true });
  const apps = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => {
      const appId = entry.name;
      const appRoot = resolve(appsRoot, appId);
      const hasSoftboxConfig = existsSync(resolve(appRoot, "softbox.config.json"));
      const hasPackageJson = existsSync(resolve(appRoot, "package.json"));
      const hasSourceDir = existsSync(resolve(appRoot, "src"));
      return {
        appId,
        relativePath: `apps/${appId}`,
        isCandidate: !hasSoftboxConfig && (hasPackageJson || hasSourceDir),
      };
    })
    .filter((entry) => entry.isCandidate)
    .map((entry) => ({
      appId: entry.appId,
      relativePath: entry.relativePath,
    }))
    .sort((left, right) => left.appId.localeCompare(right.appId));

  return apps;
}

async function listWrappedApps(projectRootPath: string): Promise<WrappedAppRecord[]> {
  const appsRoot = resolve(projectRootPath, "apps");
  if (!existsSync(appsRoot)) {
    return [];
  }

  const entries = await readdir(appsRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => {
      const appId = entry.name;
      const appRoot = resolve(appsRoot, appId);
      const hasSoftboxConfig = existsSync(resolve(appRoot, "softbox.config.json"));
      return {
        appId,
        relativePath: `apps/${appId}`,
        isWrapped: hasSoftboxConfig,
      };
    })
    .filter((entry) => entry.isWrapped)
    .map((entry) => ({
      appId: entry.appId,
      relativePath: entry.relativePath,
    }))
    .sort((left, right) => left.appId.localeCompare(right.appId));
}

async function removeIfExists(path: string) {
  if (!existsSync(path)) {
    return false;
  }
  await rm(path, { force: true, recursive: true });
  return true;
}

async function removeDirIfEmpty(path: string) {
  if (!existsSync(path)) {
    return false;
  }
  const entries = await readdir(path);
  if (entries.length > 0) {
    return false;
  }
  await rm(path, { recursive: true, force: true });
  return true;
}

async function stripUiScreenshotScript(appRoot: string) {
  const packageJsonPath = resolve(appRoot, "package.json");
  if (!existsSync(packageJsonPath)) {
    return false;
  }
  const source = await readFile(packageJsonPath, "utf8");
  let parsed: JsonRecord;
  try {
    parsed = JSON.parse(source) as JsonRecord;
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return false;
  }
  const scripts = parsed.scripts as JsonRecord | undefined;
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) {
    return false;
  }
  if (!Object.prototype.hasOwnProperty.call(scripts, "ui:screenshot")) {
    return false;
  }
  delete scripts["ui:screenshot"];
  await writeFile(packageJsonPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  return true;
}

async function unwrapInstalledApp(projectRootPath: string, appId: string) {
  const appRoot = resolve(projectRootPath, "apps", appId);
  if (!existsSync(appRoot)) {
    return {
      unwrapped: false,
      removed: [] as string[],
    };
  }

  const targets = [
    resolve(appRoot, "softbox.config.json"),
    resolve(appRoot, ".softbox"),
    resolve(appRoot, "src", "entry.tsx"),
    resolve(appRoot, "src", "defaultState.ts"),
    resolve(appRoot, "src", "adapter", "runtime.tsx"),
    resolve(appRoot, "src", "adapter", "shellAdapter.tsx"),
  ];
  const removed: string[] = [];

  for (const target of targets) {
    if (await removeIfExists(target)) {
      removed.push(target);
    }
  }

  if (await stripUiScreenshotScript(appRoot)) {
    removed.push(resolve(appRoot, "package.json"));
  }
  if (await removeDirIfEmpty(resolve(appRoot, "src", "adapter"))) {
    removed.push(resolve(appRoot, "src", "adapter"));
  }

  return {
    unwrapped: removed.length > 0,
    removed,
  };
}

function collectScopes(items: unknown[]) {
  const scopes = new Set<string>();
  for (const item of items) {
    const record = item as JsonRecord;
    const nestedScopes = Array.isArray(record?.scopes)
      ? record.scopes
      : Array.isArray(record?.requestedScopes)
        ? record.requestedScopes
        : [];
    for (const scope of nestedScopes) {
      if (typeof scope === "string" && scope.trim()) {
        scopes.add(scope.trim());
      }
    }
  }
  return Array.from(scopes).sort();
}

function summarizeDevicePayload(payload: unknown) {
  const record = (payload ?? {}) as JsonRecord;
  const pending = Array.isArray(record.pending)
    ? record.pending
    : Array.isArray(record.pendingDevices)
      ? record.pendingDevices
      : [];
  const paired = Array.isArray(record.paired)
    ? record.paired
    : Array.isArray(record.pairedDevices)
      ? record.pairedDevices
      : [];

  return {
    pendingCount: pending.length,
    pairedCount: paired.length,
    pendingScopes: collectScopes(pending),
    pairedScopes: collectScopes(paired),
  };
}

function normalizeSessionLine(line: string) {
  const normalized = line
    .replace(/^([│┆┃])\s*/u, "")
    .replace(/\s*([│┆┃])$/u, "")
    .replace(/^[◇◆◓◐◑◒■□▪▸▹▻►]\s*/u, "")
    .replace(/[─╮╯╰╭┐┘└┌]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized || normalized === "_") {
    return null;
  }

  if (/^[│┆┃─╮╯╰╭┐┘└┌\s]+$/u.test(normalized)) {
    return null;
  }

  return normalized;
}

function shouldKeepSessionLine(line: string) {
  if (/^Open:\s*https:\/\/\S+$/i.test(line)) {
    return true;
  }
  if (/^Paste the authorization code \(or full redirect URL\):$/i.test(line)) {
    return true;
  }

  const compact = line.replace(/\s+/g, "");
  if (!compact) {
    return false;
  }
  if (/^[a-z0-9]$/i.test(compact)) {
    return false;
  }
  if (/^(?:\.\.\.|…)+$/u.test(compact)) {
    return false;
  }
  if (/^[\[\]();:.0-9a-fm]+$/i.test(compact)) {
    return false;
  }

  return true;
}

function sanitizeTerminalOutput(chunk: string) {
  return chunk
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, "")
    .replace(/\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "")
    .replace(/\r/g, "\n")
    .replace(/\u0008/g, "")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "");
}

function appendSessionLog(chunk: string) {
  const sanitized = sanitizeTerminalOutput(chunk);
  const nextLines = sanitized
    .split(/\r?\n/)
    .map((line) => normalizeSessionLine(line))
    .filter((line): line is string => Boolean(line))
    .filter((line) => shouldKeepSessionLine(line));

  if (nextLines.length === 0) {
    return;
  }

  for (const line of nextLines) {
    const authUrlMatch = line.match(/^Open:\s*(https:\/\/\S+)$/i);
    if (authUrlMatch) {
      openClawOnboardSession.authUrl = authUrlMatch[1];
    }
    if (/^Paste the authorization code \(or full redirect URL\):$/i.test(line)) {
      openClawOnboardSession.awaitingInput = true;
      openClawOnboardSession.inputPrompt = line;
    }
  }

  if (openClawOnboardSession.logFilePath) {
    void appendFile(openClawOnboardSession.logFilePath, `${nextLines.join("\n")}\n`, "utf8");
  }

  const nextLogs: string[] = [...openClawOnboardSession.logs];
  for (const line of nextLines) {
    if (nextLogs[nextLogs.length - 1] !== line) {
      nextLogs.push(line);
    }
  }
  openClawOnboardSession.logs = nextLogs.slice(-200);
}

function appendGatewayRuntimeLog(chunk: string) {
  const nextLogs = `${openClawGatewayRuntime.logs.join("\n")}\n${sanitizeTerminalOutput(chunk)}`
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  openClawGatewayRuntime.logs = nextLogs.slice(-200);
}

function maskCommandArgs(args: string[]) {
  const masked: string[] = [];
  const secretFlags = new Set(["--gateway-token", "--token", "--openai-api-key"]);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    masked.push(arg);
    if (secretFlags.has(arg) && index + 1 < args.length) {
      masked.push("***");
      index += 1;
    }
  }

  return masked.join(" ");
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function waitForGatewayReachable(gatewayBaseUrl: string | null, timeoutMs = 6_000) {
  if (!gatewayBaseUrl) {
    return false;
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    try {
      const response = await fetch(gatewayBaseUrl, { method: "GET" });
      if (response.status < 500) {
        return true;
      }
    } catch {
      // Keep polling until the timeout expires.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  return false;
}

function startOpenClawGatewayRuntime(args: { gatewayPort: string; gatewayToken: string }) {
  if (openClawGatewayRuntime.child && openClawGatewayRuntime.status === "running") {
    return openClawGatewayRuntime.child;
  }

  const child = spawn(
    "openclaw",
    ["gateway", "run", "--port", args.gatewayPort, "--token", args.gatewayToken],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        OPENCLAW_GATEWAY_TOKEN: args.gatewayToken,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  openClawGatewayRuntime = {
    child,
    status: "running",
    startedAt: Date.now(),
    endedAt: null,
    command: `openclaw gateway run --port ${args.gatewayPort} --token ***`,
    logs: [],
    error: null,
    exitCode: null,
  };

  child.stdout.on("data", (chunk) => appendGatewayRuntimeLog(chunk.toString()));
  child.stderr.on("data", (chunk) => appendGatewayRuntimeLog(chunk.toString()));
  child.on("error", (error) => {
    openClawGatewayRuntime.status = "failed";
    openClawGatewayRuntime.error = error.message;
    openClawGatewayRuntime.endedAt = Date.now();
    openClawGatewayRuntime.child = null;
  });
  child.on("exit", (code, signal) => {
    openClawGatewayRuntime.exitCode = code ?? null;
    openClawGatewayRuntime.endedAt = Date.now();
    openClawGatewayRuntime.child = null;
    if (signal === "SIGTERM") {
      openClawGatewayRuntime.status = "cancelled";
      return;
    }
    if ((code ?? 1) === 0) {
      openClawGatewayRuntime.status = "completed";
      return;
    }
    openClawGatewayRuntime.status = "failed";
    openClawGatewayRuntime.error =
      openClawGatewayRuntime.logs[openClawGatewayRuntime.logs.length - 1] ??
      `openclaw gateway run exited with code ${code ?? 1}`;
  });

  return child;
}

async function stopOpenClawGatewayRuntime() {
  if (openClawGatewayRuntime.child && openClawGatewayRuntime.status === "running") {
    openClawGatewayRuntime.child.kill("SIGTERM");
  }

  try {
    await runExecFile("systemctl", ["--user", "stop", "openclaw-gateway.service"]);
  } catch {
    // Ignore: the gateway may not be managed by systemd on this machine.
  }

  try {
    const gatewayPort = String((await buildOpenClawStatus()).config.gatewayPort ?? 18789);
    const { stdout } = await runExecFile("lsof", ["-ti", `tcp:${gatewayPort}`]);
    const pids = stdout
      .trim()
      .split(/\s+/)
      .map((pid) => Number(pid))
      .filter((pid) => Number.isInteger(pid) && pid > 0);

    for (const pid of pids) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Ignore processes that exit between lsof and kill.
      }
    }
  } catch {
    // Ignore if there is no listener on the gateway port.
  }

  await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
}

async function ensureOpenClawGatewayAvailable(status: OpenClawStatus, gatewayToken: string | null) {
  if (status.gateway.status === "healthy" && status.devices.status !== "error") {
    return status;
  }
  if (status.config.gatewayMode !== "local") {
    throw new Error("OpenClaw gateway is unreachable. Softbox can only auto-start local gateway mode.");
  }
  if (!gatewayToken) {
    throw new Error("OpenClaw gateway token is missing.");
  }

  const gatewayPort = String(status.config.gatewayPort ?? 18789);
  if (!openClawGatewayRuntime.child || openClawGatewayRuntime.status !== "running") {
    startOpenClawGatewayRuntime({
      gatewayPort,
      gatewayToken,
    });
  }

  const reachable = await waitForGatewayReachable(status.config.gatewayBaseUrl);
  if (!reachable) {
    throw new Error(
      openClawGatewayRuntime.error ??
        "OpenClaw gateway did not become reachable after Softbox tried to start it.",
    );
  }

  const refreshedStatus = await buildOpenClawStatus();
  if (refreshedStatus.devices.status === "error") {
    throw new Error(
      refreshedStatus.devices.message ||
        "OpenClaw gateway became reachable over HTTP, but the authenticated CLI path is still failing.",
    );
  }

  return refreshedStatus;
}

async function buildOpenClawStatus(): Promise<OpenClawStatus> {
  const checkedAt = Date.now();
  const envSource = await readEnvFileSource(envLocalPath);
  const openClawConfigSource = await readEnvFileSource(openClawConfigPath);
  const openClawConfig = tryParseJson(openClawConfigSource);
  const agentCommand = readEnvValue(envSource, "AGENT_COMMAND") ?? normalizeEnvValue(process.env.AGENT_COMMAND);
  const configuredGatewayMode = readOpenClawConfigValue(openClawConfig, ["gateway", "mode"]);
  const gatewayMode = typeof configuredGatewayMode === "string" ? configuredGatewayMode : null;
  const configuredGatewayBind = readOpenClawConfigValue(openClawConfig, ["gateway", "bind"]);
  const gatewayBind = typeof configuredGatewayBind === "string" ? configuredGatewayBind : null;
  const configuredGatewayCustomBindHost = readOpenClawConfigValue(openClawConfig, ["gateway", "customBindHost"]);
  const gatewayCustomBindHost =
    typeof configuredGatewayCustomBindHost === "string" ? configuredGatewayCustomBindHost : null;
  const configuredGatewayPort = readOpenClawConfigValue(openClawConfig, ["gateway", "port"]);
  const gatewayPort =
    typeof configuredGatewayPort === "number" && Number.isFinite(configuredGatewayPort)
      ? configuredGatewayPort
      : 18789;
  const configuredRemoteUrl = readOpenClawConfigValue(openClawConfig, ["gateway", "remote", "url"]);
  const computedLocalGatewayUrl =
    gatewayMode === "local" ? `http://127.0.0.1:${gatewayPort}` : null;
  const gatewayBaseUrl =
    (typeof configuredRemoteUrl === "string" ? configuredRemoteUrl.replace(/^ws:/, "http:").replace(/^wss:/, "https:") : null) ??
    readEnvValue(envSource, "OPENCLAW_GATEWAY_BASE_URL") ??
    normalizeEnvValue(process.env.OPENCLAW_GATEWAY_BASE_URL) ??
    computedLocalGatewayUrl ??
    "http://127.0.0.1:18789";
  const configuredGatewayTokenRef =
    readOpenClawConfigValue(openClawConfig, ["gateway", "auth", "token"]) ??
    readOpenClawConfigValue(openClawConfig, ["gateway", "remote", "token"]);
  const gatewayToken =
    resolveSecretRefValue(configuredGatewayTokenRef, envSource) ??
    readEnvValue(envSource, "OPENCLAW_GATEWAY_TOKEN") ??
    normalizeEnvValue(process.env.OPENCLAW_GATEWAY_TOKEN);
  const gatewayTokenSource =
    readSecretRefSource(configuredGatewayTokenRef) ??
    (gatewayToken ? "env:OPENCLAW_GATEWAY_TOKEN" : null);
  const agentId = readEnvValue(envSource, "OPENCLAW_AGENT_ID") ?? normalizeEnvValue(process.env.OPENCLAW_AGENT_ID);
  const agentIdPrefix =
    readEnvValue(envSource, "OPENCLAW_AGENT_ID_PREFIX") ??
    normalizeEnvValue(process.env.OPENCLAW_AGENT_ID_PREFIX);
  const sessionKeyPrefix =
    readEnvValue(envSource, "OPENCLAW_SESSION_KEY_PREFIX") ??
    normalizeEnvValue(process.env.OPENCLAW_SESSION_KEY_PREFIX) ??
    "softbox";
  const routingMode = inferRoutingMode(agentId, agentIdPrefix);

  let gateway: OpenClawStatus["gateway"] = {
    status: gatewayBaseUrl ? "warning" : "error",
    message: gatewayBaseUrl
      ? gatewayToken
        ? "Gateway URL and token are configured."
        : "Gateway URL is configured, but the gateway token is missing."
      : "OpenClaw gateway URL is not configured.",
  };

  if (gatewayBaseUrl) {
    try {
      const response = await fetch(gatewayBaseUrl, { method: "GET" });
      gateway = {
        status: response.status < 500 ? "healthy" : "warning",
        message: `Gateway responded with ${response.status}.`,
      };
    } catch (error) {
      gateway = {
        status: gatewayToken ? "warning" : "error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  let devices: OpenClawStatus["devices"] = {
    status: gatewayToken ? "warning" : "error",
    message: gatewayToken
      ? "Run a device check to confirm pairing scopes."
      : "Gateway token is missing, so Softbox cannot inspect pairing state.",
    pendingCount: 0,
    pairedCount: 0,
    pendingScopes: [],
    pairedScopes: [],
    rawOutput: null,
  };

  if (gatewayToken && gatewayBaseUrl) {
    const wsUrl = toWsGatewayUrl(gatewayBaseUrl);
    const args = ["devices", "list", "--json"];
    if (wsUrl) {
      args.push("--url", wsUrl);
    }
    args.push("--token", gatewayToken);

    try {
      const payload = await new Promise<{ stdout: string; stderr: string }>((resolvePromise, rejectPromise) => {
        execFile("openclaw", args, { cwd: projectRoot, env: process.env }, (error, stdout, stderr) => {
          if (error) {
            rejectPromise(new Error(stderr.trim() || error.message));
            return;
          }
          resolvePromise({ stdout, stderr });
        });
      });
      const parsed = JSON.parse(payload.stdout) as unknown;
      const summary = summarizeDevicePayload(parsed);
      devices = {
        status: summary.pendingCount > 0 ? "warning" : "healthy",
        message:
          summary.pendingCount > 0
            ? `${summary.pendingCount} pending pairing request(s) need approval.`
            : "No pending pairing requests detected.",
        ...summary,
        rawOutput: payload.stdout.trim() || null,
      };
    } catch (error) {
      devices = {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
        pendingCount: 0,
        pairedCount: 0,
        pendingScopes: [],
        pairedScopes: [],
        rawOutput: null,
      };
    }
  }

  return {
    checkedAt,
    config: {
      agentCommand,
      gatewayBaseUrl,
      gatewayTokenConfigured: Boolean(gatewayToken),
      gatewayMode,
      gatewayBind,
      gatewayCustomBindHost,
      gatewayPort,
      gatewayTokenSource,
      routingMode,
      agentId,
      agentIdPrefix,
      sessionKeyPrefix,
      envFilePath: envLocalPath,
      openClawConfigPath,
    },
    gateway,
    devices,
    gatewayRuntime: {
      status: openClawGatewayRuntime.status,
      startedAt: openClawGatewayRuntime.startedAt,
      endedAt: openClawGatewayRuntime.endedAt,
      command: openClawGatewayRuntime.command,
      logs: openClawGatewayRuntime.logs,
      error: openClawGatewayRuntime.error,
      exitCode: openClawGatewayRuntime.exitCode,
    },
    onboardSession: serializeOnboardSession(),
  };
}

export default defineConfig({
  root: resolve(import.meta.dirname),
  envDir: resolve(import.meta.dirname, ".."),
  plugins: [
    react(),
    {
      name: "softbox-create-app-api",
      configureServer(server) {
        let createAppInFlight = false;
        let appInstallInFlight = false;
        let appUninstallInFlight = false;
        async function checkRedis(redisUrl: string | undefined) {
          if (!redisUrl) {
            return { status: "warning", message: "REDIS_URL is not configured." } as const;
          }
          try {
            const parsed = new URL(redisUrl);
            const port = Number(parsed.port || 6379);
            await new Promise<void>((resolvePromise, rejectPromise) => {
              const socket = new Socket();
              const cleanup = () => {
                socket.removeAllListeners();
                socket.destroy();
              };
              socket.setTimeout(1500);
              socket.once("connect", () => {
                cleanup();
                resolvePromise();
              });
              socket.once("timeout", () => {
                cleanup();
                rejectPromise(new Error("Connection timed out"));
              });
              socket.once("error", (error) => {
                cleanup();
                rejectPromise(error);
              });
              socket.connect(port, parsed.hostname);
            });
            return { status: "healthy", message: `Reachable at ${parsed.hostname}:${port}.` } as const;
          } catch (error) {
            return {
              status: "error",
              message: error instanceof Error ? error.message : String(error),
            } as const;
          }
        }

        async function checkHttp(url: string | undefined, label: string) {
          if (!url) {
            return { status: "warning", message: `${label} is not configured.` } as const;
          }
          try {
            const response = await fetch(url, { method: "GET" });
            return {
              status: response.ok ? "healthy" : "warning",
              message: `${label} responded with ${response.status}.`,
            } as const;
          } catch (error) {
            return {
              status: "error",
              message: error instanceof Error ? error.message : String(error),
            } as const;
          }
        }

        async function readJsonBody(req: NodeJS.ReadableStream) {
          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          if (chunks.length === 0) {
            return {};
          }
          return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
        }

        function writeJson(res: NodeJS.WritableStream & { statusCode: number; setHeader(name: string, value: string): void; end(payload: string): void }, statusCode: number, payload: unknown) {
          res.statusCode = statusCode;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(payload));
        }

        server.middlewares.use("/__softbox/create-app", (req, res) => {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
            return;
          }

          if (createAppInFlight) {
            res.statusCode = 409;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, error: "Another app creation is already running." }));
            return;
          }

          const chunks: Buffer[] = [];
          req.on("data", (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });

          req.on("end", () => {
            let payload: { appId?: string } = {};
            try {
              payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            } catch {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: false, error: "Invalid JSON body" }));
              return;
            }

            const appId = payload.appId?.trim().toLowerCase() ?? "";
            if (!/^[a-z0-9][a-z0-9-]*$/.test(appId)) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(
                JSON.stringify({
                  ok: false,
                  error: "App id must use lowercase letters, numbers, and hyphens only.",
                }),
              );
              return;
            }

            createAppInFlight = true;
            const child = spawn(
              "pnpm",
              ["new-app", appId, "--", "--template", "react-ts"],
              {
                cwd: projectRoot,
                env: process.env,
                stdio: ["ignore", "pipe", "pipe"],
              },
            );

            let stderr = "";
            child.stdout.on("data", (chunk) => {
              process.stdout.write(`[create-app] ${chunk.toString()}`);
            });
            child.stderr.on("data", (chunk) => {
              const text = chunk.toString();
              stderr += text;
              process.stderr.write(`[create-app] ${text}`);
            });

            child.on("error", (error) => {
              createAppInFlight = false;
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: false, error: error.message }));
            });

            child.on("exit", (code, signal) => {
              createAppInFlight = false;
              if ((code ?? 0) === 0) {
                res.statusCode = 200;
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ ok: true, appId }));
                return;
              }

              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(
                JSON.stringify({
                  ok: false,
                  error:
                    stderr.trim() ||
                    `pnpm new-app failed with ${signal ? `signal ${signal}` : `exit code ${code ?? 1}`}`,
                }),
              );
            });
          });
        });

        server.middlewares.use("/__softbox/apps/unwrapped", async (req, res) => {
          if (req.method !== "GET") {
            writeJson(res, 405, { ok: false, error: "Method not allowed" });
            return;
          }
          try {
            const apps = await listUnwrappedApps(projectRoot);
            writeJson(res, 200, { ok: true, apps });
          } catch (error) {
            writeJson(res, 500, {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });

        async function handleInstallApp(req: any, res: any) {
          if (req.method !== "POST") {
            writeJson(res, 405, { ok: false, error: "Method not allowed" });
            return;
          }
          if (appInstallInFlight || appUninstallInFlight) {
            writeJson(res, 409, {
              ok: false,
              error: "Another app install/uninstall operation is already running.",
            });
            return;
          }

          try {
            const payload = await readJsonBody(req);
            const appId = String(payload.appId ?? "").trim().toLowerCase();
            if (!/^[a-z0-9][a-z0-9-]*$/.test(appId)) {
              writeJson(res, 400, {
                ok: false,
                error: "App id must use lowercase letters, numbers, and hyphens only.",
              });
              return;
            }

            const unwrappedApps = await listUnwrappedApps(projectRoot);
            const selectedApp = unwrappedApps.find((app) => app.appId === appId);
            if (!selectedApp) {
              writeJson(res, 404, {
                ok: false,
                error:
                  `App '${appId}' was not found as an unwrapped app under /apps. ` +
                  `Refresh and try again.`,
              });
              return;
            }

            appInstallInFlight = true;
            const wrap = await runExecFile(
              "pnpm",
              ["wrap-app", "--", "--path", selectedApp.relativePath],
              {
                cwd: projectRoot,
              },
            );

            let seedOutput = "";
            try {
              const seed = await runExecFile(
                "pnpm",
                ["seed", "--", "--app", appId],
                { cwd: projectRoot },
              );
              seedOutput = seed.stdout.trim();
            } catch (error) {
              writeJson(res, 500, {
                ok: false,
                wrapped: true,
                error: `App '${appId}' was wrapped, but seeding failed: ${error instanceof Error ? error.message : String(error)}`,
                output: wrap.stdout.trim(),
              });
              return;
            }

            let syncOutput = "";
            try {
              const sync = await runExecFile(
                "pnpm",
                ["worker:openclaw-sync-agents", "--", "--apply"],
                { cwd: projectRoot },
              );
              syncOutput = sync.stdout.trim();
            } catch (error) {
              writeJson(res, 500, {
                ok: false,
                wrapped: true,
                error: `App '${appId}' was wrapped, but syncing agents failed: ${error instanceof Error ? error.message : String(error)}`,
                output: wrap.stdout.trim(),
              });
              return;
            }

            const status = await buildOpenClawStatus();
            writeJson(res, 200, {
              ok: true,
              appId,
              installed: true,
              output: wrap.stdout.trim(),
              seedOutput,
              syncOutput,
              status,
            });
          } catch (error) {
            writeJson(res, 500, {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          } finally {
            appInstallInFlight = false;
          }
        }

        server.middlewares.use("/__softbox/apps/install", handleInstallApp);
        server.middlewares.use("/__softbox/apps/wrap-and-sync", handleInstallApp);

        server.middlewares.use("/__softbox/apps/uninstall", async (req, res) => {
          if (req.method !== "POST") {
            writeJson(res, 405, { ok: false, error: "Method not allowed" });
            return;
          }
          if (appInstallInFlight || appUninstallInFlight) {
            writeJson(res, 409, {
              ok: false,
              error: "Another app install/uninstall operation is already running.",
            });
            return;
          }

          try {
            const payload = await readJsonBody(req);
            const appId = String(payload.appId ?? "").trim().toLowerCase();
            if (!/^[a-z0-9][a-z0-9-]*$/.test(appId)) {
              writeJson(res, 400, {
                ok: false,
                error: "App id must use lowercase letters, numbers, and hyphens only.",
              });
              return;
            }

            appUninstallInFlight = true;

            let deleteOutput = "";
            try {
              const result = await runExecFile(
                "pnpm",
                ["exec", "convex", "run", "apps:deleteApp", JSON.stringify({ appId })],
                { cwd: projectRoot },
              );
              deleteOutput = result.stdout.trim();
            } catch (error) {
              writeJson(res, 500, {
                ok: false,
                error: `Failed to delete '${appId}' from Convex: ${error instanceof Error ? error.message : String(error)}`,
              });
              return;
            }

            const wrappedApps = await listWrappedApps(projectRoot);
            const wasWrapped = wrappedApps.some((app) => app.appId === appId);
            const unwrapResult = await unwrapInstalledApp(projectRoot, appId);

            let syncOutput = "";
            try {
              const sync = await runExecFile(
                "pnpm",
                ["worker:openclaw-sync-agents", "--", "--apply"],
                { cwd: projectRoot },
              );
              syncOutput = sync.stdout.trim();
            } catch {
              // Keep uninstall successful even when sync cannot run.
            }

            const status = await buildOpenClawStatus();
            writeJson(res, 200, {
              ok: true,
              appId,
              uninstalled: true,
              wasWrapped,
              unwrapped: unwrapResult.unwrapped,
              deleteOutput,
              syncOutput,
              status,
            });
          } catch (error) {
            writeJson(res, 500, {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          } finally {
            appUninstallInFlight = false;
          }
        });

        server.middlewares.use("/__softbox/server-info", (_req, res) => {
          execFile("df", ["-k", "."], { cwd: projectRoot }, (error, stdout) => {
            let diskTotalGb: number | null = null;
            let diskFreeGb: number | null = null;

            if (!error) {
              const lines = stdout.trim().split("\n");
              const parts = lines[lines.length - 1]?.trim().split(/\s+/) ?? [];
              if (parts.length >= 4) {
                const totalKb = Number(parts[1]);
                const freeKb = Number(parts[3]);
                if (!Number.isNaN(totalKb) && !Number.isNaN(freeKb)) {
                  diskTotalGb = totalKb / 1024 / 1024;
                  diskFreeGb = freeKb / 1024 / 1024;
                }
              }
            }

            const cpuList = cpus();
            const cpuModel = cpuList[0]?.model ?? "Unknown CPU";
            const payload = {
              hostname: hostname(),
              platform: platform(),
              release: release(),
              arch: arch(),
              cpuModel,
              cpuCores: cpuList.length,
              totalMemoryGb: totalmem() / 1024 / 1024 / 1024,
              freeMemoryGb: freemem() / 1024 / 1024 / 1024,
              diskTotalGb,
              diskFreeGb,
              nodeVersion: process.version,
            };

            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(payload));
          });
        });

        server.middlewares.use("/__softbox/service-status", async (_req, res) => {
          const checkedAt = Date.now();
          const redis = await checkRedis(process.env.REDIS_URL);
          const convex = await checkHttp(
            process.env.CONVEX_URL || process.env.VITE_CONVEX_URL,
            "Convex URL",
          );
          const openClaw = await checkHttp(
            process.env.OPENCLAW_GATEWAY_BASE_URL,
            "OpenClaw gateway",
          );

          execFile("pgrep", ["-f", "worker/src/index.ts"], (workerError, workerStdout) => {
            const workerHealthy = !workerError && workerStdout.trim().length > 0;
            const statuses = systemServices.map((service) => {
              if (service.name === "Convex") {
                return { ...service, checkedAt, ...convex };
              }
              if (service.name === "Redis") {
                return { ...service, checkedAt, ...redis };
              }
              if (service.name === "BullMQ") {
                return {
                  ...service,
                  checkedAt,
                  status: redis.status === "healthy" ? "healthy" : "warning",
                  message:
                    redis.status === "healthy"
                      ? "Redis is reachable; BullMQ can use the queue backend."
                      : "BullMQ depends on Redis; queue backend is not healthy.",
                };
              }
              if (service.name === "Worker") {
                return {
                  ...service,
                  checkedAt,
                  status: workerHealthy ? "healthy" : "error",
                  message: workerHealthy
                    ? "Worker process is running."
                    : "Worker process was not found.",
                };
              }
              if (service.name === "OpenClaw") {
                return { ...service, checkedAt, ...openClaw };
              }
              if (service.name === "Cloudflare R2") {
                const configured = Boolean(
                  process.env.S3_API &&
                    process.env.PUBLIC_DEVELOPMENT_URL &&
                    process.env.R2_ACCESS_KEY_ID &&
                    process.env.R2_SECRET_ACCESS_KEY,
                );
                return {
                  ...service,
                  checkedAt,
                  status: configured ? "healthy" : "warning",
                  message: configured
                    ? "R2 environment variables are configured."
                    : "One or more R2 environment variables are missing.",
                };
              }
              return {
                ...service,
                checkedAt,
                status: "unknown" as const,
                message: "No check implemented.",
              };
            });

            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(statuses));
          });
        });

        server.middlewares.use("/__softbox/openclaw/status", async (_req, res) => {
          try {
            const payload = await buildOpenClawStatus();
            writeJson(res, 200, payload);
          } catch (error) {
            writeJson(res, 500, {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });

        server.middlewares.use("/__softbox/openclaw/configure", async (req, res) => {
          if (req.method !== "POST") {
            writeJson(res, 405, { ok: false, error: "Method not allowed" });
            return;
          }

          try {
            const payload = await readJsonBody(req);
            const gatewayBaseUrl = String(payload.gatewayBaseUrl ?? "").trim() || "http://127.0.0.1:18789";
            const gatewayToken = String(payload.gatewayToken ?? "").trim();
            const routingMode = payload.routingMode === "shared" ? "shared" : "per_app";
            const agentId = routingMode === "shared" ? String(payload.agentId ?? "").trim() : "";
            const agentIdPrefix =
              routingMode === "per_app" ? String(payload.agentIdPrefix ?? "").trim() : "";
            const sessionKeyPrefix = String(payload.sessionKeyPrefix ?? "").trim() || "softbox";

            if (!gatewayToken) {
              writeJson(res, 400, { ok: false, error: "OpenClaw gateway token is required." });
              return;
            }
            if (routingMode === "shared" && !agentId) {
              writeJson(res, 400, { ok: false, error: "Shared routing requires an OpenClaw agent id." });
              return;
            }

            await updateLocalEnv({
              AGENT_COMMAND: "openclaw",
              OPENCLAW_GATEWAY_BASE_URL: gatewayBaseUrl,
              OPENCLAW_GATEWAY_TOKEN: gatewayToken,
              OPENCLAW_AGENT_ID: agentId,
              OPENCLAW_AGENT_ID_PREFIX: agentIdPrefix,
              OPENCLAW_SESSION_KEY_PREFIX: sessionKeyPrefix,
            });

            const status = await buildOpenClawStatus();
            writeJson(res, 200, { ok: true, status });
          } catch (error) {
            writeJson(res, 500, {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });

        server.middlewares.use("/__softbox/openclaw/gateway/bootstrap", async (req, res) => {
          if (req.method !== "POST") {
            writeJson(res, 405, { ok: false, error: "Method not allowed" });
            return;
          }

          try {
            const token = `sbx_${randomBytes(24).toString("hex")}`;
            await runExecFile("openclaw", ["config", "set", "gateway.mode", "\"local\"", "--strict-json"]);
            await runExecFile("openclaw", ["config", "set", "gateway.bind", "\"custom\"", "--strict-json"]);
            await runExecFile("openclaw", [
              "config",
              "set",
              "gateway.customBindHost",
              "\"127.0.0.1\"",
              "--strict-json",
            ]);
            await runExecFile("openclaw", ["config", "set", "gateway.port", "18789", "--strict-json"]);
            await runExecFile("openclaw", ["config", "set", "gateway.auth.mode", "\"token\"", "--strict-json"]);
            await runExecFile("openclaw", [
              "config",
              "set",
              "gateway.auth.token",
              JSON.stringify(token),
              "--strict-json",
            ]);
            await runExecFile("openclaw", [
              "config",
              "set",
              "gateway.remote.url",
              "\"ws://127.0.0.1:18789\"",
              "--strict-json",
            ]);
            await runExecFile("openclaw", [
              "config",
              "set",
              "gateway.remote.token",
              JSON.stringify(token),
              "--strict-json",
            ]);

            await updateLocalEnv({
              AGENT_COMMAND: "openclaw",
              OPENCLAW_GATEWAY_BASE_URL: "http://127.0.0.1:18789",
              OPENCLAW_GATEWAY_TOKEN: token,
            });

            const status = await buildOpenClawStatus();
            writeJson(res, 200, { ok: true, status });
          } catch (error) {
            writeJson(res, 500, {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });

        server.middlewares.use("/__softbox/openclaw/gateway/start", async (req, res) => {
          if (req.method !== "POST") {
            writeJson(res, 405, { ok: false, error: "Method not allowed" });
            return;
          }
          if (openClawGatewayRuntime.child && openClawGatewayRuntime.status === "running") {
            writeJson(res, 409, { ok: false, error: "OpenClaw gateway is already running." });
            return;
          }
          try {
            const status = await buildOpenClawStatus();
            const gatewayToken =
              readEnvValue(await readEnvFileSource(envLocalPath), "OPENCLAW_GATEWAY_TOKEN") ??
              normalizeEnvValue(process.env.OPENCLAW_GATEWAY_TOKEN);
            if (!gatewayToken) {
              writeJson(res, 400, { ok: false, error: "OpenClaw gateway token is missing." });
              return;
            }
            const gatewayPort = String(status.config.gatewayPort ?? 18789);
            startOpenClawGatewayRuntime({
              gatewayPort,
              gatewayToken,
            });
            await waitForGatewayReachable(status.config.gatewayBaseUrl);
            writeJson(res, 200, { ok: true, status: await buildOpenClawStatus() });
          } catch (error) {
            writeJson(res, 500, {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });

        server.middlewares.use("/__softbox/openclaw/gateway/stop", async (req, res) => {
          if (req.method !== "POST") {
            writeJson(res, 405, { ok: false, error: "Method not allowed" });
            return;
          }
          try {
            await stopOpenClawGatewayRuntime();
            writeJson(res, 200, { ok: true, status: await buildOpenClawStatus() });
          } catch (error) {
            writeJson(res, 500, {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });

        server.middlewares.use("/__softbox/openclaw/onboard/start", async (req, res) => {
          if (req.method !== "POST") {
            writeJson(res, 405, { ok: false, error: "Method not allowed" });
            return;
          }
          if (openClawOnboardSession.child && openClawOnboardSession.status === "running") {
            writeJson(res, 409, { ok: false, error: "An OpenClaw onboard session is already running." });
            return;
          }

          try {
            const payload = await readJsonBody(req);
            const authChoice = String(payload.authChoice ?? "").trim() || "oauth";
            const providerSecret = String(payload.providerSecret ?? "").trim();
            const tokenProvider = String(payload.tokenProvider ?? "").trim() || "openai-codex";
            const gatewayBaseUrl =
              String(payload.gatewayBaseUrl ?? process.env.OPENCLAW_GATEWAY_BASE_URL ?? "").trim() ||
              "http://127.0.0.1:18789";
            const gatewayToken =
              normalizeEnvValue(payload.gatewayToken as string | undefined) ??
              normalizeEnvValue(process.env.OPENCLAW_GATEWAY_TOKEN);
            const gatewayPort = parseGatewayPort(gatewayBaseUrl);
            const useBrowserOAuth = authChoice === "oauth" || authChoice === "openai-codex";
            let args: string[];

            if (useBrowserOAuth) {
              args = [
                "models",
                "auth",
                "login",
                "--provider",
                "openai-codex",
                "--method",
                "oauth",
                "--set-default",
              ];
            } else {
              if (!gatewayToken) {
                writeJson(res, 400, {
                  ok: false,
                  error: "Save the OpenClaw gateway token before starting auth.",
                });
                return;
              }

              args = [
                "onboard",
                "--json",
                "--non-interactive",
                "--accept-risk",
                "--mode",
                "local",
                "--flow",
                "manual",
                "--skip-ui",
                "--skip-daemon",
                "--skip-health",
                "--skip-search",
                "--skip-skills",
                "--skip-channels",
                "--workspace",
                projectRoot,
                "--gateway-auth",
                "token",
                "--gateway-token",
                gatewayToken,
                "--gateway-token-ref-env",
                "OPENCLAW_GATEWAY_TOKEN",
                "--auth-choice",
                authChoice,
              ];

              await ensureOpenClawGatewayAvailable(await buildOpenClawStatus(), gatewayToken);
              if (gatewayPort) {
                args.push("--gateway-port", gatewayPort);
              }
              if (authChoice === "openai-api-key") {
                if (!providerSecret) {
                  writeJson(res, 400, {
                    ok: false,
                    error: "OpenAI API key is required for this auth mode.",
                  });
                  return;
                }
                args.push("--openai-api-key", providerSecret);
              } else if (authChoice === "token") {
                if (!providerSecret) {
                  writeJson(res, 400, { ok: false, error: "Provider token is required for token auth." });
                  return;
                }
                args.push("--token-provider", tokenProvider, "--token", providerSecret);
              }
            }

            const logFilePath = resolve(
              "/tmp",
              `softbox-openclaw-onboard-${Date.now()}-${randomBytes(6).toString("hex")}.log`,
            );
            await writeFile(logFilePath, "", "utf8");

            const child = useBrowserOAuth
              ? spawn(
                  "script",
                  ["-q", "-e", "-f", "-c", `openclaw ${args.map(shellQuote).join(" ")}`, "/dev/null"],
                  {
                    cwd: projectRoot,
                    env: process.env,
                    stdio: ["pipe", "pipe", "pipe"],
                  },
                )
              : spawn("openclaw", args, {
                  cwd: projectRoot,
                  env: process.env,
                  stdio: ["pipe", "pipe", "pipe"],
                });

            openClawOnboardSession = {
              child,
              status: "running",
              startedAt: Date.now(),
              endedAt: null,
              authChoice,
              command: `openclaw ${maskCommandArgs(args)}`,
              logs: [],
              authUrl: null,
              awaitingInput: false,
              inputPrompt: null,
              logFilePath,
              error: null,
              exitCode: null,
            };

            child.stdout.on("data", (chunk) => appendSessionLog(chunk.toString()));
            child.stderr.on("data", (chunk) => appendSessionLog(chunk.toString()));
            child.on("error", (error) => {
              openClawOnboardSession.status = "failed";
              openClawOnboardSession.error = error.message;
              openClawOnboardSession.endedAt = Date.now();
              openClawOnboardSession.awaitingInput = false;
              openClawOnboardSession.inputPrompt = null;
              openClawOnboardSession.child = null;
            });
            child.on("exit", (code, signal) => {
              openClawOnboardSession.exitCode = code ?? null;
              openClawOnboardSession.endedAt = Date.now();
              openClawOnboardSession.awaitingInput = false;
              openClawOnboardSession.inputPrompt = null;
              openClawOnboardSession.child = null;
              if (signal === "SIGTERM") {
                openClawOnboardSession.status = "cancelled";
                return;
              }
              if ((code ?? 1) === 0) {
                openClawOnboardSession.status = "completed";
                return;
              }
              openClawOnboardSession.status = "failed";
              openClawOnboardSession.error =
                openClawOnboardSession.logs[openClawOnboardSession.logs.length - 1] ??
                `openclaw onboard exited with code ${code ?? 1}`;
            });

            writeJson(res, 200, {
              ok: true,
              session: serializeOnboardSession(),
            });
          } catch (error) {
            writeJson(res, 500, {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });

        server.middlewares.use("/__softbox/openclaw/onboard/submit", async (req, res) => {
          if (req.method !== "POST") {
            writeJson(res, 405, { ok: false, error: "Method not allowed" });
            return;
          }
          if (!openClawOnboardSession.child || openClawOnboardSession.status !== "running") {
            writeJson(res, 409, { ok: false, error: "No running OpenClaw onboard session." });
            return;
          }
          if (!openClawOnboardSession.child.stdin || openClawOnboardSession.child.stdin.destroyed) {
            writeJson(res, 409, { ok: false, error: "The current OpenClaw session cannot accept input." });
            return;
          }

          try {
            const payload = await readJsonBody(req);
            const value = String(payload.value ?? "").trim();
            if (!value) {
              writeJson(res, 400, { ok: false, error: "Paste the authorization code or redirect URL first." });
              return;
            }

            await new Promise<void>((resolvePromise, rejectPromise) => {
              openClawOnboardSession.child?.stdin?.write(`${value}\n`, (error) => {
                if (error) {
                  rejectPromise(error);
                  return;
                }
                resolvePromise();
              });
            });

            openClawOnboardSession.awaitingInput = false;
            openClawOnboardSession.inputPrompt = null;
            openClawOnboardSession.logs = [
              ...openClawOnboardSession.logs,
              "[softbox] Submitted OAuth callback input.",
            ].slice(-200);
            if (openClawOnboardSession.logFilePath) {
              await appendFile(
                openClawOnboardSession.logFilePath,
                "[softbox] Submitted OAuth callback input.\n",
                "utf8",
              );
            }

            writeJson(res, 200, { ok: true, session: serializeOnboardSession() });
          } catch (error) {
            writeJson(res, 500, {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });

        server.middlewares.use("/__softbox/openclaw/onboard/cancel", async (req, res) => {
          if (req.method !== "POST") {
            writeJson(res, 405, { ok: false, error: "Method not allowed" });
            return;
          }
          if (!openClawOnboardSession.child || openClawOnboardSession.status !== "running") {
            writeJson(res, 409, { ok: false, error: "No running OpenClaw onboard session." });
            return;
          }
          openClawOnboardSession.child.kill("SIGTERM");
          writeJson(res, 200, { ok: true });
        });

        server.middlewares.use("/__softbox/openclaw/pairing/approve-latest", async (req, res) => {
          if (req.method !== "POST") {
            writeJson(res, 405, { ok: false, error: "Method not allowed" });
            return;
          }
          execFile("openclaw", ["devices", "approve", "--latest"], { cwd: projectRoot, env: process.env }, async (error, stdout, stderr) => {
            if (error) {
              writeJson(res, 500, {
                ok: false,
                error: stderr.trim() || error.message,
              });
              return;
            }
            const status = await buildOpenClawStatus();
            writeJson(res, 200, {
              ok: true,
              output: stdout.trim(),
              status,
            });
          });
        });

        server.middlewares.use("/__softbox/openclaw/sync-agents", async (req, res) => {
          if (req.method !== "POST") {
            writeJson(res, 405, { ok: false, error: "Method not allowed" });
            return;
          }
          execFile(
            "pnpm",
            ["worker:openclaw-sync-agents", "--", "--apply"],
            { cwd: projectRoot, env: process.env },
            async (error, stdout, stderr) => {
              if (error) {
                writeJson(res, 500, {
                  ok: false,
                  error: stderr.trim() || error.message,
                });
                return;
              }
              const status = await buildOpenClawStatus();
              writeJson(res, 200, {
                ok: true,
                output: stdout.trim(),
                status,
              });
            },
          );
        });
      },
    },
  ],
  publicDir: resolve(import.meta.dirname, "../public"),
  server: {
    port: 4173,
  },
  build: {
    outDir: resolve(import.meta.dirname, "../dist-shell"),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@shell": resolve(import.meta.dirname, "src"),
      "@shared": resolve(import.meta.dirname, "../worker/src/shared"),
    },
  },
});
