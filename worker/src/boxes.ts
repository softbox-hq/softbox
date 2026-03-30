export type BoxStatus = "unknown" | "ready" | "running" | "error";

export type BoxPolicy = {
  transport?: string | null;
  routingMode?: string | null;
  workspaceIsolation?: string | null;
  sessionKeyPrefix?: string | null;
  role?: string | null;
  instructions?: string | null;
  readOnly?: boolean;
  proposalOnly?: boolean;
  canPromote?: boolean;
};

function readTrimmed(value: string | null | undefined): string | null {
  const nextValue = value?.trim() ?? "";
  return nextValue ? nextValue : null;
}

export function buildBoxId(engine: string, subjectId: string): string {
  return `${engine}:${subjectId}`;
}

export function inferProviderFromModel(model: string | null | undefined): string | null {
  const normalized = readTrimmed(model);
  if (!normalized) {
    return null;
  }
  const separatorIndex = normalized.indexOf("/");
  return separatorIndex > 0 ? normalized.slice(0, separatorIndex) : null;
}
