import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { ensureAppTooling } from "../worker/src/appAgents";
import { softboxConfigFileName } from "../worker/src/templates";

type Args = {
  appPath: string;
  force: boolean;
};

type AppInspection = {
  appRoot: string;
  relativeAppRoot: string;
  appImportStatement: string;
  cssImports: string[];
};

const sourceExtensions = [".tsx", ".jsx", ".ts", ".js"];

function parseArgs(argv: string[]): Args {
  const positional = argv.filter((arg) => !arg.startsWith("-"));
  const pathIndex = argv.indexOf("--path");
  const appPath = (pathIndex >= 0 ? argv[pathIndex + 1] : positional[0])?.trim();
  const force = argv.includes("--force");

  if (!appPath) {
    throw new Error("Missing app path. Use --path apps/<name>.");
  }

  return { appPath, force };
}

async function readPackageJson(appRoot: string): Promise<Record<string, unknown> | null> {
  const packageJsonPath = resolve(appRoot, "package.json");
  if (!existsSync(packageJsonPath)) {
    return null;
  }

  return JSON.parse(await readFile(packageJsonPath, "utf8")) as Record<string, unknown>;
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

function buildSoftboxConfigSource(appName: string): string {
  return `${JSON.stringify(
    {
      label: appName,
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

  const entryPath = resolve(inspection.appRoot, "src", "entry.tsx");
  const defaultStatePath = resolve(inspection.appRoot, "src", "defaultState.ts");
  const runtimePath = resolve(inspection.appRoot, "src", "adapter", "runtime.tsx");
  const shellAdapterPath = resolve(inspection.appRoot, "src", "adapter", "shellAdapter.tsx");
  const configPath = resolve(inspection.appRoot, softboxConfigFileName);

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
    buildSoftboxConfigSource(
      inspection.relativeAppRoot.split("/").pop() ?? "app",
    ),
    args.force,
  );
  const tooling = await ensureAppTooling({
    projectRoot,
    appRoot: inspection.appRoot,
    appName: inspection.relativeAppRoot.split("/").pop() ?? "app",
    force: args.force,
  });

  console.log(`[wrap-app] wrapped ${inspection.relativeAppRoot}`);
  console.log(`[wrap-app] wrote ${toRelativePath(projectRoot, entryPath)}`);
  console.log(`[wrap-app] wrote ${toRelativePath(projectRoot, defaultStatePath)}`);
  console.log(`[wrap-app] wrote ${toRelativePath(projectRoot, runtimePath)}`);
  console.log(`[wrap-app] wrote ${toRelativePath(projectRoot, shellAdapterPath)}`);
  console.log(`[wrap-app] wrote ${toRelativePath(projectRoot, configPath)}`);
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
    `[wrap-app] next: run 'pnpm run doctor', then 'pnpm seed' and choose '${inspection.relativeAppRoot.split("/").pop() ?? "app"}' or run 'pnpm seed -- --app ${inspection.relativeAppRoot.split("/").pop() ?? "app"}'`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
