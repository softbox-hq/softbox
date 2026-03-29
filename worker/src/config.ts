import { basename, resolve } from "node:path";
import { defaultAppId } from "./shared/liveApp";
import { getDefaultWrappedAppId } from "./templates";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isOpenClawCommand(command: string): boolean {
  return basename(command.trim()).toLowerCase().startsWith("openclaw");
}

export type WorkerConfig = {
  convexUrl: string;
  agentCommand: string;
  agentModel?: string;
  agentTimeoutMs: number;
  redisUrl: string;
  r2Endpoint: string;
  r2Bucket: string;
  r2AccessKeyId: string;
  r2SecretAccessKey: string;
  r2PublicBaseUrl: string;
  appId: string;
  pollIntervalMs: number;
  staleJobTimeoutMs: number;
  queueName: string;
  queueConcurrency: number;
  queueAttempts: number;
  queueBackoffMs: number;
  r2UploadConcurrency: number;
  projectRoot: string;
  openClawGatewayBaseUrl?: string;
  openClawGatewayToken?: string;
  openClawAgentId?: string;
  openClawAgentIdPrefix?: string;
  openClawSessionKeyPrefix: string;
};

export function loadWorkerConfig(): WorkerConfig {
  const projectRoot = resolve(process.cwd());
  const agentCommand =
    process.env.AGENT_COMMAND ??
    process.env.CLAUDE_CODE_COMMAND ??
    "codex";
  const agentTimeoutMs = parsePositiveNumber(process.env.AGENT_TIMEOUT_MS, 120000);
  const staleJobTimeoutMs = parsePositiveNumber(
    process.env.JOB_STALE_TIMEOUT_MS,
    Math.max(agentTimeoutMs * 3, 120000),
  );
  const pollIntervalMs = parsePositiveNumber(process.env.WORKER_POLL_INTERVAL_MS, 1500);
  const openClawEnabled = isOpenClawCommand(agentCommand);
  const defaultConfiguredAppId = getDefaultWrappedAppId(projectRoot);
  const openClawAgentId = process.env.OPENCLAW_AGENT_ID?.trim() || undefined;
  const openClawAgentIdPrefix =
    process.env.OPENCLAW_AGENT_ID_PREFIX?.trim() || undefined;

  if (openClawEnabled && !openClawAgentId && !openClawAgentIdPrefix) {
    throw new Error(
      "OpenClaw command selected, but no agent routing is configured. Set OPENCLAW_AGENT_ID for one shared agent or OPENCLAW_AGENT_ID_PREFIX for one agent per app.",
    );
  }

  return {
    convexUrl: requireEnv("CONVEX_URL"),
    agentCommand,
    agentModel:
      process.env.AGENT_MODEL?.trim() ||
      process.env.CLAUDE_CODE_MODEL?.trim() ||
      undefined,
    agentTimeoutMs,
    redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
    r2Endpoint: requireEnv("R2_ENDPOINT"),
    r2Bucket: requireEnv("R2_BUCKET"),
    r2AccessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
    r2SecretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
    r2PublicBaseUrl: requireEnv("R2_PUBLIC_BASE_URL").replace(/\/+$/, ""),
    appId: process.env.APP_ID?.trim() || defaultConfiguredAppId || defaultAppId,
    pollIntervalMs,
    staleJobTimeoutMs,
    queueName: process.env.BULLMQ_QUEUE_NAME ?? "softbox-jobs",
    queueConcurrency: parsePositiveNumber(process.env.BULLMQ_QUEUE_CONCURRENCY, 1),
    queueAttempts: parsePositiveNumber(process.env.BULLMQ_QUEUE_ATTEMPTS, 2),
    queueBackoffMs: parsePositiveNumber(process.env.BULLMQ_QUEUE_BACKOFF_MS, 800),
    r2UploadConcurrency: parsePositiveNumber(process.env.R2_UPLOAD_CONCURRENCY, 6),
    projectRoot,
    openClawGatewayBaseUrl: openClawEnabled
      ? (process.env.OPENCLAW_GATEWAY_BASE_URL?.trim() || "http://127.0.0.1:18789")
      : undefined,
    openClawGatewayToken: openClawEnabled
      ? requireEnv("OPENCLAW_GATEWAY_TOKEN")
      : undefined,
    openClawAgentId: openClawEnabled ? openClawAgentId : undefined,
    openClawAgentIdPrefix: openClawEnabled ? openClawAgentIdPrefix : undefined,
    openClawSessionKeyPrefix:
      process.env.OPENCLAW_SESSION_KEY_PREFIX?.trim() || "softbox",
  };
}
