import { copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
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

  const dockerCheck = spawnSync("docker", ["compose", "version"], {
    cwd: projectRoot,
    env: process.env,
    stdio: "ignore",
  });

  if (dockerCheck.status === 0) {
    console.log("[setup] starting Redis with docker compose");
    const redisStart = spawnSync("docker", ["compose", "up", "-d", "redis"], {
      cwd: projectRoot,
      env: process.env,
      stdio: "inherit",
    });
    if (redisStart.status !== 0) {
      console.log("[setup] docker compose could not start Redis");
    }
  } else {
    console.log("[setup] docker compose not available, skipping Redis startup");
  }

  console.log("[setup] next: fill .env.local, run 'pnpm run doctor', then run 'pnpm start'");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
