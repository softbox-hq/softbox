import type { ServiceHealthStatus } from "./serviceStatus";

export type OpenClawRoutingMode = "shared" | "per_app";
export type OpenClawImageGenerationProvider =
  | "openai"
  | "google"
  | "fal"
  | "minimax"
  | "minimax-portal";

export type OpenClawConfigStatus = {
  agentCommand: string | null;
  gatewayBaseUrl: string | null;
  gatewayTokenConfigured: boolean;
  gatewayMode: string | null;
  gatewayBind: string | null;
  gatewayCustomBindHost: string | null;
  gatewayPort: number | null;
  gatewayTokenSource: string | null;
  routingMode: OpenClawRoutingMode;
  agentId: string | null;
  agentIdPrefix: string | null;
  sessionKeyPrefix: string | null;
  imageGenerationModel: string | null;
  envFilePath: string;
  openClawConfigPath: string;
};

export type OpenClawDeviceStatus = {
  status: ServiceHealthStatus;
  message: string;
  pendingCount: number;
  pairedCount: number;
  pendingScopes: string[];
  pairedScopes: string[];
  rawOutput?: string | null;
};

export type OpenClawOnboardSession = {
  status: "idle" | "running" | "completed" | "failed" | "cancelled";
  startedAt: number | null;
  endedAt: number | null;
  authChoice: string | null;
  command: string | null;
  logs: string[];
  authUrl: string | null;
  awaitingInput: boolean;
  inputPrompt: string | null;
  logFilePath: string | null;
  error: string | null;
  exitCode: number | null;
};

export type OpenClawGatewayRuntime = {
  status: "idle" | "running" | "completed" | "failed" | "cancelled";
  startedAt: number | null;
  endedAt: number | null;
  command: string | null;
  logs: string[];
  error: string | null;
  exitCode: number | null;
};

export type OpenClawImageGenerationStatus = {
  status: ServiceHealthStatus;
  message: string;
  configuredModel: string | null;
  configuredProvider: OpenClawImageGenerationProvider | null;
  authConfigured: boolean;
  authEnvHints: string[];
};

export type OpenClawStatus = {
  checkedAt: number;
  config: OpenClawConfigStatus;
  gateway: {
    status: ServiceHealthStatus;
    message: string;
  };
  devices: OpenClawDeviceStatus;
  imageGeneration: OpenClawImageGenerationStatus;
  gatewayRuntime: OpenClawGatewayRuntime;
  onboardSession: OpenClawOnboardSession;
};
