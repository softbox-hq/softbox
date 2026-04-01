import { access, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { select } from "@inquirer/prompts";
import { config as loadEnv } from "dotenv";
import { stdin as input, stdout as output, stderr } from "node:process";
import { extname, join } from "node:path";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

const appIdPattern = /^[a-z0-9][a-z0-9-]*$/;
const defaultViteTemplate = "react-ts";
const defaultShellId = "main";
const starterOptions = [
  {
    id: "blank-react-ts",
    label: "Blank React + TypeScript",
    description: "Create a fresh Vite app with the react-ts starter and wrap it for Softbox.",
    mode: "vite-template",
    appIdBase: "react-app",
    viteArgs: ["--template", "react-ts"],
  },
  {
    id: "blank-react",
    label: "Blank React + JavaScript",
    description: "Create a fresh Vite app with the react starter and wrap it for Softbox.",
    mode: "vite-template",
    appIdBase: "react-js-app",
    viteArgs: ["--template", "react"],
  },
  {
    id: "dashboard-example",
    label: "Dashboard Example",
    description: "Copy the bundled Softbox-ready dashboard starter.",
    mode: "copy-starter",
    appIdBase: "dashboard",
    sourceAppId: "dashboard-example",
  },
  {
    id: "grid-example",
    label: "Grid Example",
    description: "Copy the wrapped grid starter app.",
    mode: "copy-starter",
    appIdBase: "grid",
    sourceAppId: "grid-example",
  },
  {
    id: "tictactoe-example",
    label: "Tic Tac Toe Example",
    description: "Copy the wrapped tic tac toe starter app.",
    mode: "copy-starter",
    appIdBase: "tictactoe",
    sourceAppId: "tictactoe-example",
  },
];
const textRewriteExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".svg",
  ".ts",
  ".tsx",
  ".txt",
  ".yml",
  ".yaml",
]);

function printHelp() {
  output.write(
    [
      "Usage:",
      "  pnpm new-app [app-id] [--starter <starter-id>] [-- <vite args...>]",
      "",
      "Examples:",
      "  pnpm new-app",
      "  pnpm new-app my-app",
      "  pnpm new-app --starter dashboard-example",
      "  pnpm new-app my-app -- --template react-ts",
      "",
      `Default template: ${defaultViteTemplate}`,
      "Then Softbox runs the full onboarding flow for the new app.",
      "",
      "Starters:",
      ...starterOptions.map((starter) => `  - ${starter.id}: ${starter.label}`),
    ].join("\n") + "\n",
  );
}

function parseArgs(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    return { help: true, appId: null, viteArgs: [], starterId: null };
  }

  const separatorIndex = argv.indexOf("--");
  const args = separatorIndex >= 0 ? argv.slice(0, separatorIndex) : argv;
  const viteArgs = separatorIndex >= 0 ? argv.slice(separatorIndex + 1) : [];
  const positional = [];
  let starterId = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--starter") {
      starterId = args[index + 1]?.trim() || null;
      if (!starterId) {
        throw new Error("missing value for --starter");
      }
      index += 1;
      continue;
    }
    positional.push(arg);
  }

  const appId = positional[0]?.trim() || null;

  if (positional.length > 1) {
    throw new Error("expected at most one app id before '--'");
  }

  return { help: false, appId, viteArgs, starterId };
}

function validateAppId(appId) {
  if (!appId) {
    throw new Error("app id is required");
  }
  if (appId.includes("/") || appId.includes("\\")) {
    throw new Error("enter only the app id, not apps/<name>");
  }
  if (!appIdPattern.test(appId)) {
    throw new Error("app id must use lowercase letters, numbers, and hyphens only");
  }
}

