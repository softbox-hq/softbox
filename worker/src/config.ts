import { basename, resolve } from "node:path";
import { resolveOpenClawAgentIdPrefix } from "./openClawRouting";
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

function normalizeR2Endpoint(endpoint: string): string {
  const trimmed = endpoint.trim();
  try {
    const parsed = new URL(trimmed);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

function isOpenClawCommand(command: string): boolean {
  return basename(command.trim()).toLowerCase().startsWith("openclaw");
}

export type ParsedS3ApiConfig = {
  s3Api: string;
  endpoint: string;
  bucket: string;
};

export function parseS3ApiUrl(raw: string): ParsedS3ApiConfig {
  const trimmed = raw.trim();
  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(
      `Invalid S3_API '${raw}'. Expected a full URL like ` +
        "'https://<account>.r2.cloudflarestorage.com/<bucket>'.",
    );
  }

  const pathSegments = parsed.pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (pathSegments.length !== 1) {
    throw new Error(
      `Invalid S3_API '${raw}'. Expected exactly one bucket path segment like ` +
        "'https://<account>.r2.cloudflarestorage.com/<bucket>'.",
    );
  }

  const bucket = pathSegments[0];
  const endpoint = normalizeR2Endpoint(parsed.toString());

  return {
    s3Api: `${endpoint}/${bucket}`,
    endpoint,
    bucket,
  };
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
  publicDevelopmentUrl: string;
  s3Api: string;
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
  const parsedS3Api = parseS3ApiUrl(requireEnv("S3_API"));
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
  const openClawAgentIdPrefix = openClawEnabled
    ? resolveOpenClawAgentIdPrefix({
        projectRoot,
        agentId: openClawAgentId,
        agentIdPrefix: process.env.OPENCLAW_AGENT_ID_PREFIX?.trim() || undefined,
      })
    : undefined;

  return {
    convexUrl: requireEnv("CONVEX_URL"),
    agentCommand,
    agentModel:
      process.env.AGENT_MODEL?.trim() ||
      process.env.CLAUDE_CODE_MODEL?.trim() ||
      undefined,
    agentTimeoutMs,
    redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
    r2Endpoint: parsedS3Api.endpoint,
    r2Bucket: parsedS3Api.bucket,
    r2AccessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
    r2SecretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
    publicDevelopmentUrl: requireEnv("PUBLIC_DEVELOPMENT_URL").replace(/\/+$/, ""),
    s3Api: parsedS3Api.s3Api,
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
