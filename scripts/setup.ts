import { copyFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parse as parseDotenv } from "dotenv";
import {
  ensureLocalMinioBucket,
  loadLocalMinioConfig,
  waitForLocalMinioHealth,
} from "../worker/src/localMinio";
import { ensureOpenClawAgentIdPrefixInEnvFile } from "../worker/src/openClawRouting";

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

  const dockerCheck = spawnSync("docker", ["compose", "version"], {
    cwd: projectRoot,
    env: process.env,
    stdio: "ignore",
  });

  if (dockerCheck.status === 0) {
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
  } else {
    console.log(
      `[setup] docker compose not available, skipping ${composeServices.join(" and ")} startup`,
    );
  }

  if (localMinio) {
    const minioHealth = await waitForLocalMinioHealth(localMinio, {
      attempts: dockerCheck.status === 0 ? 30 : 1,
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
