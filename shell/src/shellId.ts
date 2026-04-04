import { defaultShellId } from "@shared/liveApp";

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
  return generateShellId();
}
