import { access } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";

export const defaultTemplateId = "threejs";

const templateRoots = {
  threejs: "apps/live-app-template",
  crm: "apps/live-app-template-crm",
  testapp: "apps/test-app",
  testapp2: "apps/test-app-2",
  testapp3: "apps/test-app-3",
} as const;

export type TemplateId = keyof typeof templateRoots;

export function isTemplateId(value: string): value is TemplateId {
  return value in templateRoots;
}

export function getTemplateDirName(templateId: string): string {
  if (!isTemplateId(templateId)) {
    throw new Error(`Unknown templateId '${templateId}'`);
  }
  return templateRoots[templateId];
}

export function getTemplateLabel(templateId: string): string {
  return basename(getTemplateDirName(templateId));
}

export function resolveTemplateRoot(projectRoot: string, templateId: string): string {
  return resolve(projectRoot, getTemplateDirName(templateId));
}

export async function inspectTemplateSource(
  projectRoot: string,
  templateId: string,
): Promise<{
  status: "available" | "missing";
  path: string | null;
  message: string | null;
}> {
  if (!isTemplateId(templateId)) {
    return {
      status: "missing",
      path: null,
      message: `Template '${templateId}' is not registered in worker/src/templates.ts.`,
    };
  }

  const absoluteRoot = resolveTemplateRoot(projectRoot, templateId);
  const relativeRoot = relative(projectRoot, absoluteRoot).replaceAll("\\", "/") || absoluteRoot;
  const entryPath = resolve(absoluteRoot, "src", "entry.tsx");

  try {
    await access(entryPath);
    return {
      status: "available",
      path: relativeRoot,
      message: null,
    };
  } catch {
    return {
      status: "missing",
      path: relativeRoot,
      message:
        `Mounted version is still available from previously built artifacts, ` +
        `but the local source template is missing at '${relativeRoot}'. Restore it before submitting prompts.`,
    };
  }
}
