import { randomBytes } from "node:crypto";

export const appSlugPattern = /^[a-z0-9][a-z0-9-]*$/;
export const opaqueAppIdPattern = /^app_[a-z0-9]{8,}$/;

export function isValidAppSlug(value: string): boolean {
  return appSlugPattern.test(value);
}

export function isValidOpaqueAppId(value: string): boolean {
  return opaqueAppIdPattern.test(value);
}

export function normalizeAppSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function defaultAppDisplayNameFromSlug(slug: string): string {
  const parts = normalizeAppSlug(slug)
    .split("-")
    .filter(Boolean);

  if (parts.length === 0) {
    return "Untitled App";
  }

  return parts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function normalizeAppDisplayName(
  value: string | null | undefined,
  fallbackSlug: string,
): string {
  const trimmed = value?.trim() ?? "";
  return trimmed || defaultAppDisplayNameFromSlug(fallbackSlug);
}

export function generateOpaqueAppId(existingIds?: Iterable<string>): string {
  const reserved = new Set(existingIds ?? []);

  for (;;) {
    const candidate = `app_${randomBytes(4).toString("hex")}`;
    if (!reserved.has(candidate)) {
      return candidate;
    }
  }
}
