import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { ensureAppTooling } from "../worker/src/appAgents";
import {
  defaultAppDisplayNameFromSlug,
  generateOpaqueAppId,
  isValidAppSlug,
  isValidOpaqueAppId,
  normalizeAppDisplayName,
  normalizeAppSlug,
} from "../worker/src/appIdentity";
import { discoverWrappedApps, softboxConfigFileName } from "../worker/src/templates";

type Args = {
  appPath: string;
  appId: string | null;
  force: boolean;
  name: string | null;
  slug: string | null;
};

type AppInspection = {
  appRoot: string;
  relativeAppRoot: string;
  appImportStatement: string;
  cssImports: string[];
};

const sourceExtensions = [".tsx", ".jsx", ".ts", ".js"];

function readOption(argv: string[], name: string): string | null {
  const optionIndex = argv.indexOf(name);
  if (optionIndex < 0) {
    return null;
  }

  const value = argv[optionIndex + 1]?.trim();
  if (!value) {
    throw new Error(`Missing value for ${name}.`);
  }

  return value;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--path" || arg === "--app-id" || arg === "--name" || arg === "--slug") {
      index += 1;
      continue;
    }
    if (!arg.startsWith("-")) {
      positional.push(arg);
    }
  }
  const pathIndex = argv.indexOf("--path");
  const appPath = (pathIndex >= 0 ? argv[pathIndex + 1] : positional[0])?.trim();
  const appId = readOption(argv, "--app-id");
  const force = argv.includes("--force");
  const name = readOption(argv, "--name");
  const slug = readOption(argv, "--slug");

  if (!appPath) {
    throw new Error("Missing app path. Use --path apps/<name>.");
  }

  return { appPath, appId, force, name, slug };
}

async function readPackageJson(appRoot: string): Promise<Record<string, unknown> | null> {
  const packageJsonPath = resolve(appRoot, "package.json");
  if (!existsSync(packageJsonPath)) {
    return null;
  }

  return JSON.parse(await readFile(packageJsonPath, "utf8")) as Record<string, unknown>;
}

