import { existsSync, readFileSync, readdirSync } from "node:fs";
import { access } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";

export const defaultTemplateId = "default";
export const softboxConfigFileName = "softbox.config.json";

type TemplateConfig = {
  templateId: string;
  label?: string;
  runtime?: string;
};

export type TemplateId = string;

export type RegisteredTemplate = {
  templateId: string;
  label: string;
  runtime: string | null;
  root: string;
  relativeRoot: string;
  configPath: string;
  relativeConfigPath: string;
};

export type TemplateDiscoveryIssue = {
  appDir: string;
  severity: "warning" | "error";
  message: string;
};

function normalizeRelativePath(projectRoot: string, absolutePath: string): string {
  return relative(projectRoot, absolutePath).replaceAll("\\", "/") || absolutePath;
}

function readTemplateConfig(configPath: string): TemplateConfig {
  const parsed = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Config must be a JSON object.");
  }

  const config = parsed as Record<string, unknown>;
  if (typeof config.templateId !== "string" || config.templateId.trim() === "") {
    throw new Error("Missing required string field 'templateId'.");
  }
  if (config.label !== undefined && typeof config.label !== "string") {
    throw new Error("Optional field 'label' must be a string.");
  }
  if (config.runtime !== undefined && typeof config.runtime !== "string") {
    throw new Error("Optional field 'runtime' must be a string.");
  }

  return {
    templateId: config.templateId.trim(),
    label: typeof config.label === "string" ? config.label.trim() : undefined,
    runtime: typeof config.runtime === "string" ? config.runtime.trim() : undefined,
  };
}

export function discoverTemplates(projectRoot: string): {
  templates: RegisteredTemplate[];
  issues: TemplateDiscoveryIssue[];
} {
  const appsRoot = resolve(projectRoot, "apps");
  const issues: TemplateDiscoveryIssue[] = [];
  const templates: RegisteredTemplate[] = [];
  const seenTemplateIds = new Map<string, string>();

  if (!existsSync(appsRoot)) {
    issues.push({
      appDir: "apps",
      severity: "warning",
      message: "The /apps directory does not exist yet.",
    });
    return { templates, issues };
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
            `Run 'pnpm wrap-app -- --path ${relativeRoot} --id <template-id>' ` +
            `for a supported browser-first React/Vite app.`,
        });
      }
      continue;
    }

    let config: TemplateConfig;
    try {
      config = readTemplateConfig(configPath);
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

    const duplicatePath = seenTemplateIds.get(config.templateId);
    if (duplicatePath) {
      issues.push({
        appDir: relativeRoot,
        severity: "error",
        message:
          `Duplicate templateId '${config.templateId}' already registered by '${duplicatePath}'.`,
      });
      continue;
    }

    seenTemplateIds.set(config.templateId, relativeRoot);
    templates.push({
      templateId: config.templateId,
      label: config.label || basename(relativeRoot),
      runtime: config.runtime || null,
      root,
      relativeRoot,
      configPath,
      relativeConfigPath,
    });
  }

  return { templates, issues };
}

export function listTemplates(projectRoot: string): RegisteredTemplate[] {
  return discoverTemplates(projectRoot).templates;
}

function getTemplateRecord(projectRoot: string, templateId: string): RegisteredTemplate {
  const record = listTemplates(projectRoot).find((template) => template.templateId === templateId);
  if (!record) {
    throw new Error(
      `Unknown templateId '${templateId}'. Add '${softboxConfigFileName}' under /apps ` +
        `or run 'pnpm wrap-app -- --path apps/<name> --id <template-id>'.`,
    );
  }
  return record;
}

export function getDefaultTemplateId(projectRoot: string): string {
  return listTemplates(projectRoot)[0]?.templateId ?? defaultTemplateId;
}

export function isTemplateId(value: string, projectRoot = resolve(process.cwd())): value is TemplateId {
  return listTemplates(projectRoot).some((template) => template.templateId === value);
}

export function getTemplateDirName(
  templateId: string,
  projectRoot = resolve(process.cwd()),
): string {
  return getTemplateRecord(projectRoot, templateId).relativeRoot;
}

export function getTemplateLabel(
  templateId: string,
  projectRoot = resolve(process.cwd()),
): string {
  return getTemplateRecord(projectRoot, templateId).label;
}

export function resolveTemplateRoot(projectRoot: string, templateId: string): string {
  return getTemplateRecord(projectRoot, templateId).root;
}

export async function inspectTemplateSource(
  projectRoot: string,
  templateId: string,
): Promise<{
  status: "available" | "missing";
  path: string | null;
  message: string | null;
}> {
  const record = listTemplates(projectRoot).find((template) => template.templateId === templateId);
  if (!record) {
    return {
      status: "missing",
      path: null,
      message:
        `Template '${templateId}' is not registered. ` +
        `Add '${softboxConfigFileName}' under an app in /apps or run ` +
        `'pnpm wrap-app -- --path apps/<name> --id <template-id>'.`,
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
        `Restore them or re-run 'pnpm wrap-app -- --path ${record.relativeRoot} --id ${templateId} --force'.`,
    };
  }
}
