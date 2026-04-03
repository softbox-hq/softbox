import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { App } from "./App";
import { getViteEnv } from "./env";
import { OnboardingPage } from "./OnboardingPage";

const convexUrl = getViteEnv("VITE_CONVEX_URL");
const onboardingDone = getViteEnv("VITE_ONBOARDING_DONE").toLowerCase() === "true";
const onboardingRoute = "/onboarding";

function normalizeRoute(pathname: string): string {
  if (!pathname) {
    return "/";
  }
  return pathname.length > 1 ? pathname.replace(/\/+$/u, "") : pathname;
}

function replaceRouteIfNeeded(nextPath: string): void {
  if (typeof window === "undefined") {
    return;
  }

  const currentPath = normalizeRoute(window.location.pathname);
  const targetPath = normalizeRoute(nextPath);
  if (currentPath === targetPath) {
    return;
  }

  window.history.replaceState(window.history.state, "", `${targetPath}${window.location.search}${window.location.hash}`);
}

const root = createRoot(document.getElementById("root")!);
const currentPath = typeof window === "undefined" ? "/" : normalizeRoute(window.location.pathname);

if (!onboardingDone) {
  replaceRouteIfNeeded(onboardingRoute);
  root.render(
    <StrictMode>
      <OnboardingPage />
    </StrictMode>,
  );
} else if (!convexUrl) {
  root.render(
    <StrictMode>
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#000000",
          color: "#e2e8f0",
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          padding: "24px",
        }}
      >
        <div
          style={{
            maxWidth: "640px",
            width: "100%",
            borderRadius: "16px",
            padding: "24px",
            background: "rgba(10, 10, 10, 0.92)",
            border: "1px solid rgba(148, 163, 184, 0.18)",
          }}
        >
          <h1 style={{ margin: 0, fontSize: "20px", fontWeight: 700 }}>Shell Configuration Error</h1>
          <p style={{ margin: "12px 0 0", lineHeight: 1.6, color: "#cbd5e1" }}>
            <code>VITE_CONVEX_URL</code> is missing. Set it in the repo root <code>.env.local</code> and
            restart <code>pnpm start</code> (or <code>pnpm dev:shell</code> if you are only running the shell).
          </p>
        </div>
      </div>
    </StrictMode>,
  );
} else {
  if (currentPath === onboardingRoute) {
    replaceRouteIfNeeded("/");
  }

  const client = new ConvexReactClient(convexUrl);

  root.render(
    <StrictMode>
      <ConvexProvider client={client}>
        <App />
      </ConvexProvider>
    </StrictMode>,
  );
}
