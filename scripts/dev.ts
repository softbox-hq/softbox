import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, unwatchFile, watchFile } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv, parse as parseDotenv } from "dotenv";
import { ensureOpenClawAgentIdPrefixInEnvFile } from "../worker/src/openClawRouting";

type ProcessSpec = {
  name: string;
  command: string;
  args: string[];
};

const shellProcess: ProcessSpec = {
  name: "shell",
  command: "pnpm",
  args: ["dev:shell"],
};

const runtimeProcesses: ProcessSpec[] = [
  { name: "convex", command: "pnpm", args: ["dev:convex"] },
  { name: "worker", command: "pnpm", args: ["dev:worker"] },
];

function isOpenClawCommand(command: string): boolean {
  return command.trim().toLowerCase().startsWith("openclaw");
}

function runBlockingCommand(step: string, command: string, args: string[]): void {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });

  if (result.status === 0) {
    return;
  }

  if (result.error) {
    throw result.error;
  }

  const signalSuffix = result.signal ? ` (signal ${result.signal})` : "";
  throw new Error(`${step} failed with exit code ${result.status ?? 1}${signalSuffix}`);
}

function prefixStream(
  stream: NodeJS.ReadableStream | null,
  target: NodeJS.WriteStream,
  prefix: string,
) {
  if (!stream) {
    return;
  }

  let buffer = "";
  stream.on("data", (chunk: Buffer | string) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      target.write(`${prefix}${line}\n`);
    }
  });

  stream.on("end", () => {
    if (buffer.length > 0) {
      target.write(`${prefix}${buffer}\n`);
      buffer = "";
    }
  });
}

function killChild(child: ChildProcess): void {
  if (child.killed || child.exitCode !== null) {
    return;
  }
  child.kill("SIGTERM");
}

function readOnboardingDone(envLocalPath: string): boolean {
  const source = existsSync(envLocalPath) ? readFileSync(envLocalPath, "utf8") : "";
  const parsed = parseDotenv(source);
  return (parsed.VITE_ONBOARDING_DONE ?? process.env.VITE_ONBOARDING_DONE ?? "").trim().toLowerCase() === "true";
}

async function main(): Promise<void> {
  loadEnv({ path: ".env.local", quiet: true });
  loadEnv({ path: ".env", quiet: true });

  const projectRoot = resolve(process.cwd());
  const envLocalPath = resolve(projectRoot, ".env.local");
  const openClawRouting = await ensureOpenClawAgentIdPrefixInEnvFile({
    envLocalPath,
    projectRoot,
  });
  if (openClawRouting.prefix) {
    process.env.OPENCLAW_AGENT_ID_PREFIX = openClawRouting.prefix;
  }

  const agentCommand =
    process.env.AGENT_COMMAND?.trim() ||
    process.env.CLAUDE_CODE_COMMAND?.trim() ||
    "codex";
  const sharedOpenClawAgentId = process.env.OPENCLAW_AGENT_ID?.trim() || "";
  const onboardingDone = readOnboardingDone(envLocalPath);

  console.log(
    onboardingDone
      ? "[start] starting Convex, worker, and shell"
      : "[start] onboarding mode detected; starting the shell only",
  );
  console.log("[start] run 'pnpm run doctor' first if startup fails");
  if (openClawRouting.updated && openClawRouting.prefix) {
    console.log(
      `[start] set checkout-scoped OPENCLAW_AGENT_ID_PREFIX=${openClawRouting.prefix}`,
    );
  }

  const children = new Map<string, ChildProcess>();
  let shuttingDown = false;
  let runtimeStarting = false;
  let runtimeStarted = false;

  function shutdown(exitCode = 0): void {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    unwatchFile(envLocalPath);
    for (const child of children.values()) {
      killChild(child);
    }
    process.exitCode = exitCode;
  }

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));

  function startChild(spec: ProcessSpec): void {
    if (children.has(spec.name)) {
      return;
    }

    const child = spawn(spec.command, spec.args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["inherit", "pipe", "pipe"],
    });

    children.set(spec.name, child);
    prefixStream(child.stdout, process.stdout, `[${spec.name}] `);
    prefixStream(child.stderr, process.stderr, `[${spec.name}] `);

    child.on("exit", (code, signal) => {
      children.delete(spec.name);
      if (shuttingDown) {
        return;
      }

      if (signal) {
        console.error(`[start] ${spec.name} exited from signal ${signal}`);
        shutdown(1);
        return;
      }

      if ((code ?? 0) !== 0) {
        console.error(`[start] ${spec.name} exited with code ${code ?? 1}`);
        shutdown(code ?? 1);
        return;
      }

      console.error(`[start] ${spec.name} exited unexpectedly`);
      shutdown(1);
    });

    child.on("error", (error) => {
      console.error(`[start] failed to start ${spec.name}: ${error.message}`);
      shutdown(1);
    });
  }

  async function startRuntimeServices() {
    if (runtimeStarted || runtimeStarting || shuttingDown) {
      return;
    }

    runtimeStarting = true;
    try {
      console.log("[start] preflighting Convex deployment");
      runBlockingCommand("Convex preflight", "pnpm", ["exec", "convex", "dev", "--once"]);

      if (isOpenClawCommand(agentCommand) && !sharedOpenClawAgentId) {
        console.log("[start] syncing OpenClaw agents for this checkout");
        runBlockingCommand("OpenClaw agent sync", "pnpm", [
          "worker:openclaw-sync-agents",
          "--",
          "--apply",
        ]);
      }

      for (const spec of runtimeProcesses) {
        startChild(spec);
      }
      runtimeStarted = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[start] failed to start runtime services: ${message}`);
      shutdown(1);
    } finally {
      runtimeStarting = false;
    }
  }

  startChild(shellProcess);

  if (onboardingDone) {
    await startRuntimeServices();
  } else {
    console.log("[start] onboarding is incomplete; skipping Convex preflight and worker startup");
    watchFile(envLocalPath, { interval: 500 }, async () => {
      if (shuttingDown || runtimeStarted || runtimeStarting) {
        return;
      }

      if (!readOnboardingDone(envLocalPath)) {
        return;
      }

      console.log("[start] onboarding completed; starting Convex and worker");
      await startRuntimeServices();
    });
  }

  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      if (children.size === 0) {
        clearInterval(timer);
        resolve();
      }
    }, 100);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
