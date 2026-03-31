import { StrictMode, useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { initialLiveAppState } from "../defaultState";
import { SoftboxRuntimeProvider, useSoftboxRuntime } from "./runtime";
import App from "../App";

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

function ReadySignal({ onReady }: { onReady: () => void }) {
  useEffect(() => {
    onReady();
  }, [onReady]);

  return null;
}

function RoutePublisher() {
  const { initialState, publishState } = useSoftboxRuntime();
  const location = useLocation();
  const lastPublishedRouteRef = useRef<string | null>(null);

  useEffect(() => {
    const route = location.pathname || "/";
    if (lastPublishedRouteRef.current === route) {
      return;
    }
    lastPublishedRouteRef.current = route;
    publishState({
      ...initialState,
      route,
    });
  }, [initialState, location.pathname, publishState]);

  return null;
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
        <SoftboxRuntimeProvider
          initialState={initialState ?? initialLiveAppState}
          publishState={publishState}
          reportHealthy={reportHealthy}
          reportError={reportError}
        >
          <MemoryRouter initialEntries={[initialState?.route || "/"]}>
            <ReadySignal onReady={reportHealthy} />
            <RoutePublisher />
            <App />
          </MemoryRouter>
        </SoftboxRuntimeProvider>
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