async function ensureTargetDoesNotExist(appId) {
  const targetDir = join(process.cwd(), "apps", appId);
  try {
    await access(targetDir, constants.F_OK);
    throw new Error(`apps/${appId} already exists`);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

function getStarterById(starterId) {
  const starter = starterOptions.find((option) => option.id === starterId);
  if (!starter) {
    throw new Error(`unknown starter '${starterId}'`);
  }
  return starter;
}

async function selectStarterInteractive() {
  if (!input.isTTY || !output.isTTY) {
    return starterOptions[0];
  }

  const starter = await select({
    message: "Select a starter",
    choices: starterOptions.map((option) => ({
      value: option,
      name: option.label,
      description: option.description,
    })),
  });
  output.write(`[new-app] starter: ${starter.label}\n`);
  return starter;
}

async function pickStarter(starterId, appId, viteArgs) {
  if (starterId) {
    return getStarterById(starterId);
  }

  if (viteArgs.length > 0 || appId) {
    return starterOptions[0];
  }

  return await selectStarterInteractive();
}

async function listExistingAppDirs() {
  const appsRoot = join(process.cwd(), "apps");
  const entries = await readdir(appsRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name);
}

async function suggestAppId(starter) {
  const existing = new Set(await listExistingAppDirs());
  let index = 1;

  while (existing.has(`${starter.appIdBase}-${index}`)) {
    index += 1;
  }

  return `${starter.appIdBase}-${index}`;
}

async function resolveTargetAppId(initialAppId, starter) {
  const appId = initialAppId ?? (await suggestAppId(starter));
  validateAppId(appId);
  await ensureTargetDoesNotExist(appId);
  if (!initialAppId) {
    output.write(`[new-app] generated app id '${appId}'\n`);
  }
  return appId;
}

function hasTemplateArg(viteArgs) {
  return viteArgs.some(
    (arg, index) =>
      arg === "--template" ||
      arg === "-t" ||
      arg.startsWith("--template=") ||
      ((viteArgs[index - 1] === "--template" || viteArgs[index - 1] === "-t") && index > 0),
  );
}

function buildViteArgs(viteArgs) {
  if (hasTemplateArg(viteArgs)) {
    return viteArgs;
  }

  return ["--template", defaultViteTemplate, ...viteArgs];
}

async function rewriteStarterReferences(root, sourceAppId, targetAppId) {
  const entries = await readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") {
        continue;
      }
      await rewriteStarterReferences(fullPath, sourceAppId, targetAppId);
      continue;
    }

    if (!textRewriteExtensions.has(extname(entry.name).toLowerCase())) {
      continue;
    }

    const source = await readFile(fullPath, "utf8");
    if (!source.includes(sourceAppId)) {
      continue;
    }

    await writeFile(fullPath, source.replaceAll(sourceAppId, targetAppId), "utf8");
  }
}

async function copyStarterApp(starter, appId) {
  const sourceRoot = join(process.cwd(), "apps", starter.sourceAppId);
  const targetRoot = join(process.cwd(), "apps", appId);

  await cp(sourceRoot, targetRoot, {
    recursive: true,
    force: false,
  });

  await rm(join(targetRoot, ".softbox", "screenshots"), { recursive: true, force: true });
  await rm(join(targetRoot, ".softbox", "reports"), { recursive: true, force: true });
  await mkdir(join(targetRoot, ".softbox"), { recursive: true });
  await rewriteStarterReferences(targetRoot, starter.sourceAppId, appId);
}

