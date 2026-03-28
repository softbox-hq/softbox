import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

export const appAgentsFileName = "AGENTS.md";
const screenshotScriptPath = "scripts/ui-screenshot.mjs";

function normalizeRelativePath(projectRoot: string, absolutePath: string): string {
  return relative(projectRoot, absolutePath).replaceAll("\\", "/") || absolutePath;
}

export function buildAppAgentsSource(args: {
  appName: string;
  relativeAppRoot: string;
}): string {
  return `# ${args.appName} Agent Guide

Read this file before editing the app.

Also read the repo root AGENTS.md for overall Softbox rules.

App root:

- ${args.relativeAppRoot}

Main editing targets:

- src/App.tsx or src/app.tsx for UI and behavior
- src/index.css and src/App.css for styling
- src/defaultState.ts for seeded runtime state

Softbox runtime bridge:

- src/entry.tsx
- src/adapter/runtime.tsx
- src/adapter/shellAdapter.tsx

Rules:

- Keep this app runnable as a normal React + Vite app.
- Keep the Softbox wrapper thin.
- Prefer app-local changes over shell changes.
- Do not change softbox.config.json unless template/runtime wiring really changed.
- For visual changes, screenshot verification is required even if the user did not ask for it explicitly.
- Do not ask the user whether you should run screenshot verification for visual changes. Just do it.
- Run \`pnpm ui:screenshot\` from this app's package root after visual changes.
- Inspect \`.softbox/screenshots/latest.png\` before finishing UI work.
- Do not finish a visual task until the screenshot command succeeded or you explicitly report why it could not run.
- If the screenshot command fails because Playwright Chromium or browser libraries are missing, run \`pnpm ui:install-browser\` from this app root once.
- If you touch the wrapper, make sure mount/unmount still work and reportHealthy is still called.

When working on visual changes:

1. change the app code
2. run \`pnpm ui:screenshot\` from this app root
3. inspect \`.softbox/screenshots/latest.png\`
4. if needed, iterate on the UI
5. only then finish
`;
}

async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

async function ensureScreenshotPackageScript(args: {
  projectRoot: string;
  appRoot: string;
}): Promise<boolean> {
  const packageJsonPath = resolve(args.appRoot, "package.json");
  if (!existsSync(packageJsonPath)) {
    return false;
  }

  const packageJson = JSON.parse(
    await readFile(packageJsonPath, "utf8"),
  ) as Record<string, unknown>;
  const scripts =
    typeof packageJson.scripts === "object" && packageJson.scripts
      ? { ...(packageJson.scripts as Record<string, string>) }
      : {};
  const scriptPath = normalizeRelativePath(
    args.appRoot,
    resolve(args.projectRoot, screenshotScriptPath),
  );
  const nextScript = `node ${scriptPath}`;
  const installBrowserScript = "pnpm --dir ../.. exec playwright install --with-deps chromium";
  let changed = false;

  if (scripts["ui:screenshot"] !== nextScript) {
    scripts["ui:screenshot"] = nextScript;
    changed = true;
  }
  if (scripts["ui:install-browser"] !== installBrowserScript) {
    scripts["ui:install-browser"] = installBrowserScript;
    changed = true;
  }
  if (!changed) {
    return false;
  }
  packageJson.scripts = scripts;
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
  return true;
}

export async function ensureAppTooling(args: {
  projectRoot: string;
  appRoot: string;
  appName: string;
  force?: boolean;
}): Promise<{
  agentsFilePath: string;
  relativeAgentsFilePath: string;
  wroteAgentsFile: boolean;
  createdWorkspace: boolean;
  updatedPackageScript: boolean;
}> {
  const agentsFile = await ensureAppAgentsFile(args);
  const softboxRoot = resolve(args.appRoot, ".softbox");
  const screenshotsRoot = resolve(softboxRoot, "screenshots");
  const reportsRoot = resolve(softboxRoot, "reports");
  const createdWorkspace =
    !existsSync(softboxRoot) || !existsSync(screenshotsRoot) || !existsSync(reportsRoot);
  await ensureDirectory(screenshotsRoot);
  await ensureDirectory(reportsRoot);
  const updatedPackageScript = await ensureScreenshotPackageScript({
    projectRoot: args.projectRoot,
    appRoot: args.appRoot,
  });

  return {
    agentsFilePath: agentsFile.filePath,
    relativeAgentsFilePath: agentsFile.relativeFilePath,
    wroteAgentsFile: agentsFile.wroteFile,
    createdWorkspace,
    updatedPackageScript,
  };
}

export async function ensureAppAgentsFile(args: {
  projectRoot: string;
  appRoot: string;
  appName: string;
  force?: boolean;
}): Promise<{
  filePath: string;
  relativeFilePath: string;
  wroteFile: boolean;
}> {
  const filePath = resolve(args.appRoot, appAgentsFileName);
  const relativeFilePath = normalizeRelativePath(args.projectRoot, filePath);
  const shouldWrite = args.force || !existsSync(filePath);

  if (shouldWrite) {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      buildAppAgentsSource({
        appName: args.appName,
        relativeAppRoot: normalizeRelativePath(args.projectRoot, args.appRoot),
      }),
      "utf8",
    );
  }

  return {
    filePath,
    relativeFilePath,
    wroteFile: shouldWrite,
  };
}
