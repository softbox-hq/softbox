import { createContext, useContext, type ReactNode } from "react";
import { initialLiveAppState } from "../defaultState";

type RuntimeErrorPayload = {
  message: string;
  stack?: string;
};

type SoftboxRuntimeValue = {
  initialState: typeof initialLiveAppState;
  publishState(next: typeof initialLiveAppState): void;
  reportHealthy(): void;
  reportError(error: RuntimeErrorPayload): void;
};

const defaultRuntimeValue: SoftboxRuntimeValue = {
  initialState: initialLiveAppState,
  publishState() {
    // Standalone mode does not publish state back into Softbox.
  },
  reportHealthy() {
    // Standalone mode does not report health back into Softbox.
  },
  reportError(error) {
    console.error(error);
  },
};

const SoftboxRuntimeContext = createContext<SoftboxRuntimeValue>(defaultRuntimeValue);

type SoftboxRuntimeProviderProps = SoftboxRuntimeValue & {
  children: ReactNode;
};

export function SoftboxRuntimeProvider({
  children,
  initialState,
  publishState,
  reportHealthy,
  reportError,
}: SoftboxRuntimeProviderProps) {
  return (
    <SoftboxRuntimeContext.Provider
      value={{
        initialState,
        publishState,
        reportHealthy,
        reportError,
      }}
    >
      {children}
    </SoftboxRuntimeContext.Provider>
  );
}

export function useSoftboxRuntime() {
  return useContext(SoftboxRuntimeContext);
}
