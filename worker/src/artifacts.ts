export function sharedArtifactKey(appId: string, fileName: string): string {
  return `apps/${appId}/shared/${fileName}`;
}

export function manifestKeyForVersion(
  appId: string,
  versionNumber: number,
): string {
  return `apps/${appId}/v${versionNumber}/manifest.json`;
}
