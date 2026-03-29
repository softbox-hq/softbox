import { access } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import net from "node:net";
import { resolve } from "node:path";
import "../worker/src/loadEnv";
import {
  defaultWrappedAppId,
  discoverWrappedApps,
  getDefaultWrappedAppId,
  inspectWrappedAppSource,
  softboxConfigFileName,
} from "../worker/src/templates";

type CheckLevel = "ok" | "warn" | "fail";

type CheckResult = {
  level: CheckLevel;
  label: string;
  detail: string;
};

function pushResult(
  results: CheckResult[],
  level: CheckLevel,
  label: string,
  detail: string,
): void {
  results.push({ level, label, detail });
}

function readEnv(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function parseRedisTarget(redisUrl: string): { host: string; port: number } {
  const parsed = new URL(redisUrl);
  if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") {
    throw new Error(`Unsupported Redis protocol '${parsed.protocol}'`);
  }
  return {
    host: parsed.hostname || "127.0.0.1",
    port: parsed.port ? Number(parsed.port) : 6379,
  };
}

async function canConnectTcp(host: string, port: number): Promise<boolean> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const socket = net.createConnection({ host, port });
    const timeout = setTimeout(() => {
      socket.destroy();
      rejectPromise(new Error("Timed out"));
    }, 1500);

    socket.once("connect", () => {
      clearTimeout(timeout);
      socket.end();
      resolvePromise();
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      rejectPromise(error);
    });
  });

  return true;
}

function commandExists(commandName: string): boolean {
  const check = spawnSync("bash", ["-lc", `command -v ${JSON.stringify(commandName)}`], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "ignore",
  });
  return check.status === 0;
}

function summarize(results: CheckResult[]): { failures: number; warnings: number } {
  return results.reduce(
    (summary, result) => {
      if (result.level === "fail") {
        summary.failures += 1;
      }
      if (result.level === "warn") {
        summary.warnings += 1;
      }
      return summary;
    },
    { failures: 0, warnings: 0 },
  );
}

async function main(): Promise<void> {
  const projectRoot = resolve(process.cwd());
  const results: CheckResult[] = [];

  const envLocalPath = resolve(projectRoot, ".env.local");
  pushResult(
    results,
    existsSync(envLocalPath) ? "ok" : "warn",
    ".env.local",
    existsSync(envLocalPath)
      ? "Environment file exists."
      : "Missing .env.local. Run 'pnpm setup' or copy .env.example first.",
  );

  const requiredEnvNames = [
    "VITE_CONVEX_URL",
    "CONVEX_URL",
    "R2_ENDPOINT",
    "R2_BUCKET",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_PUBLIC_BASE_URL",
  ];

  for (const envName of requiredEnvNames) {
    pushResult(
      results,
      readEnv(envName) ? "ok" : "fail",
      envName,
      readEnv(envName) ? "Configured." : "Missing required value.",
    );
  }

  const agentCommand = (readEnv("AGENT_COMMAND") || "codex").split(/\s+/)[0] || "codex";
  pushResult(
    results,
    commandExists(agentCommand) ? "ok" : "fail",
    "agent command",
    commandExists(agentCommand)
      ? `Found '${agentCommand}' on PATH.`
      : `Could not find '${agentCommand}' on PATH.`,
  );

  const redisUrl = readEnv("REDIS_URL") || "redis://127.0.0.1:6379";
  try {
    const { host, port } = parseRedisTarget(redisUrl);
    await canConnectTcp(host, port);
    pushResult(results, "ok", "Redis", `Reachable at ${host}:${port}.`);
  } catch (error) {
    pushResult(
      results,
      "fail",
      "Redis",
      `${error instanceof Error ? error.message : String(error)} Run 'docker compose up -d redis' if needed.`,
    );
  }

  const discovery = discoverWrappedApps(projectRoot);
  for (const issue of discovery.issues) {
    pushResult(
      results,
      issue.severity === "error" ? "fail" : "warn",
      issue.appDir,
      issue.message,
    );
  }

  if (discovery.apps.length === 0) {
    pushResult(
      results,
      "fail",
      "apps",
      `No wrapped apps are registered. Add '${softboxConfigFileName}' by running ` +
        `'pnpm wrap-app -- --path apps/<name>' on a supported app.`,
    );
  }

  for (const app of discovery.apps) {
    const source = await inspectWrappedAppSource(projectRoot, app.appId);
    pushResult(
      results,
      source.status === "available" ? "ok" : "fail",
      `app:${app.appId}`,
      source.status === "available"
        ? `${app.relativeRoot} is ready for Softbox.`
        : source.message ?? `${app.relativeRoot} is missing required runtime files.`,
    );
  }

  const configuredAppId = readEnv("APP_ID") || getDefaultWrappedAppId(projectRoot);
  pushResult(
    results,
    discovery.apps.some((app) => app.appId === configuredAppId)
      ? "ok"
      : "warn",
    "APP_ID",
    discovery.apps.some((app) => app.appId === configuredAppId)
      ? `Default seeded app is '${configuredAppId}'.`
      : configuredAppId === defaultWrappedAppId
        ? `Still using fallback '${defaultWrappedAppId}'. Set APP_ID after wrapping an app.`
        : `'${configuredAppId}' does not match any wrapped app.`,
  );

  try {
    await access(resolve(projectRoot, "docker-compose.yml"));
    pushResult(results, "ok", "docker-compose.yml", "Local Redis compose file exists.");
  } catch {
    pushResult(results, "warn", "docker-compose.yml", "Missing docker-compose.yml.");
  }

  for (const result of results) {
    const prefix =
      result.level === "ok" ? "[ok]" : result.level === "warn" ? "[warn]" : "[fail]";
    console.log(`${prefix} ${result.label}: ${result.detail}`);
  }

  const summary = summarize(results);
  console.log(
    `[doctor] ${summary.failures} blocking issue(s), ${summary.warnings} warning(s)`,
  );

  if (summary.failures > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
