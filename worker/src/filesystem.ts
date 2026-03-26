import { readFile, readdir } from "node:fs/promises";
import { join, posix, relative, resolve } from "node:path";

export type SourceFile = {
  path: string;
  content: string;
};

export function normalizeSourcePath(path: string): string {
  const normalized = posix.normalize(path).replace(/^\/+/, "");
  if (
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    !normalized.startsWith("src/")
  ) {
    throw new Error(`Invalid editable path: ${path}`);
  }
  return normalized;
}

async function readSourceFiles(root: string): Promise<SourceFile[]> {
  const srcRoot = resolve(root, "src");
  const files: SourceFile[] = [];
  const editableExtensions = new Set([
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".css",
    ".json",
    ".html",
  ]);

  function isEditableSourceFile(path: string): boolean {
    const extension = posix.extname(path).toLowerCase();
    return editableExtensions.has(extension);
  }

  async function walk(currentDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      const relativePath = relative(root, fullPath).split("\\").join("/");
      if (!isEditableSourceFile(relativePath)) {
        continue;
      }
      files.push({
        path: normalizeSourcePath(relativePath),
        content: await readFile(fullPath, "utf8"),
      });
    }
  }

  await walk(srcRoot);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

export async function readLiveAppFiles(liveAppRoot: string): Promise<SourceFile[]> {
  return await readSourceFiles(liveAppRoot);
}
