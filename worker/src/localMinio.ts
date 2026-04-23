import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { parseS3ApiUrl } from "./config";

export const localMinioProbeKey = "_softbox/health.txt";
export const localMinioProbeBody = "softbox-minio-ready\n";

export type LocalMinioConfig = {
  accessKeyId: string;
  bucket: string;
  endpoint: string;
  healthUrl: string;
  probeKey: string;
  publicDevelopmentUrl: string;
  publicProbeUrl: string;
  s3Api: string;
  secretAccessKey: string;
};

type EnvLike = Record<string, string | undefined>;

function isLocalHostname(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function isLocalHttpEndpoint(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return isLocalHostname(parsed.hostname);
  } catch {
    return false;
  }
}

function readTrimmedEnv(env: EnvLike, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function isMissingBucketError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const details = error as {
    Code?: string;
    $metadata?: { httpStatusCode?: number };
    name?: string;
  };

  return (
    details.Code === "NoSuchBucket" ||
    details.name === "NoSuchBucket" ||
    details.$metadata?.httpStatusCode === 404
  );
}

export function loadLocalMinioConfig(env: EnvLike = process.env): LocalMinioConfig | null {
  const provider = (env.ARTIFACT_STORAGE_PROVIDER ?? "r2").trim().toLowerCase();
  if (provider !== "minio") {
    return null;
  }

  const s3Api = readTrimmedEnv(env, "MINIO_S3_API");
  const parsed = parseS3ApiUrl(s3Api);
  if (!isLocalHttpEndpoint(parsed.endpoint)) {
    return null;
  }

  const accessKeyId = readTrimmedEnv(env, "MINIO_ACCESS_KEY_ID");
  const secretAccessKey = readTrimmedEnv(env, "MINIO_SECRET_ACCESS_KEY");
  const publicDevelopmentUrl =
    (env.MINIO_PUBLIC_DEVELOPMENT_URL?.trim() || `${parsed.endpoint}/${parsed.bucket}`).replace(
      /\/+$/,
      "",
    );

  return {
    accessKeyId,
    bucket: parsed.bucket,
    endpoint: parsed.endpoint,
    healthUrl: `${parsed.endpoint}/minio/health/live`,
    probeKey: localMinioProbeKey,
    publicDevelopmentUrl,
    publicProbeUrl: `${publicDevelopmentUrl}/${localMinioProbeKey}`,
    s3Api: parsed.s3Api,
    secretAccessKey,
  };
}

export function createLocalMinioClient(config: LocalMinioConfig): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

export async function checkLocalMinioHealth(
  config: LocalMinioConfig,
): Promise<{ message: string; ok: boolean }> {
  try {
    const response = await fetch(config.healthUrl, { method: "GET" });
    return {
      ok: response.ok,
      message: response.ok
        ? `MinIO health endpoint responded from ${config.healthUrl}.`
        : `MinIO health endpoint returned ${response.status}.`,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function waitForLocalMinioHealth(
  config: LocalMinioConfig,
  options?: { attempts?: number; delayMs?: number },
): Promise<{ message: string; ok: boolean }> {
  const attempts = Math.max(1, options?.attempts ?? 1);
  const delayMs = Math.max(0, options?.delayMs ?? 1000);
  let latest = await checkLocalMinioHealth(config);

  for (let attempt = 1; attempt < attempts; attempt += 1) {
    if (latest.ok) {
      break;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));
    latest = await checkLocalMinioHealth(config);
  }

  return latest;
}

export async function checkLocalMinioPublicProbe(
  config: LocalMinioConfig,
): Promise<{ message: string; ok: boolean }> {
  try {
    const response = await fetch(config.publicProbeUrl, { method: "GET" });
    return {
      ok: response.ok,
      message: response.ok
        ? `Public probe is reachable at ${config.publicProbeUrl}.`
        : `Public probe returned ${response.status} from ${config.publicProbeUrl}.`,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function ensureLocalMinioBucket(config: LocalMinioConfig): Promise<{
  bucketCreated: boolean;
}> {
  const client = createLocalMinioClient(config);
  let bucketCreated = false;

  try {
    await client.send(
      new HeadBucketCommand({
        Bucket: config.bucket,
      }),
    );
  } catch (error) {
    if (!isMissingBucketError(error)) {
      throw error;
    }
    await client.send(
      new CreateBucketCommand({
        Bucket: config.bucket,
      }),
    );
    bucketCreated = true;
  }

  await client.send(
    new PutBucketPolicyCommand({
      Bucket: config.bucket,
      Policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Sid: "PublicReadObjects",
            Effect: "Allow",
            Principal: "*",
            Action: ["s3:GetObject"],
            Resource: [`arn:aws:s3:::${config.bucket}/*`],
          },
        ],
      }),
    }),
  );

  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: config.probeKey,
      Body: localMinioProbeBody,
      CacheControl: "no-store",
      ContentType: "text/plain; charset=utf-8",
    }),
  );

  return {
    bucketCreated,
  };
}
