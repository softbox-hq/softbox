import { existsSync, readFileSync, readdirSync } from "node:fs";
import { access } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";

export const defaultWrappedAppId = "vite-default";
export const softboxConfigFileName = "softbox.config.json";

type WrappedAppConfig = {
  label?: string;
  runtime?: string;
  templateId?: string;
};

export type WrappedAppId = string;

export type RegisteredWrappedApp = {
  appId: string;
  label: string;
  runtime: string | null;
  root: string;
  relativeRoot: string;
  configPath: string;
  relativeConfigPath: string;
};

export type WrappedAppDiscoveryIssue = {
  appDir: string;
  severity: "warning" | "error";
  message: string;
};

function normalizeRelativePath(projectRoot: string, absolutePath: string): string {
  return relative(projectRoot, absolutePath).replaceAll("\\", "/") || absolutePath;
}

function readWrappedAppConfig(configPath: string): WrappedAppConfig {
  const parsed = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Config must be a JSON object.");
  }

  const config = parsed as Record<string, unknown>;
  if (config.label !== undefined && typeof config.label !== "string") {
    throw new Error("Optional field 'label' must be a string.");
  }
  if (config.runtime !== undefined && typeof config.runtime !== "string") {
    throw new Error("Optional field 'runtime' must be a string.");
  }
  if (config.templateId !== undefined && typeof config.templateId !== "string") {
    throw new Error("Legacy field 'templateId' must be a string when present.");
  }

  return {
    label: typeof config.label === "string" ? config.label.trim() : undefined,
    runtime: typeof config.runtime === "string" ? config.runtime.trim() : undefined,
    templateId:
      typeof config.templateId === "string" ? config.templateId.trim() : undefined,
  };
}

export function discoverWrappedApps(projectRoot: string): {
  apps: RegisteredWrappedApp[];
  issues: WrappedAppDiscoveryIssue[];
} {
  const appsRoot = resolve(projectRoot, "apps");
  const issues: WrappedAppDiscoveryIssue[] = [];
  const apps: RegisteredWrappedApp[] = [];

  if (!existsSync(appsRoot)) {
    issues.push({
      appDir: "apps",
      severity: "warning",
      message: "The /apps directory does not exist yet.",
    });
    return { apps, issues };
  }

  const entries = readdirSync(appsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const root = resolve(appsRoot, entry.name);
    const relativeRoot = normalizeRelativePath(projectRoot, root);
    const configPath = resolve(root, softboxConfigFileName);
    const relativeConfigPath = normalizeRelativePath(projectRoot, configPath);

    if (!existsSync(configPath)) {
      const hasPackageJson = existsSync(resolve(root, "package.json"));
      const hasSourceDir = existsSync(resolve(root, "src"));
      if (hasPackageJson || hasSourceDir) {
        issues.push({
          appDir: relativeRoot,
          severity: "warning",
          message:
            `App source exists but is not wrapped for Softbox. ` +
            `Run 'pnpm wrap-app -- --path ${relativeRoot}' ` +
            `for a supported browser-first React/Vite app.`,
        });
      }
      continue;
    }

    let config: WrappedAppConfig;
    try {
      config = readWrappedAppConfig(configPath);
    } catch (error) {
      issues.push({
        appDir: relativeRoot,
        severity: "error",
        message:
          `Invalid ${softboxConfigFileName}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    const appId = basename(relativeRoot);
    if (config.templateId && config.templateId !== appId) {
      issues.push({
        appDir: relativeRoot,
        severity: "warning",
        message:
          `Legacy 'templateId' field '${config.templateId}' does not match app id '${appId}'. ` +
          `The worker now uses the app directory name as the only source id and ignores 'templateId'.`,
      });
    }

    apps.push({
      appId,
      label: config.label || appId,
      runtime: config.runtime || null,
      root,
      relativeRoot,
      configPath,
      relativeConfigPath,
    });
  }

  return { apps, issues };
}

export function listWrappedApps(projectRoot: string): RegisteredWrappedApp[] {
  return discoverWrappedApps(projectRoot).apps;
}

function getWrappedAppRecord(projectRoot: string, appId: string): RegisteredWrappedApp {
  const record = listWrappedApps(projectRoot).find((app) => app.appId === appId);
  if (!record) {
    throw new Error(
      `Unknown app id '${appId}'. Add '${softboxConfigFileName}' under /apps/${appId} ` +
        `or run 'pnpm wrap-app -- --path apps/<app-id>'.`,
    );
  }
  return record;
}

export function getDefaultWrappedAppId(projectRoot: string): string {
  const apps = listWrappedApps(projectRoot);
  return (
    apps.find((app) => app.appId === defaultWrappedAppId)?.appId ??
    apps[0]?.appId ??
    defaultWrappedAppId
  );
}

export function isWrappedAppId(
  value: string,
  projectRoot = resolve(process.cwd()),
): value is WrappedAppId {
  return listWrappedApps(projectRoot).some((app) => app.appId === value);
}

export function getWrappedAppDirName(
  appId: string,
  projectRoot = resolve(process.cwd()),
): string {
  return getWrappedAppRecord(projectRoot, appId).relativeRoot;
}

export function getWrappedAppLabel(
  appId: string,
  projectRoot = resolve(process.cwd()),
): string {
  return getWrappedAppRecord(projectRoot, appId).label;
}

export function resolveWrappedAppRoot(projectRoot: string, appId: string): string {
  return getWrappedAppRecord(projectRoot, appId).root;
}

export async function inspectWrappedAppSource(
  projectRoot: string,
  appId: string,
): Promise<{
  status: "available" | "missing";
  path: string | null;
  message: string | null;
}> {
  const record = listWrappedApps(projectRoot).find((app) => app.appId === appId);
  if (!record) {
    return {
      status: "missing",
      path: null,
      message:
        `App '${appId}' is not registered under /apps. ` +
        `Add '${softboxConfigFileName}' under /apps/${appId} or run ` +
        `'pnpm wrap-app -- --path apps/${appId}'.`,
    };
  }

  const entryPath = resolve(record.root, "src", "entry.tsx");
  const defaultStatePath = resolve(record.root, "src", "defaultState.ts");

  try {
    await access(entryPath);
    await access(defaultStatePath);
    return {
      status: "available",
      path: record.relativeRoot,
      message: null,
    };
  } catch {
    return {
      status: "missing",
      path: record.relativeRoot,
      message:
        `Mounted version is still available from previously built artifacts, ` +
        `but the local Softbox runtime files are missing at '${record.relativeRoot}'. ` +
        `Expected 'src/entry.tsx' and 'src/defaultState.ts'. ` +
        `Restore them or re-run 'pnpm wrap-app -- --path ${record.relativeRoot} --force'.`,
    };
  }
}
