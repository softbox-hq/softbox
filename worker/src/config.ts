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

function parseBoolean(value: string | undefined, fallback = false): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(normalized);
}

function normalizeObjectStorageEndpoint(endpoint: string): string {
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
      `Invalid S3 API URL '${raw}'. Expected a full URL like ` +
        "'https://<host>/<bucket>' or 'http://127.0.0.1:9000/<bucket>'.",
    );
  }

  const pathSegments = parsed.pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (pathSegments.length !== 1) {
    throw new Error(
      `Invalid S3 API URL '${raw}'. Expected exactly one bucket path segment like ` +
        "'https://<host>/<bucket>'.",
    );
  }

  const bucket = pathSegments[0];
  const endpoint = normalizeObjectStorageEndpoint(parsed.toString());

  return {
    s3Api: `${endpoint}/${bucket}`,
    endpoint,
    bucket,
  };
}

export type ArtifactStorageProvider = "r2" | "minio";

type ArtifactStorageConfig = {
  provider: ArtifactStorageProvider;
  label: string;
  s3Api: string;
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicDevelopmentUrl: string;
};

function readArtifactStorageProvider(): ArtifactStorageProvider {
  const raw = process.env.ARTIFACT_STORAGE_PROVIDER?.trim().toLowerCase() || "r2";
  if (raw === "r2" || raw === "minio") {
    return raw;
  }
  throw new Error(
    `Invalid ARTIFACT_STORAGE_PROVIDER '${raw}'. Expected 'r2' or 'minio'.`,
  );
}

function loadArtifactStorageConfig(provider: ArtifactStorageProvider): ArtifactStorageConfig {
  if (provider === "minio") {
    const parsedS3Api = parseS3ApiUrl(requireEnv("MINIO_S3_API"));
    return {
      provider,
      label: "MinIO",
      s3Api: parsedS3Api.s3Api,
      endpoint: parsedS3Api.endpoint,
      bucket: parsedS3Api.bucket,
      accessKeyId: requireEnv("MINIO_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("MINIO_SECRET_ACCESS_KEY"),
      publicDevelopmentUrl: requireEnv("MINIO_PUBLIC_DEVELOPMENT_URL").replace(/\/+$/, ""),
    };
  }

  const parsedS3Api = parseS3ApiUrl(requireEnv("S3_API"));
  return {
    provider,
    label: "R2",
    s3Api: parsedS3Api.s3Api,
    endpoint: parsedS3Api.endpoint,
    bucket: parsedS3Api.bucket,
    accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
    publicDevelopmentUrl: requireEnv("PUBLIC_DEVELOPMENT_URL").replace(/\/+$/, ""),
  };
}

export type WorkerConfig = {
  convexUrl: string;
  agentCommand: string;
  agentModel?: string;
  agentTimeoutMs: number;
  redisUrl: string;
  artifactStorageProvider: ArtifactStorageProvider;
  artifactStorageLabel: string;
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
  openClawAllowModelOverrides: boolean;
};

export function loadWorkerConfig(): WorkerConfig {
  const projectRoot = resolve(process.cwd());
  const artifactStorageProvider = readArtifactStorageProvider();
  const artifactStorageConfig = loadArtifactStorageConfig(artifactStorageProvider);
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
    artifactStorageProvider,
    artifactStorageLabel: artifactStorageConfig.label,
    r2Endpoint: artifactStorageConfig.endpoint,
    r2Bucket: artifactStorageConfig.bucket,
    r2AccessKeyId: artifactStorageConfig.accessKeyId,
    r2SecretAccessKey: artifactStorageConfig.secretAccessKey,
    publicDevelopmentUrl: artifactStorageConfig.publicDevelopmentUrl,
    s3Api: artifactStorageConfig.s3Api,
    appId: process.env.APP_ID?.trim() || defaultConfiguredAppId || defaultAppId,
    pollIntervalMs,
    staleJobTimeoutMs,
    queueName: process.env.BULLMQ_QUEUE_NAME ?? "softbox-jobs",
    queueConcurrency: parsePositiveNumber(process.env.BULLMQ_QUEUE_CONCURRENCY, 1),
    queueAttempts: parsePositiveNumber(process.env.BULLMQ_QUEUE_ATTEMPTS, 2),
    queueBackoffMs: parsePositiveNumber(process.env.BULLMQ_QUEUE_BACKOFF_MS, 800),
    r2UploadConcurrency: parsePositiveNumber(
      process.env.ARTIFACT_UPLOAD_CONCURRENCY ?? process.env.R2_UPLOAD_CONCURRENCY,
      6,
    ),
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
    openClawAllowModelOverrides: openClawEnabled
      ? parseBoolean(process.env.OPENCLAW_ALLOW_MODEL_OVERRIDES, false)
      : false,
  };
}
