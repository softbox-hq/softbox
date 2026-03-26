import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { App } from "./App";
import { getViteEnv } from "./env";

const convexUrl = getViteEnv("VITE_CONVEX_URL");
const root = createRoot(document.getElementById("root")!);

if (!convexUrl) {
  root.render(
    <StrictMode>
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#0f172a",
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
            background: "rgba(15, 23, 42, 0.92)",
            border: "1px solid rgba(148, 163, 184, 0.18)",
          }}
        >
          <h1 style={{ margin: 0, fontSize: "20px", fontWeight: 700 }}>Shell Configuration Error</h1>
          <p style={{ margin: "12px 0 0", lineHeight: 1.6, color: "#cbd5e1" }}>
            <code>VITE_CONVEX_URL</code> is missing. Set it in the repo root <code>.env.local</code> and
            restart <code>pnpm dev:shell</code>.
          </p>
        </div>
      </div>
    </StrictMode>,
  );
} else {
  const client = new ConvexReactClient(convexUrl);

  root.render(
    <StrictMode>
      <ConvexProvider client={client}>
        <App />
      </ConvexProvider>
    </StrictMode>,
  );
}
