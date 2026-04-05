import { liveAppStateSchema } from "@shared/liveApp";

export type AgentResult = {
  summary: string;
  changed_files: string[];
  notes?: string;
};

type AppSelectionRecord = {
  appId: string;
};

type ShellSelectionRecord = {
  selectedAppId: string | null;
} | null | undefined;

export function parseStateJson(value: string | null) {
  if (!value) return null;
  try {
    return liveAppStateSchema.parse(JSON.parse(value));
  } catch {
    return null;
  }
}

export function resolveMountedAppId(
  apps: AppSelectionRecord[] | undefined,
  shellSelection: ShellSelectionRecord,
  previousMountedAppId: string | null = null,
) {
  if (shellSelection === undefined) {
    return previousMountedAppId;
  }

  const selectedAppId = shellSelection?.selectedAppId ?? null;
  if (!selectedAppId) {
    return null;
  }
  if (apps === undefined) {
    return selectedAppId;
  }
  if (apps.some((app) => app.appId === selectedAppId)) {
    return selectedAppId;
  }
  return previousMountedAppId === selectedAppId ? selectedAppId : null;
}

export function getRuntimeStatus(shellState: any): {
  title: string;
  body: string;
} | null {
  if (shellState === undefined) {
    return {
      title: "Getting things ready",
      body: "Loading the shell workspace and checking for available apps.",
    };
  }

  if (shellState === null) {
    return {
      title: "No app available yet",
      body: "This shell does not have a live app ready to mount yet.",
    };
  }

  if (!shellState.activeVersion) {
    return {
      title: "No live version yet",
      body: "This app exists, but there is no active live version to render yet.",
    };
  }

  if (shellState.lastRuntimeError) {
    return {
      title: "Runtime Error",
      body: shellState.lastRuntimeError,
    };
  }

  return null;
}

export function getLatestAgentResult(shellState: any): AgentResult | null {
  if (shellState?.latestCompletedJob) {
    return shellState.latestCompletedJob.agentResult ?? null;
  }

  return (
    shellState?.activeVersion?.agentResult ??
    shellState?.nextReadyVersion?.agentResult ??
    null
  );
}
