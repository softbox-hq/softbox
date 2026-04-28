import { copyFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import net from "node:net";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parse as parseDotenv } from "dotenv";
import {
  ensureLocalMinioBucket,
  loadLocalMinioConfig,
  waitForLocalMinioHealth,
} from "../worker/src/localMinio";
import { ensureOpenClawAgentIdPrefixInEnvFile } from "../worker/src/openClawRouting";

type DockerStatus =
  | {
      status: "available";
    }
  | {
      status: "permission-denied";
      detail: string;
    }
  | {
      status: "unavailable";
      detail: string;
    };

function checkDockerStatus(projectRoot: string): DockerStatus {
  const dockerExists = spawnSync("docker", ["--version"], {
    cwd: projectRoot,
    env: process.env,
    encoding: "utf8",
  });

  if (dockerExists.status !== 0) {
    return {
      status: "unavailable",
      detail: "Docker is not installed or is not on PATH.",
    };
  }

  const composeCheck = spawnSync("docker", ["compose", "version"], {
    cwd: projectRoot,
    env: process.env,
    encoding: "utf8",
  });

  if (composeCheck.status === 0) {
    return { status: "available" };
  }

  const detail = `${composeCheck.stderr || ""}\n${composeCheck.stdout || ""}`.trim();
  if (
    detail.includes("/var/run/docker.sock") ||
    /permission denied/i.test(detail) ||
    /Cannot connect to the Docker daemon/i.test(detail)
  ) {
    return {
      status: "permission-denied",
      detail: detail || "Docker is installed, but this user cannot access the Docker daemon.",
    };
  }

  return {
    status: "unavailable",
    detail: detail || "Docker Compose is not available.",
  };
}

function parseRedisTarget(redisUrl: string): { host: string; port: number } {
  const parsed = new URL(redisUrl);
  return {
    host: parsed.hostname || "127.0.0.1",
    port: parsed.port ? Number(parsed.port) : 6379,
  };
}

async function canConnectTcp(host: string, port: number): Promise<boolean> {
  return await new Promise<boolean>((resolvePromise) => {
    const socket = net.createConnection({ host, port });
    const timeout = setTimeout(() => {
      socket.destroy();
      resolvePromise(false);
    }, 1500);

    socket.once("connect", () => {
      clearTimeout(timeout);
      socket.end();
      resolvePromise(true);
    });
    socket.once("error", () => {
      clearTimeout(timeout);
      resolvePromise(false);
    });
  });
}

async function composeServicesReachable(args: {
  services: string[];
  env: Record<string, string | undefined>;
  localMinio: ReturnType<typeof loadLocalMinioConfig>;
}): Promise<boolean> {
  const checks: boolean[] = [];
  if (args.services.includes("redis")) {
    try {
      const redisUrl = args.env.REDIS_URL?.trim() || "redis://127.0.0.1:6379";
      const { host, port } = parseRedisTarget(redisUrl);
      checks.push(await canConnectTcp(host, port));
    } catch {
      checks.push(false);
    }
  }

  if (args.services.includes("minio")) {
    if (!args.localMinio) {
      checks.push(false);
    } else {
      const health = await waitForLocalMinioHealth(args.localMinio, {
        attempts: 1,
        delayMs: 1000,
      });
      checks.push(health.ok);
    }
  }

  return checks.length > 0 && checks.every(Boolean);
}

async function main(): Promise<void> {
  const projectRoot = resolve(process.cwd());
  const envExamplePath = resolve(projectRoot, ".env.example");
  const envLocalPath = resolve(projectRoot, ".env.local");

  if (!existsSync(envExamplePath)) {
    throw new Error("Missing .env.example");
  }

  if (!existsSync(envLocalPath)) {
    await copyFile(envExamplePath, envLocalPath);
    console.log("[setup] created .env.local from .env.example");
  } else {
    console.log("[setup] .env.local already exists");
  }

  const openClawRouting = await ensureOpenClawAgentIdPrefixInEnvFile({
    envLocalPath,
    projectRoot,
  });
  if (openClawRouting.updated && openClawRouting.prefix) {
    console.log(
      `[setup] set checkout-scoped OPENCLAW_AGENT_ID_PREFIX=${openClawRouting.prefix}`,
    );
  }

  const envLocalSource = await readFile(envLocalPath, "utf8");
  const parsedEnv = parseDotenv(envLocalSource);
  const artifactStorageProvider =
    parsedEnv.ARTIFACT_STORAGE_PROVIDER?.trim().toLowerCase() || "r2";
  const composeServices =
    artifactStorageProvider === "minio" ? ["redis", "minio"] : ["redis"];
  const effectiveEnv = {
    ...process.env,
    ...parsedEnv,
  };
  let localMinio: ReturnType<typeof loadLocalMinioConfig> = null;
  try {
    localMinio = loadLocalMinioConfig(effectiveEnv);
  } catch (error) {
    console.log(
      `[setup] local MinIO provisioning skipped: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const dockerStatus = checkDockerStatus(projectRoot);

  if (dockerStatus.status === "available") {
    console.log(
      `[setup] starting ${composeServices.join(" and ")} with docker compose`,
    );
    const servicesStart = spawnSync("docker", ["compose", "up", "-d", ...composeServices], {
      cwd: projectRoot,
      env: process.env,
      stdio: "inherit",
    });
    if (servicesStart.status !== 0) {
      console.log(`[setup] docker compose could not start ${composeServices.join(" and ")}`);
      console.log(
        "[setup] if one of those ports is already in use by a local service, keep that service and verify with 'pnpm run doctor'.",
      );
    }
  } else if (dockerStatus.status === "permission-denied") {
    const servicesReachable = await composeServicesReachable({
      services: composeServices,
      env: effectiveEnv,
      localMinio,
    });
    console.log("[setup] Docker is installed, but this user cannot access the Docker socket.");
    console.log(`[setup] ${dockerStatus.detail}`);
    if (servicesReachable) {
      console.log(
        `[setup] ${composeServices.join(" and ")} already appear reachable, so this is not blocking setup.`,
      );
    } else {
      console.log("[setup] fix one of these:");
      console.log("[setup] - add the user to the docker group and open a new shell");
      console.log(
        `[setup] - or start services manually with: sudo docker compose up -d ${composeServices.join(" ")}`,
      );
    }
  } else {
    console.log(
      `[setup] docker compose not available, skipping ${composeServices.join(" and ")} startup`,
    );
    console.log(`[setup] ${dockerStatus.detail}`);
  }

  if (localMinio) {
    const minioHealth = await waitForLocalMinioHealth(localMinio, {
      attempts: dockerStatus.status === "available" ? 30 : 1,
      delayMs: 1000,
    });

    if (!minioHealth.ok) {
      console.log(`[setup] local MinIO is not ready yet: ${minioHealth.message}`);
      console.log(
        "[setup] once MinIO is reachable, rerun 'pnpm run bootstrap' or let 'pnpm start' finish the bucket setup automatically.",
      );
    } else {
      const ensured = await ensureLocalMinioBucket(localMinio);
      console.log(
        ensured.bucketCreated
          ? `[setup] local MinIO bucket '${localMinio.bucket}' created and initialized for Softbox`
          : `[setup] local MinIO bucket '${localMinio.bucket}' is ready for Softbox`,
      );
    }
  }

  console.log("[setup] BullMQ is already bundled in the worker; Redis is the only queue service to run.");
  console.log("[setup] next: fill .env.local, run 'pnpm run doctor', then run 'pnpm start'");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