function runCommand({ step, command, args, env, allowFailure = false }) {
  output.write(`[new-app] ${step}\n`);
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env,
    },
    stdio: "inherit",
  });

  return new Promise((resolve, reject) => {
    child.on("error", (error) => {
      reject(
        new Error(`failed to start ${command} ${args.join(" ")}: ${error.message}`),
      );
    });

    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${command} exited from signal ${signal}`));
        return;
      }

      if ((code ?? 0) !== 0) {
        if (allowFailure) {
          resolve({ ok: false, code: code ?? 1 });
          return;
        }
        reject(new Error(`${command} exited with code ${code ?? 1}`));
        return;
      }

      resolve({ ok: true, code: code ?? 0 });
    });
  });
}

function isOpenClawPerAppRoutingEnabled() {
  const agentCommand = process.env.AGENT_COMMAND?.trim() || process.env.CLAUDE_CODE_COMMAND?.trim() || "codex";
  const usesOpenClaw = agentCommand.toLowerCase().startsWith("openclaw");
  const agentIdPrefix = process.env.OPENCLAW_AGENT_ID_PREFIX?.trim() || "";
  return usesOpenClaw && agentIdPrefix.length > 0;
}

function isWorkerRunning() {
  const probe = spawnSync("bash", ["-lc", "pgrep -f 'worker/src/index.ts'"], {
    cwd: process.cwd(),
    stdio: "ignore",
    env: process.env,
  });
  return probe.status === 0;
}

async function main() {
  const { help, appId: initialAppId, viteArgs, starterId } = parseArgs(process.argv.slice(2));
  if (help) {
    printHelp();
    return;
  }

  const starter = await pickStarter(starterId, initialAppId, viteArgs);
  const appId = await resolveTargetAppId(initialAppId, starter);
  const softboxEnv = { APP_ID: appId };

  if (starter.mode === "vite-template") {
    const resolvedViteArgs = viteArgs.length > 0 ? buildViteArgs(viteArgs) : starter.viteArgs;

    await runCommand({
      step: `scaffold apps/${appId} with npm create vite@latest`,
      command: "npm",
      args: [
        "create",
        "vite@latest",
        `apps/${appId}`,
        "--",
        "--no-interactive",
        ...resolvedViteArgs,
      ],
      env: {
        // Skip npm's "Do you wish to install and run ..." confirmation so
        // create-vite runs non-interactively and onboarding can always continue.
        npm_config_yes: "true",
      },
    });

    await runCommand({
      step: `wrap apps/${appId} for Softbox`,
      command: "pnpm",
      args: ["wrap-app", "--", "--path", `apps/${appId}`],
    });
  } else {
    output.write(`[new-app] copy starter ${starter.sourceAppId} -> apps/${appId}\n`);
    await copyStarterApp(starter, appId);
  }

  const doctorResult = await runCommand({
    step: `run doctor for ${appId}`,
    command: "pnpm",
    args: ["run", "doctor"],
    env: softboxEnv,
    allowFailure: true,
  });

  if (!doctorResult.ok) {
    output.write(
      `[new-app] doctor reported blocking issues for '${appId}', continuing to seed anyway\n`,
    );
  }

  await runCommand({
    step: `seed ${appId}`,
    command: "pnpm",
    args: ["seed"],
    env: softboxEnv,
  });

  if (isOpenClawPerAppRoutingEnabled()) {
    await runCommand({
      step: `sync OpenClaw per-app agents`,
      command: "pnpm",
      args: ["worker:openclaw-sync-agents", "--", "--apply"],
    });
  }

  await runCommand({
    step: `select ${appId} as the default shell app`,
    command: "pnpm",
    args: [
      "exec",
      "convex",
      "run",
      "apps:setSelectedApp",
      JSON.stringify({ shellId: defaultShellId, appId }),
    ],
  });

  output.write(
    [
      `[new-app] completed onboarding for '${appId}'`,
      `[new-app] note: APP_ID was only set for this command run.`,
      ...(isOpenClawPerAppRoutingEnabled() && isWorkerRunning()
        ? [
            "[new-app] worker restart recommended: a worker process is already running.",
            "[new-app] restart `pnpm dev:worker` (or `pnpm start`) before submitting the first prompt for this app.",
          ]
        : []),
    ].join("\n") + "\n",
  );
}

main().catch((error) => {
  if (
    error instanceof Error &&
    (error.name === "ExitPromptError" || /SIGINT|force closed the prompt/i.test(error.message))
  ) {
    output.write("[new-app] cancelled\n");
    process.exit(0);
  }
  stderr.write(`[new-app] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
