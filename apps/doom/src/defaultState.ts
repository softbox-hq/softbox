export const initialLiveAppState = {
  status: "idle" as "idle" | "loading" | "running" | "error",
  wadName: null as string | null,
  lastError: null as string | null,
};
