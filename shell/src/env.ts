export function getViteEnv(name: string): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env ?? {};
  const value = env[name];
  return typeof value === "string" ? value : "";
}
