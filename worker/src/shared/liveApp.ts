import { z } from "zod";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export const liveAppStateSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(liveAppStateSchema), z.record(z.string(), liveAppStateSchema)]),
);

export type LiveAppState = JsonValue;

export type RuntimeErrorPayload = {
  message: string;
  stack?: string;
};

export type LiveAppMountContext = {
  root: HTMLElement;
  initialState: LiveAppState;
  publishState(next: LiveAppState): void;
  reportHealthy(): void;
  reportError(error: RuntimeErrorPayload): void;
};

export type LiveAppModule = {
  mount(ctx: LiveAppMountContext): Promise<void> | void;
  unmount(): Promise<void> | void;
};

export const defaultAppId = "vite-default";
export const defaultShellId = "main";
export const liveAppStateSchemaVersion = 1;
export const runtimeHealthTimeoutMs = 4_000;