async function readExistingSoftboxConfig(appRoot: string): Promise<Record<string, unknown> | null> {
  const configPath = resolve(appRoot, softboxConfigFileName);
  if (!existsSync(configPath)) {
    return null;
  }

  try {
    return JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function toRelativePath(projectRoot: string, absolutePath: string): string {
  return relative(projectRoot, absolutePath).replaceAll("\\", "/") || absolutePath;
}

async function findFirstExistingFile(root: string, candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    const filePath = resolve(root, candidate);
    if (existsSync(filePath)) {
      return filePath;
    }
  }
  return null;
}

function resolveImportPath(fromDirectory: string, absoluteFilePath: string): string {
  const relativePath = relative(fromDirectory, absoluteFilePath).replaceAll("\\", "/");
  const withoutExtension = relativePath.replace(/\.(tsx|jsx|ts|js)$/, "");
  return withoutExtension.startsWith(".") ? withoutExtension : `./${withoutExtension}`;
}

function detectAppImport(appFilePath: string, shellAdapterPath: string, source: string): string {
  const importPath = resolveImportPath(dirname(shellAdapterPath), appFilePath);
  if (/export\s+default\b/.test(source)) {
    return `import App from "${importPath}";`;
  }
  if (/\bexport\s+(function|const|class)\s+App\b/.test(source) || /\bexport\s*\{\s*App\b/.test(source)) {
    return `import { App } from "${importPath}";`;
  }
  throw new Error(
    "Could not determine how to import the app root. Expected a default export or named 'App' export.",
  );
}

async function inspectApp(projectRoot: string, args: Args): Promise<AppInspection> {
  const appsRoot = resolve(projectRoot, "apps");
  const appRoot = resolve(projectRoot, args.appPath);
  const relativeAppRoot = toRelativePath(projectRoot, appRoot);

  if (!relativeAppRoot.startsWith("apps/")) {
    throw new Error("The app path must live under /apps.");
  }
  if (!existsSync(appRoot)) {
    throw new Error(`App path does not exist: ${relativeAppRoot}`);
  }

  const packageJson = await readPackageJson(appRoot);
  const dependencyRecord = {
    ...(typeof packageJson?.dependencies === "object" && packageJson.dependencies
      ? (packageJson.dependencies as Record<string, unknown>)
      : {}),
    ...(typeof packageJson?.devDependencies === "object" && packageJson.devDependencies
      ? (packageJson.devDependencies as Record<string, unknown>)
      : {}),
  };

  if ("next" in dependencyRecord) {
    throw new Error(
      `Next.js app detected at '${relativeAppRoot}'. ` +
        `pnpm wrap-app currently supports browser-first React/Vite apps, not Next.js runtime apps.`,
    );
  }

  const mainFilePath = await findFirstExistingFile(
    appRoot,
    sourceExtensions.map((extension) => `src/main${extension}`),
  );
  const appFilePath = await findFirstExistingFile(
    appRoot,
    [
      ...sourceExtensions.map((extension) => `src/App${extension}`),
      ...sourceExtensions.map((extension) => `src/app${extension}`),
    ],
  );

  if (!mainFilePath || !appFilePath) {
    throw new Error(
      `Expected a Vite-style app with 'src/main.*' and 'src/App.*'. ` +
        `Current wrap-app support is limited to that shape.`,
    );
  }

  const mainSource = await readFile(mainFilePath, "utf8");
  const appSource = await readFile(appFilePath, "utf8");
  const shellAdapterPath = resolve(appRoot, "src", "adapter", "shellAdapter.tsx");

  const cssImports = Array.from(
    mainSource.matchAll(/^\s*import\s+["'](.+\.css)["'];?\s*$/gm),
    (match) => match[1],
  )
    .filter((importPath) => importPath.startsWith("."))
    .map((importPath) => {
      const absoluteImport = resolve(dirname(mainFilePath), importPath);
      return resolveImportPath(resolve(appRoot, "src"), absoluteImport);
    });

  return {
    appRoot,
    relativeAppRoot,
    appImportStatement: detectAppImport(appFilePath, shellAdapterPath, appSource),
    cssImports,
  };
}

function buildEntrySource(cssImports: string[]): string {
  const styleImports = cssImports.map((importPath) => `import "${importPath}";`).join("\n");
  const styleBlock = styleImports ? `${styleImports}\n\n` : "";
  return `${styleBlock}export { initialLiveAppState } from "./defaultState";
export { mount, unmount } from "./adapter/shellAdapter";
`;
}

function buildDefaultStateSource(): string {
  return `export const initialLiveAppState = {
  route: "/",
  selection: null,
  ui: {},
};
`;
}

function buildRuntimeSource(): string {
  return `import { createContext, useContext, type ReactNode } from "react";
import { initialLiveAppState } from "../defaultState";

type RuntimeErrorPayload = {
  message: string;
  stack?: string;
};

type SoftboxRuntimeValue = {
  initialState: typeof initialLiveAppState;
  publishState(next: typeof initialLiveAppState): void;
  reportHealthy(): void;
  reportError(error: RuntimeErrorPayload): void;
};

const defaultRuntimeValue: SoftboxRuntimeValue = {
  initialState: initialLiveAppState,
  publishState() {
    // App code can opt into publishing state later.
  },
  reportHealthy() {
    // The shell adapter reports health by default.
  },
  reportError(error) {
    console.error(error);
  },
};

const SoftboxRuntimeContext = createContext<SoftboxRuntimeValue>(defaultRuntimeValue);

type SoftboxRuntimeProviderProps = SoftboxRuntimeValue & {
  children: ReactNode;
};

export function SoftboxRuntimeProvider({
  children,
  initialState,
  publishState,
  reportHealthy,
  reportError,
}: SoftboxRuntimeProviderProps) {
  return (
    <SoftboxRuntimeContext.Provider
      value={{
        initialState,
        publishState,
        reportHealthy,
        reportError,
      }}
    >
      {children}
    </SoftboxRuntimeContext.Provider>
  );
}

export function useSoftboxRuntime() {
  return useContext(SoftboxRuntimeContext);
}
`;
}

function buildShellAdapterSource(appImportStatement: string): string {
  return `import { StrictMode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { initialLiveAppState } from "../defaultState";
import { SoftboxRuntimeProvider } from "./runtime";
${appImportStatement}

type RuntimeErrorPayload = {
  message: string;
  stack?: string;
};

type MountContext = {
  root: HTMLElement;
  initialState: typeof initialLiveAppState;
  publishState(next: typeof initialLiveAppState): void;
  reportHealthy(): void;
  reportError(error: RuntimeErrorPayload): void;
};

let activeRoot: Root | null = null;

function toRuntimeErrorPayload(error: unknown): RuntimeErrorPayload {
  return {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  };
}

function ReadySignal({ onReady }: { onReady: () => void }) {
  useEffect(() => {
    onReady();
  }, [onReady]);

  return null;
}

export function mount({
  root,
  initialState,
  publishState,
  reportHealthy,
  reportError,
}: MountContext) {
  root.innerHTML = "";
  activeRoot?.unmount();
  activeRoot = createRoot(root, {
    onRecoverableError(error) {
      reportError(toRuntimeErrorPayload(error));
    },
  });

  try {
    activeRoot.render(
      <StrictMode>
        <SoftboxRuntimeProvider
          initialState={initialState ?? initialLiveAppState}
          publishState={publishState}
          reportHealthy={reportHealthy}
          reportError={reportError}
        >
          <ReadySignal onReady={reportHealthy} />
          <App />
        </SoftboxRuntimeProvider>
      </StrictMode>,
    );
  } catch (error) {
    reportError(toRuntimeErrorPayload(error));
    throw error;
  }
}

export function unmount() {
  activeRoot?.unmount();
  activeRoot = null;
}
`;
}

function buildSoftboxConfigSource(args: {
  appId: string;
  name: string;
  slug: string;
}): string {
  return `${JSON.stringify(
    {
      appId: args.appId,
      name: args.name,
      slug: args.slug,
      runtime: "react-vite",
    },
    null,
    2,
  )}\n`;
}

async function writeFileUnlessPresent(
  filePath: string,
  content: string,
  force: boolean,
): Promise<void> {
  if (existsSync(filePath) && !force) {
    throw new Error(
      `Refusing to overwrite '${filePath}'. Re-run with --force if you want to replace existing wrapper files.`,
    );
  }
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = resolve(process.cwd());
  const inspection = await inspectApp(projectRoot, args);
  const folderName = inspection.relativeAppRoot.split("/").pop() ?? "app";
  const normalizedFolderSlug = normalizeAppSlug(folderName);

  const entryPath = resolve(inspection.appRoot, "src", "entry.tsx");
  const defaultStatePath = resolve(inspection.appRoot, "src", "defaultState.ts");
  const runtimePath = resolve(inspection.appRoot, "src", "adapter", "runtime.tsx");
  const shellAdapterPath = resolve(inspection.appRoot, "src", "adapter", "shellAdapter.tsx");
  const configPath = resolve(inspection.appRoot, softboxConfigFileName);
  const existingConfig = await readExistingSoftboxConfig(inspection.appRoot);
  const wrappedApps = discoverWrappedApps(projectRoot).apps.filter((app) => app.root !== inspection.appRoot);
  const existingAppIds = new Set(wrappedApps.map((app) => app.appId));
  const nextAppId = args.appId?.trim() || String(existingConfig?.appId ?? "").trim() || generateOpaqueAppId(existingAppIds);
  const nextSlug =
    normalizeAppSlug(args.slug?.trim() || String(existingConfig?.slug ?? "").trim() || normalizedFolderSlug);
  const nextName = normalizeAppDisplayName(
    args.name?.trim() || String(existingConfig?.name ?? existingConfig?.label ?? "").trim(),
    nextSlug || normalizedFolderSlug || "app",
  );

  if (!isValidOpaqueAppId(nextAppId)) {
    throw new Error(`App id '${nextAppId}' must match the opaque form 'app_<id>'.`);
  }
  if (existingAppIds.has(nextAppId)) {
    throw new Error(`App id '${nextAppId}' is already registered in another wrapped app.`);
  }
  if (!nextSlug || !isValidAppSlug(nextSlug)) {
    throw new Error("Slug must use lowercase letters, numbers, and hyphens only.");
  }
  if (wrappedApps.some((app) => app.slug === nextSlug)) {
    throw new Error(`Slug '${nextSlug}' is already registered in another wrapped app.`);
  }

  await writeFileUnlessPresent(entryPath, buildEntrySource(inspection.cssImports), args.force);
  await writeFileUnlessPresent(defaultStatePath, buildDefaultStateSource(), args.force);
  await writeFileUnlessPresent(runtimePath, buildRuntimeSource(), args.force);
  await writeFileUnlessPresent(
    shellAdapterPath,
    buildShellAdapterSource(inspection.appImportStatement),
    args.force,
  );
  await writeFileUnlessPresent(
    configPath,
    buildSoftboxConfigSource({
      appId: nextAppId,
      name: nextName || defaultAppDisplayNameFromSlug(nextSlug),
      slug: nextSlug,
    }),
    args.force,
  );
  const tooling = await ensureAppTooling({
    projectRoot,
    appRoot: inspection.appRoot,
    appName: nextName || defaultAppDisplayNameFromSlug(nextSlug),
    force: args.force,
  });

  console.log(`[wrap-app] wrapped ${inspection.relativeAppRoot}`);
  console.log(`[wrap-app] wrote ${toRelativePath(projectRoot, entryPath)}`);
  console.log(`[wrap-app] wrote ${toRelativePath(projectRoot, defaultStatePath)}`);
  console.log(`[wrap-app] wrote ${toRelativePath(projectRoot, runtimePath)}`);
  console.log(`[wrap-app] wrote ${toRelativePath(projectRoot, shellAdapterPath)}`);
  console.log(`[wrap-app] wrote ${toRelativePath(projectRoot, configPath)}`);
  console.log(`[wrap-app] app id ${nextAppId}`);
  console.log(`[wrap-app] slug ${nextSlug}`);
  console.log(`[wrap-app] name ${nextName || defaultAppDisplayNameFromSlug(nextSlug)}`);
  if (tooling.wroteAgentsFile) {
    console.log(`[wrap-app] wrote ${tooling.relativeAgentsFilePath}`);
  }
  if (tooling.createdWorkspace) {
    console.log(`[wrap-app] created ${toRelativePath(projectRoot, resolve(inspection.appRoot, ".softbox"))}`);
  }
  if (tooling.updatedPackageScript) {
    console.log(`[wrap-app] updated ${toRelativePath(projectRoot, resolve(inspection.appRoot, "package.json"))} with ui:screenshot`);
  }
  console.log(
    `[wrap-app] next: run 'pnpm run doctor', then 'pnpm seed -- --app ${nextAppId} --force'`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
