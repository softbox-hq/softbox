import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
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

function appendSessionLog(chunk: string) {
  const nextLogs = `${openClawOnboardSession.logs.join("\n")}\n${chunk}`
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  openClawOnboardSession.logs = nextLogs.slice(-200);
}

function appendGatewayRuntimeLog(chunk: string) {
  const nextLogs = `${openClawGatewayRuntime.logs.join("\n")}\n${chunk}`
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  openClawGatewayRuntime.logs = nextLogs.slice(-200);
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
        status: response.ok ? "healthy" : "warning",
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
    onboardSession: {
      status: openClawOnboardSession.status,
      startedAt: openClawOnboardSession.startedAt,
      endedAt: openClawOnboardSession.endedAt,
      authChoice: openClawOnboardSession.authChoice,
      command: openClawOnboardSession.command,
      logs: openClawOnboardSession.logs,
      error: openClawOnboardSession.error,
      exitCode: openClawOnboardSession.exitCode,
    },
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
              "--ref-provider",
              "default",
              "--ref-source",
              "env",
              "--ref-id",
              "OPENCLAW_GATEWAY_TOKEN",
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
              "--ref-provider",
              "default",
              "--ref-source",
              "env",
              "--ref-id",
              "OPENCLAW_GATEWAY_TOKEN",
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
            const gatewayPort = String(status.config.gatewayPort ?? 18789);
            if (!gatewayToken) {
              writeJson(res, 400, { ok: false, error: "OpenClaw gateway token is missing." });
              return;
            }

            const child = spawn(
              "openclaw",
              ["gateway", "run", "--port", gatewayPort, "--token", gatewayToken],
              {
                cwd: projectRoot,
                env: {
                  ...process.env,
                  OPENCLAW_GATEWAY_TOKEN: gatewayToken,
                },
                stdio: ["ignore", "pipe", "pipe"],
              },
            );

            openClawGatewayRuntime = {
              child,
              status: "running",
              startedAt: Date.now(),
              endedAt: null,
              command: `openclaw gateway run --port ${gatewayPort} --token ***`,
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
          if (!openClawGatewayRuntime.child || openClawGatewayRuntime.status !== "running") {
            writeJson(res, 409, { ok: false, error: "OpenClaw gateway is not running." });
            return;
          }
          openClawGatewayRuntime.child.kill("SIGTERM");
          writeJson(res, 200, { ok: true, status: await buildOpenClawStatus() });
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
              String(payload.gatewayToken ?? process.env.OPENCLAW_GATEWAY_TOKEN ?? "").trim();
            const gatewayPort = parseGatewayPort(gatewayBaseUrl);
            const args = [
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

            if (!gatewayToken) {
              writeJson(res, 400, {
                ok: false,
                error: "Save the OpenClaw gateway token before starting auth.",
              });
              return;
            }
            if (gatewayPort) {
              args.push("--gateway-port", gatewayPort);
            }
            if (authChoice === "openai-api-key") {
              if (!providerSecret) {
                writeJson(res, 400, { ok: false, error: "OpenAI API key is required for this auth mode." });
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

            const child = spawn("openclaw", args, {
              cwd: projectRoot,
              env: process.env,
              stdio: ["ignore", "pipe", "pipe"],
            });

            openClawOnboardSession = {
              child,
              status: "running",
              startedAt: Date.now(),
              endedAt: null,
              authChoice,
              command: `openclaw ${args.join(" ")}`,
              logs: [],
              error: null,
              exitCode: null,
            };

            child.stdout.on("data", (chunk) => appendSessionLog(chunk.toString()));
            child.stderr.on("data", (chunk) => appendSessionLog(chunk.toString()));
            child.on("error", (error) => {
              openClawOnboardSession.status = "failed";
              openClawOnboardSession.error = error.message;
              openClawOnboardSession.endedAt = Date.now();
              openClawOnboardSession.child = null;
            });
            child.on("exit", (code, signal) => {
              openClawOnboardSession.exitCode = code ?? null;
              openClawOnboardSession.endedAt = Date.now();
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
              session: {
                status: openClawOnboardSession.status,
                startedAt: openClawOnboardSession.startedAt,
                endedAt: openClawOnboardSession.endedAt,
                authChoice: openClawOnboardSession.authChoice,
                command: openClawOnboardSession.command,
                logs: openClawOnboardSession.logs,
                error: openClawOnboardSession.error,
                exitCode: openClawOnboardSession.exitCode,
              },
            });
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
