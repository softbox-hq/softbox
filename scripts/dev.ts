import { spawn, type ChildProcess } from "node:child_process";

type ProcessSpec = {
  name: string;
  command: string;
  args: string[];
};

const processes: ProcessSpec[] = [
  { name: "convex", command: "pnpm", args: ["dev:convex"] },
  { name: "worker", command: "pnpm", args: ["dev:worker"] },
  { name: "shell", command: "pnpm", args: ["dev:shell"] },
];

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

async function main(): Promise<void> {
  console.log("[dev] starting Convex, worker, and shell");
  console.log("[dev] run 'pnpm run doctor' first if startup fails");

  const children = new Map<string, ChildProcess>();
  let shuttingDown = false;

  function shutdown(exitCode = 0): void {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    for (const child of children.values()) {
      killChild(child);
    }
    process.exitCode = exitCode;
  }

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));

  for (const spec of processes) {
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
        console.error(`[dev] ${spec.name} exited from signal ${signal}`);
        shutdown(1);
        return;
      }

      if ((code ?? 0) !== 0) {
        console.error(`[dev] ${spec.name} exited with code ${code ?? 1}`);
        shutdown(code ?? 1);
        return;
      }

      console.error(`[dev] ${spec.name} exited unexpectedly`);
      shutdown(1);
    });

    child.on("error", (error) => {
      console.error(`[dev] failed to start ${spec.name}: ${error.message}`);
      shutdown(1);
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
