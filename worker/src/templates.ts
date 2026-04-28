import { existsSync, readFileSync, readdirSync } from "node:fs";
import { access } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";
import {
  defaultAppDisplayNameFromSlug,
  isValidAppSlug,
  isValidOpaqueAppId,
  normalizeAppSlug,
} from "./appIdentity";

export const defaultWrappedAppId = "vite-default";
export const softboxConfigFileName = "softbox.config.json";

type WrappedAppConfig = {
  appId?: string;
  slug?: string;
  name?: string;
  label?: string;
  icon?: string;
  runtime?: string;
  templateId?: string;
};

export type WrappedAppId = string;

export type RegisteredWrappedApp = {
  appId: string;
  slug: string;
  label: string;
  iconPath: string | null;
  relativeIconPath: string | null;
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
  if (config.appId !== undefined && typeof config.appId !== "string") {
    throw new Error("Optional field 'appId' must be a string.");
  }
  if (config.slug !== undefined && typeof config.slug !== "string") {
    throw new Error("Optional field 'slug' must be a string.");
  }
  if (config.name !== undefined && typeof config.name !== "string") {
    throw new Error("Optional field 'name' must be a string.");
  }
  if (config.label !== undefined && typeof config.label !== "string") {
    throw new Error("Optional field 'label' must be a string.");
  }
  if (config.icon !== undefined && typeof config.icon !== "string") {
    throw new Error("Optional field 'icon' must be a string.");
  }
  if (config.runtime !== undefined && typeof config.runtime !== "string") {
    throw new Error("Optional field 'runtime' must be a string.");
  }
  if (config.templateId !== undefined && typeof config.templateId !== "string") {
    throw new Error("Legacy field 'templateId' must be a string when present.");
  }

  const appId = typeof config.appId === "string" ? config.appId.trim() : undefined;
  if (appId !== undefined && appId.length > 0 && !isValidOpaqueAppId(appId)) {
    throw new Error("Optional field 'appId' must match the opaque form 'app_<id>'.");
  }

  const rawSlug = typeof config.slug === "string" ? config.slug.trim() : undefined;
  const slug = rawSlug !== undefined ? normalizeAppSlug(rawSlug) : undefined;
  if (rawSlug !== undefined && (!slug || !isValidAppSlug(slug))) {
    throw new Error("Optional field 'slug' must use lowercase letters, numbers, and hyphens only.");
  }

  return {
    appId: appId && appId.length > 0 ? appId : undefined,
    slug: slug && slug.length > 0 ? slug : undefined,
    name: typeof config.name === "string" ? config.name.trim() : undefined,
    label: typeof config.label === "string" ? config.label.trim() : undefined,
    icon: typeof config.icon === "string" ? config.icon.trim() : undefined,
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
  const seenAppIds = new Set<string>();
  const seenSlugs = new Set<string>();

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

    const dirName = basename(relativeRoot);
    const appId = config.appId || dirName;
    const slug = config.slug || normalizeAppSlug(dirName) || dirName;
    const label = config.name || config.label || defaultAppDisplayNameFromSlug(slug);
    const iconRelativePath = config.icon?.replaceAll("\\", "/") || null;
    const iconPath = iconRelativePath ? resolve(root, iconRelativePath) : null;
    if (iconPath && iconPath !== root && !iconPath.startsWith(`${root}${sep}`)) {
      issues.push({
        appDir: relativeRoot,
        severity: "error",
        message: `Configured icon '${iconRelativePath}' must stay inside '${relativeRoot}'.`,
      });
      continue;
    }
    if (iconPath && !existsSync(iconPath)) {
      issues.push({
        appDir: relativeRoot,
        severity: "warning",
        message: `Configured icon '${iconRelativePath}' does not exist.`,
      });
    }
    const existingIconPath = iconPath && existsSync(iconPath) ? iconPath : null;
    if (config.templateId && config.templateId !== appId) {
      issues.push({
        appDir: relativeRoot,
        severity: "warning",
        message:
          `Legacy 'templateId' field '${config.templateId}' does not match app id '${appId}'. ` +
          `The worker now uses the explicit 'appId' field when present and ignores 'templateId'.`,
      });
    }

    if (seenAppIds.has(appId)) {
      issues.push({
        appDir: relativeRoot,
        severity: "error",
        message: `Duplicate app id '${appId}' found in ${softboxConfigFileName}.`,
      });
      continue;
    }

    if (seenSlugs.has(slug)) {
      issues.push({
        appDir: relativeRoot,
        severity: "error",
        message: `Duplicate slug '${slug}' found in ${softboxConfigFileName}.`,
      });
      continue;
    }

    seenAppIds.add(appId);
    seenSlugs.add(slug);

    apps.push({
      appId,
      slug,
      label,
      iconPath: existingIconPath,
      relativeIconPath: existingIconPath ? normalizeRelativePath(projectRoot, existingIconPath) : null,
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
      `Unknown app id '${appId}'. Add '${softboxConfigFileName}' under /apps/<folder> ` +
        `with a matching "appId", or run 'pnpm wrap-app -- --path apps/<folder>'.`,
    );
  }
  return record;
}

export function getWrappedApp(projectRoot: string, appId: string): RegisteredWrappedApp {
  return getWrappedAppRecord(projectRoot, appId);
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

export function getWrappedAppSlug(
  appId: string,
  projectRoot = resolve(process.cwd()),
): string {
  return getWrappedAppRecord(projectRoot, appId).slug;
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
        `Add '${softboxConfigFileName}' under an app folder with a matching "appId" or run ` +
        `'pnpm wrap-app -- --path apps/<folder>'.`,
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
