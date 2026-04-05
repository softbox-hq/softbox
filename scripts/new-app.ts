import { access, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { select } from "@inquirer/prompts";
import { config as loadEnv } from "dotenv";
import { stdin as input, stdout as output, stderr } from "node:process";
import { extname, join, resolve as resolvePath } from "node:path";
import {
  defaultAppDisplayNameFromSlug,
  generateOpaqueAppId,
  isValidOpaqueAppId,
  normalizeAppDisplayName,
  normalizeAppSlug,
} from "../worker/src/appIdentity";
import { discoverWrappedApps } from "../worker/src/templates";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

const defaultViteTemplate = "react-ts";
const starterOptions = [
  {
    id: "blank-react-ts",
    label: "Blank React + TypeScript",
    description: "Create a fresh Vite app with the react-ts starter and wrap it for Softbox.",
    mode: "vite-template" as const,
    appSlugBase: "react-app",
    viteArgs: ["--template", "react-ts"],
  },
  {
    id: "blank-react",
    label: "Blank React + JavaScript",
    description: "Create a fresh Vite app with the react starter and wrap it for Softbox.",
    mode: "vite-template" as const,
    appSlugBase: "react-js-app",
    viteArgs: ["--template", "react"],
  },
  {
    id: "dashboard-example",
    label: "Dashboard Example",
    description: "Copy the bundled Softbox-ready dashboard starter.",
    mode: "copy-starter" as const,
    appSlugBase: "dashboard",
    sourceDirName: "dashboard-example",
  },
  {
    id: "grid-example",
    label: "Grid Example",
    description: "Copy the wrapped grid starter app.",
    mode: "copy-starter" as const,
    appSlugBase: "grid",
    sourceDirName: "grid-example",
  },
  {
    id: "tictactoe-example",
    label: "Tic Tac Toe Example",
    description: "Copy the wrapped tic tac toe starter app.",
    mode: "copy-starter" as const,
    appSlugBase: "tictactoe",
    sourceDirName: "tictactoe-example",
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

type StarterOption = (typeof starterOptions)[number];

type ParsedArgs = {
  help: boolean;
  appId: string | null;
  name: string | null;
  slug: string | null;
  starterId: string | null;
  viteArgs: string[];
};

function printHelp() {
  output.write(
    [
      "Usage:",
      "  pnpm new-app [slug] [--name <display-name>] [--starter <starter-id>] [--app-id <opaque-id>] [-- <vite args...>]",
      "",
      "Examples:",
      "  pnpm new-app",
      "  pnpm new-app my-app",
      "  pnpm new-app my-app --name \"My App\"",
      "  pnpm new-app --starter dashboard-example",
      "  pnpm new-app my-app -- --template react-ts",
      "",
      `Default template: ${defaultViteTemplate}`,
      "Softbox will generate a stable internal app id automatically when one is not supplied.",
      "",
      "Starters:",
      ...starterOptions.map((starter) => `  - ${starter.id}: ${starter.label}`),
    ].join("\n") + "\n",
  );
}

function parseArgs(argv: string[]): ParsedArgs {
  if (argv.includes("--help") || argv.includes("-h")) {
    return { help: true, appId: null, name: null, slug: null, starterId: null, viteArgs: [] };
  }

  const separatorIndex = argv.indexOf("--");
  const args = separatorIndex >= 0 ? argv.slice(0, separatorIndex) : argv;
  const viteArgs = separatorIndex >= 0 ? argv.slice(separatorIndex + 1) : [];
  const positional: string[] = [];
  let starterId: string | null = null;
  let slug: string | null = null;
  let name: string | null = null;
  let appId: string | null = null;

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
    if (arg === "--slug") {
      slug = args[index + 1]?.trim() || null;
      if (!slug) {
        throw new Error("missing value for --slug");
      }
      index += 1;
      continue;
    }
    if (arg === "--name") {
      name = args[index + 1]?.trim() || null;
      if (!name) {
        throw new Error("missing value for --name");
      }
      index += 1;
      continue;
    }
    if (arg === "--app-id") {
      appId = args[index + 1]?.trim() || null;
      if (!appId) {
        throw new Error("missing value for --app-id");
      }
      index += 1;
      continue;
    }
    positional.push(arg);
  }

  const positionalSlug = positional[0]?.trim() || null;
  if (positional.length > 1) {
    throw new Error("expected at most one slug before '--'");
  }
  if (slug && positionalSlug && slug !== positionalSlug) {
    throw new Error("slug was provided twice with different values");
  }

  return {
    help: false,
    appId,
    name,
    slug: slug ?? positionalSlug,
    starterId,
    viteArgs,
  };
}

function validateOpaqueAppId(appId: string) {
  if (!isValidOpaqueAppId(appId)) {
    throw new Error("app id must match the opaque form 'app_<id>'");
  }
}

async function ensureTargetDoesNotExist(slug: string) {
  const targetDir = join(process.cwd(), "apps", slug);
  try {
    await access(targetDir, constants.F_OK);
    throw new Error(`apps/${slug} already exists`);
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

function getStarterById(starterId: string): StarterOption {
  const starter = starterOptions.find((option) => option.id === starterId);
  if (!starter) {
    throw new Error(`unknown starter '${starterId}'`);
  }
  return starter;
}

async function selectStarterInteractive(): Promise<StarterOption> {
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

async function pickStarter(starterId: string | null, slug: string | null, viteArgs: string[]) {
  if (starterId) {
    return getStarterById(starterId);
  }

  if (viteArgs.length > 0 || slug) {
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

async function suggestAppSlug(starter: StarterOption) {
  const existing = new Set(await listExistingAppDirs());
  let index = 1;

  while (existing.has(`${starter.appSlugBase}-${index}`)) {
    index += 1;
  }

  return `${starter.appSlugBase}-${index}`;
}

async function resolveTargetAppSlug(initialSlug: string | null, starter: StarterOption) {
  const explicit = normalizeAppSlug(initialSlug ?? "");
  const slug = explicit || (await suggestAppSlug(starter));
  if (!slug) {
    throw new Error("could not derive a valid app slug");
  }
  await ensureTargetDoesNotExist(slug);
  if (!initialSlug) {
    output.write(`[new-app] generated slug '${slug}'\n`);
  }
  return slug;
}

function hasTemplateArg(viteArgs: string[]) {
  return viteArgs.some(
    (arg, index) =>
      arg === "--template" ||
      arg === "-t" ||
      arg.startsWith("--template=") ||
      ((viteArgs[index - 1] === "--template" || viteArgs[index - 1] === "-t") && index > 0),
  );
}

function buildViteArgs(viteArgs: string[]) {
  if (hasTemplateArg(viteArgs)) {
    return viteArgs;
  }

  return ["--template", defaultViteTemplate, ...viteArgs];
}

async function rewriteStarterReferences(root: string, sourceValue: string, targetValue: string) {
  const entries = await readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") {
        continue;
      }
      await rewriteStarterReferences(fullPath, sourceValue, targetValue);
      continue;
    }

    if (!textRewriteExtensions.has(extname(entry.name).toLowerCase())) {
      continue;
    }

    const source = await readFile(fullPath, "utf8");
    if (!source.includes(sourceValue)) {
      continue;
    }

    await writeFile(fullPath, source.replaceAll(sourceValue, targetValue), "utf8");
  }
}

async function copyStarterApp(starter: Extract<StarterOption, { mode: "copy-starter" }>, slug: string) {
  const sourceRoot = join(process.cwd(), "apps", starter.sourceDirName);
  const targetRoot = join(process.cwd(), "apps", slug);

  await cp(sourceRoot, targetRoot, {
    recursive: true,
    force: false,
  });

  await rm(join(targetRoot, ".softbox", "screenshots"), { recursive: true, force: true });
  await rm(join(targetRoot, ".softbox", "reports"), { recursive: true, force: true });
  await mkdir(join(targetRoot, ".softbox"), { recursive: true });
  await rewriteStarterReferences(targetRoot, starter.sourceDirName, slug);
}

function runCommand(args: {
  step: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  allowFailure?: boolean;
}) {
  output.write(`[new-app] ${args.step}\n`);
  const child = spawn(args.command, args.args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...(args.env ?? {}),
    },
    stdio: "inherit",
  });

  return new Promise<{ ok: boolean; code: number }>((resolve, reject) => {
    child.on("error", (error) => {
      reject(
        new Error(`failed to start ${args.command} ${args.args.join(" ")}: ${error.message}`),
      );
    });

    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${args.command} exited from signal ${signal}`));
        return;
      }

      if ((code ?? 0) !== 0) {
        if (args.allowFailure) {
          resolve({ ok: false, code: code ?? 1 });
          return;
        }
        reject(new Error(`${args.command} exited with code ${code ?? 1}`));
        return;
      }

      resolve({ ok: true, code: code ?? 0 });
    });
  });
}

function isOpenClawPerAppRoutingEnabled() {
  const agentCommand = process.env.AGENT_COMMAND?.trim() || process.env.CLAUDE_CODE_COMMAND?.trim() || "codex";
  const usesOpenClaw = agentCommand.toLowerCase().startsWith("openclaw");
  const sharedAgentId = process.env.OPENCLAW_AGENT_ID?.trim() || "";
  const rawAgentIdPrefix = process.env.OPENCLAW_AGENT_ID_PREFIX?.trim() || "";
  const agentIdPrefix = sharedAgentId
    ? ""
    : rawAgentIdPrefix && rawAgentIdPrefix !== "softbox-"
      ? rawAgentIdPrefix
      : `softbox-${createHash("sha256").update(resolvePath(process.cwd())).digest("hex").slice(0, 8)}-`;
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
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    printHelp();
    return;
  }

  const starter = await pickStarter(parsed.starterId, parsed.slug, parsed.viteArgs);
  const slug = await resolveTargetAppSlug(parsed.slug, starter);
  const appId =
    parsed.appId?.trim() ||
    generateOpaqueAppId(discoverWrappedApps(resolvePath(process.cwd())).apps.map((app) => app.appId));
  validateOpaqueAppId(appId);
  const appName = normalizeAppDisplayName(parsed.name, slug);
  const softboxEnv = { APP_ID: appId };

  if (starter.mode === "vite-template") {
    const resolvedViteArgs = parsed.viteArgs.length > 0 ? buildViteArgs(parsed.viteArgs) : starter.viteArgs;

    await runCommand({
      step: `scaffold apps/${slug} with npm create vite@latest`,
      command: "npm",
      args: [
        "create",
        "vite@latest",
        `apps/${slug}`,
        "--",
        "--no-interactive",
        ...resolvedViteArgs,
      ],
      env: {
        npm_config_yes: "true",
      },
    });
  } else {
    output.write(`[new-app] copy starter ${starter.sourceDirName} -> apps/${slug}\n`);
    await copyStarterApp(starter, slug);
  }

  await runCommand({
    step: `wrap apps/${slug} for Softbox`,
    command: "pnpm",
    args: [
      "wrap-app",
      "--",
      "--path",
      `apps/${slug}`,
      "--app-id",
      appId,
      "--slug",
      slug,
      "--name",
      appName,
      ...(starter.mode === "copy-starter" ? ["--force"] : []),
    ],
  });

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
    args: ["seed", "--", "--app", appId],
  });

  if (isOpenClawPerAppRoutingEnabled()) {
    await runCommand({
      step: "sync OpenClaw per-app agents",
      command: "pnpm",
      args: ["worker:openclaw-sync-agents", "--", "--apply"],
    });
  }

  output.write(
    [
      `[new-app] completed onboarding for '${appName}'`,
      `[new-app] app id: ${appId}`,
      `[new-app] slug: ${slug}`,
      `[new-app] source: apps/${slug}`,
      `[new-app] note: APP_ID was only set for the doctor step in this command run.`,
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
