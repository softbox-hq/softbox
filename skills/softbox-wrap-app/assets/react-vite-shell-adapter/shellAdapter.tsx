import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { initialLiveAppState } from "../defaultState";
import { App } from "../App";

type RuntimeErrorPayload = {
  message: string;
  stack?: string;
};

type MountContext = {
  root: HTMLElement;
  initialState: typeof initialLiveAppState;
  publishState(next: typeof initialLiveAppState): void;
  reportHealthy(): void;
  reportError(error: RuntimeErrorPayload): void;
};

let activeRoot: Root | null = null;

function toRuntimeErrorPayload(error: unknown): RuntimeErrorPayload {
  return {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  };
}

export function mount({
  root,
  initialState,
  publishState,
  reportHealthy,
  reportError,
}: MountContext) {
  root.innerHTML = "";
  activeRoot?.unmount();
  activeRoot = createRoot(root, {
    onRecoverableError(error) {
      reportError(toRuntimeErrorPayload(error));
    },
  });

  try {
    activeRoot.render(
      <StrictMode>
        <App
          initialState={initialState ?? initialLiveAppState}
          publishState={publishState}
          onReady={reportHealthy}
        />
      </StrictMode>,
    );
  } catch (error) {
    reportError(toRuntimeErrorPayload(error));
    throw error;
  }
}

export function unmount() {
  activeRoot?.unmount();
  activeRoot = null;
}
