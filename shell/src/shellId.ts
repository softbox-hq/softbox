import { defaultShellId } from "@shared/liveApp";

const sessionStorageKey = "softbox:shell-id";

function generateShellId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `shell-${crypto.randomUUID()}`;
  }
  return `shell-${Math.random().toString(36).slice(2, 10)}`;
}

export function getOrCreateShellId(): string {
  if (typeof window === "undefined") {
    return defaultShellId;
  }

  try {
    const existing = window.sessionStorage.getItem(sessionStorageKey);
    if (existing) {
      return existing;
    }

    const shellId = generateShellId();
    window.sessionStorage.setItem(sessionStorageKey, shellId);
    return shellId;
  } catch {
    return defaultShellId;
  }
}
