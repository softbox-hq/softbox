import { useEffect, useRef, useState } from "react";

type ToolStatus = {
  name: string;
  installed: boolean;
  path: string | null;
};

type SystemStatus = {
  hostname: string;
  platform: string;
  release: string;
  arch: string;
  nodeVersion: string;
};

type StepOneSnapshot = {
  step: 1;
  title: string;
  completedAt: string;
  tools: ToolStatus[];
  system: SystemStatus | null;
};

type ConvexStatus = {
  viteConvexUrl: string | null;
  convexUrl: string | null;
  configured: boolean;
  envMatches: boolean;
  localConfigPresent: boolean;
  mode: "local" | "cloud" | "unknown" | "missing";
  validation: {
    status: "ok" | "error" | "skipped";
    message: string;
    deploymentUrl: string | null;
    functionCount: number | null;
  };
  ready: boolean;
};

const onboardingSteps = [
  {
    title: "Step 1",
    body: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer nec odio. Praesent libero.",
  },
  {
    title: "Step 2",
    body: "Softbox needs Convex for runtime state. This step checks .env.local, verifies the active deployment, and lets you create a new local Convex database if nothing is configured yet.",
  },
  {
    title: "Step 3",
    body: "Duis sagittis ipsum. Praesent mauris. Fusce nec tellus sed augue semper porta.",
  },
  {
    title: "Step 4",
    body: "Mauris massa. Vestibulum lacinia arcu eget nulla. Class aptent taciti sociosqu ad litora.",
  },
  {
    title: "Step 5",
    body: "Curabitur sodales ligula in libero. Sed dignissim lacinia nunc. Curabitur tortor.",
  },
] as const;

export function OnboardingPage() {
  const [stepIndex, setStepIndex] = useState(0);
  const [isCompleting, setIsCompleting] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [isAdvancingStep, setIsAdvancingStep] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);
  const [isCheckingTools, setIsCheckingTools] = useState(false);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [tools, setTools] = useState<ToolStatus[]>([]);
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [isCheckingConvex, setIsCheckingConvex] = useState(false);
  const [convexError, setConvexError] = useState<string | null>(null);
  const [convexStatus, setConvexStatus] = useState<ConvexStatus | null>(null);
  const [isCreatingLocalConvex, setIsCreatingLocalConvex] = useState(false);
  const [convexActionError, setConvexActionError] = useState<string | null>(null);
  const [convexActionMessage, setConvexActionMessage] = useState<string | null>(null);
  const [showCloudConvexHelp, setShowCloudConvexHelp] = useState(false);
  const hasStartedInitialToolsCheckRef = useRef(false);
  const hasStartedInitialConvexCheckRef = useRef(false);
  const activeToolsRequestRef = useRef(0);
  const activeConvexRequestRef = useRef(0);

  const currentStep = onboardingSteps[stepIndex];
  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex === onboardingSteps.length - 1;

  async function loadTools() {
    const requestId = activeToolsRequestRef.current + 1;
    activeToolsRequestRef.current = requestId;
    setToolsError(null);
    setIsCheckingTools(true);
    const timeoutId = window.setTimeout(() => {
      if (activeToolsRequestRef.current !== requestId) {
        return;
      }
      setIsCheckingTools(false);
      setToolsError("Tool check timed out. Verify `pnpm start` is running and retry.");
    }, 8000);

    try {
      const response = await fetch("/__softbox/onboarding/tools-status", { cache: "no-store" });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        tools?: ToolStatus[];
        system?: SystemStatus;
      };

      if (activeToolsRequestRef.current !== requestId) {
        return;
      }
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Failed to load tool status.");
      }

      setTools(Array.isArray(payload.tools) ? payload.tools : []);
      setSystem(payload.system ?? null);
    } catch (error: unknown) {
      if (activeToolsRequestRef.current !== requestId) {
        return;
      }
      setToolsError(error instanceof Error ? error.message : String(error));
    } finally {
      window.clearTimeout(timeoutId);
      if (activeToolsRequestRef.current === requestId) {
        setIsCheckingTools(false);
      }
    }
  }

  useEffect(() => {
    if (stepIndex !== 0 || hasStartedInitialToolsCheckRef.current) {
      return;
    }

    hasStartedInitialToolsCheckRef.current = true;
    void loadTools();
  }, [stepIndex]);

  async function loadConvexStatus() {
    const requestId = activeConvexRequestRef.current + 1;
    activeConvexRequestRef.current = requestId;
    setConvexError(null);
    setIsCheckingConvex(true);
    const timeoutId = window.setTimeout(() => {
      if (activeConvexRequestRef.current !== requestId) {
        return;
      }
      setIsCheckingConvex(false);
      setConvexError("Convex check timed out. Retry after `pnpm start` is fully up.");
    }, 15000);

    try {
      const response = await fetch("/__softbox/onboarding/convex-status", { cache: "no-store" });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        status?: ConvexStatus;
      };

      if (activeConvexRequestRef.current !== requestId) {
        return;
      }
      if (!response.ok || !payload.ok || !payload.status) {
        throw new Error(payload.error || "Failed to load Convex status.");
      }

      setConvexStatus(payload.status);
    } catch (error: unknown) {
      if (activeConvexRequestRef.current !== requestId) {
        return;
      }
      setConvexError(error instanceof Error ? error.message : String(error));
    } finally {
      window.clearTimeout(timeoutId);
      if (activeConvexRequestRef.current === requestId) {
        setIsCheckingConvex(false);
      }
    }
  }

  useEffect(() => {
    if (stepIndex !== 1 || hasStartedInitialConvexCheckRef.current) {
      return;
    }

    hasStartedInitialConvexCheckRef.current = true;
    void loadConvexStatus();
  }, [stepIndex]);

  async function persistStepOne() {
    const snapshot: StepOneSnapshot = {
      step: 1,
      title: onboardingSteps[0].title,
      completedAt: new Date().toISOString(),
      tools,
      system,
    };

    const response = await fetch("/__softbox/onboarding/step-1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snapshot),
    });
    const payload = (await response.json()) as { ok?: boolean; error?: string };
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Failed to save Step 1.");
    }
  }

  async function handleNext() {
    setStepError(null);

    if (stepIndex === 0) {
      setIsAdvancingStep(true);
      try {
        await persistStepOne();
        setStepIndex(1);
      } catch (error) {
        setStepError(error instanceof Error ? error.message : String(error));
      } finally {
        setIsAdvancingStep(false);
      }
      return;
    }

    if (stepIndex === 1) {
      if (!convexStatus?.ready) {
        setStepError("Finish Convex setup before continuing.");
        return;
      }
      setStepIndex(2);
      return;
    }

    setStepIndex((index) => Math.min(onboardingSteps.length - 1, index + 1));
  }

  async function handleCreateLocalConvex() {
    if (isCreatingLocalConvex) {
      return;
    }

    setConvexActionError(null);
    setConvexActionMessage(null);
    setIsCreatingLocalConvex(true);
    try {
      const response = await fetch("/__softbox/onboarding/convex/create-local", { method: "POST" });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
        status?: ConvexStatus;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Failed to create local Convex deployment.");
      }
      setConvexActionMessage(payload.message ?? "Local Convex deployment is ready.");
      if (payload.status) {
        setConvexStatus(payload.status);
      } else {
        await loadConvexStatus();
      }
    } catch (error) {
      setConvexActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsCreatingLocalConvex(false);
    }
  }

  async function handleComplete() {
    if (isCompleting) {
      return;
    }

    setCompletionError(null);
    setIsCompleting(true);
    try {
      const response = await fetch("/__softbox/onboarding/complete", { method: "POST" });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Failed to finalize onboarding.");
      }
      setCompleted(true);
    } catch (error) {
      setCompletionError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsCompleting(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at 10% 10%, rgba(56, 189, 248, 0.18), transparent 35%), radial-gradient(circle at 90% 20%, rgba(34, 197, 94, 0.12), transparent 35%), #05070b",
        color: "#e2e8f0",
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <section
        style={{
          width: "100vw",
          minHeight: "100vh",
          border: "1px solid rgba(148, 163, 184, 0.25)",
          borderRadius: 0,
          background: "rgba(6, 10, 16, 0.78)",
          backdropFilter: "blur(8px)",
          padding: "28px",
          boxShadow: "0 20px 60px rgba(2, 6, 23, 0.5)",
          boxSizing: "border-box",
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: "11px",
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: "#7dd3fc",
            fontWeight: 700,
          }}
        >
          Softbox Setup
        </p>
        <h1 style={{ margin: "10px 0 0", fontSize: "30px", lineHeight: 1.15, color: "#f8fafc" }}>
          Onboarding
        </h1>
        <p style={{ margin: "12px 0 0", color: "#93c5fd", fontSize: "13px", fontWeight: 600 }}>
          {currentStep.title} of {onboardingSteps.length}
        </p>
        <div
          style={{
            marginTop: "10px",
            height: "8px",
            borderRadius: "999px",
            background: "rgba(148, 163, 184, 0.25)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${((stepIndex + 1) / onboardingSteps.length) * 100}%`,
              background: "linear-gradient(90deg, #38bdf8, #22c55e)",
              transition: "width 180ms ease",
            }}
          />
        </div>

        <article
          style={{
            marginTop: "18px",
            border: "1px solid rgba(148, 163, 184, 0.2)",
            borderRadius: "14px",
            padding: "20px",
            background: "rgba(15, 23, 42, 0.45)",
          }}
        >
          <h2 style={{ margin: 0, color: "#e2e8f0", fontSize: "20px" }}>{currentStep.title}</h2>
          <p style={{ margin: "12px 0 0", lineHeight: 1.75, color: "#cbd5e1" }}>{currentStep.body}</p>
          {stepIndex === 0 ? (
            <div style={{ marginTop: "16px", display: "grid", gap: "8px" }}>
              {isCheckingTools ? (
                <p style={{ margin: 0, color: "#93c5fd" }}>Checking installed tools...</p>
              ) : null}
              {toolsError ? (
                <div>
                  <p style={{ margin: 0, color: "#fecaca" }}>{toolsError}</p>
                  <button
                    type="button"
                    onClick={() => {
                      setToolsError(null);
                      void loadTools();
                    }}
                    style={{
                      marginTop: "8px",
                      border: "1px solid rgba(248, 113, 113, 0.35)",
                      background: "rgba(127, 29, 29, 0.22)",
                      color: "#fecaca",
                      borderRadius: "8px",
                      padding: "6px 10px",
                      cursor: "pointer",
                    }}
                  >
                    Retry check
                  </button>
                </div>
              ) : null}
              {tools.map((tool) => (
                <div
                  key={tool.name}
                  style={{
                    border: "1px solid rgba(148, 163, 184, 0.22)",
                    borderRadius: "10px",
                    padding: "10px 12px",
                    background: "rgba(2, 6, 23, 0.45)",
                  }}
                >
                  <p style={{ margin: 0, color: "#e2e8f0", fontWeight: 600 }}>
                    {tool.name}: {tool.installed ? "installed" : "not installed"}
                  </p>
                  <p style={{ margin: "4px 0 0", color: "#94a3b8", fontSize: "12px" }}>
                    {tool.path ?? "No executable found in PATH."}
                  </p>
                </div>
              ))}
              {system ? (
                <div
                  style={{
                    marginTop: "6px",
                    border: "1px solid rgba(56, 189, 248, 0.22)",
                    borderRadius: "10px",
                    padding: "12px",
                    background: "rgba(8, 47, 73, 0.3)",
                  }}
                >
                  <p
                    style={{
                      margin: 0,
                      color: "#bae6fd",
                      fontWeight: 700,
                      fontSize: "12px",
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                    }}
                  >
                    System
                  </p>
                  <p style={{ margin: "8px 0 0", color: "#e2e8f0", fontWeight: 600 }}>
                    {system.platform} {system.release} on {system.arch}
                  </p>
                  <p style={{ margin: "4px 0 0", color: "#94a3b8", fontSize: "12px" }}>
                    Hostname: {system.hostname}
                  </p>
                  <p style={{ margin: "4px 0 0", color: "#94a3b8", fontSize: "12px" }}>
                    Node: {system.nodeVersion}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
          {stepIndex === 1 ? (
            <div style={{ marginTop: "16px", display: "grid", gap: "10px" }}>
              {isCheckingConvex ? (
                <p style={{ margin: 0, color: "#93c5fd" }}>Checking Convex setup...</p>
              ) : null}
              {convexError ? (
                <div>
                  <p style={{ margin: 0, color: "#fecaca" }}>{convexError}</p>
                  <button
                    type="button"
                    onClick={() => {
                      setConvexError(null);
                      void loadConvexStatus();
                    }}
                    style={{
                      marginTop: "8px",
                      border: "1px solid rgba(248, 113, 113, 0.35)",
                      background: "rgba(127, 29, 29, 0.22)",
                      color: "#fecaca",
                      borderRadius: "8px",
                      padding: "6px 10px",
                      cursor: "pointer",
                    }}
                  >
                    Retry Convex check
                  </button>
                </div>
              ) : null}
              {convexStatus ? (
                <>
                  <div
                    style={{
                      border: `1px solid ${
                        convexStatus.ready ? "rgba(74, 222, 128, 0.35)" : "rgba(250, 204, 21, 0.32)"
                      }`,
                      borderRadius: "10px",
                      padding: "12px",
                      background: convexStatus.ready ? "rgba(20, 83, 45, 0.22)" : "rgba(113, 63, 18, 0.22)",
                    }}
                  >
                    <p style={{ margin: 0, color: convexStatus.ready ? "#bbf7d0" : "#fde68a", fontWeight: 700 }}>
                      {convexStatus.ready ? "Convex is configured and responding." : "Convex is not ready yet."}
                    </p>
                    <p style={{ margin: "6px 0 0", color: "#cbd5e1", lineHeight: 1.6 }}>
                      {convexStatus.validation.message}
                    </p>
                    <p style={{ margin: "6px 0 0", color: "#94a3b8", fontSize: "12px" }}>
                      Mode: {convexStatus.mode}
                      {convexStatus.mode === "local" ? " (local is faster)" : ""}
                    </p>
                  </div>

                  <div
                    style={{
                      border: "1px solid rgba(148, 163, 184, 0.22)",
                      borderRadius: "10px",
                      padding: "12px",
                      background: "rgba(2, 6, 23, 0.45)",
                    }}
                  >
                    <p
                      style={{
                        margin: 0,
                        color: "#e2e8f0",
                        fontWeight: 700,
                        fontSize: "12px",
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                      }}
                    >
                      .env.local
                    </p>
                    <p style={{ margin: "10px 0 0", color: "#e2e8f0", fontWeight: 600 }}>
                      VITE_CONVEX_URL
                    </p>
                    <p style={{ margin: "4px 0 0", color: "#94a3b8", fontSize: "12px", wordBreak: "break-all" }}>
                      {convexStatus.viteConvexUrl ?? "Missing"}
                    </p>
                    <p style={{ margin: "10px 0 0", color: "#e2e8f0", fontWeight: 600 }}>CONVEX_URL</p>
                    <p style={{ margin: "4px 0 0", color: "#94a3b8", fontSize: "12px", wordBreak: "break-all" }}>
                      {convexStatus.convexUrl ?? "Missing"}
                    </p>
                    <p style={{ margin: "10px 0 0", color: "#94a3b8", fontSize: "12px" }}>
                      URLs match: {convexStatus.envMatches ? "yes" : "no"}
                    </p>
                    <p style={{ margin: "4px 0 0", color: "#94a3b8", fontSize: "12px" }}>
                      Project-local Convex files: {convexStatus.localConfigPresent ? "present" : "not found"}
                    </p>
                  </div>

                  {!convexStatus.ready ? (
                    <div
                      style={{
                        border: "1px solid rgba(56, 189, 248, 0.22)",
                        borderRadius: "10px",
                        padding: "12px",
                        background: "rgba(8, 47, 73, 0.3)",
                      }}
                    >
                      <p style={{ margin: 0, color: "#e2e8f0", fontWeight: 700 }}>Create new Convex db</p>
                      <p style={{ margin: "8px 0 0", color: "#cbd5e1", lineHeight: 1.6 }}>
                        Local Convex is faster and does not need login. Cloud Convex is fine too, but its setup is
                        interactive.
                      </p>
                      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "12px" }}>
                        <button
                          type="button"
                          onClick={() => {
                            void handleCreateLocalConvex();
                          }}
                          disabled={isCreatingLocalConvex}
                          style={{
                            border: "1px solid rgba(74, 222, 128, 0.4)",
                            background: "rgba(22, 101, 52, 0.38)",
                            color: "#ecfdf5",
                            borderRadius: "8px",
                            padding: "8px 12px",
                            cursor: isCreatingLocalConvex ? "not-allowed" : "pointer",
                            opacity: isCreatingLocalConvex ? 0.6 : 1,
                          }}
                        >
                          {isCreatingLocalConvex ? "Creating local Convex..." : "Create local Convex db"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowCloudConvexHelp((current) => !current)}
                          style={{
                            border: "1px solid rgba(56, 189, 248, 0.35)",
                            background: "rgba(14, 116, 144, 0.28)",
                            color: "#e0f2fe",
                            borderRadius: "8px",
                            padding: "8px 12px",
                            cursor: "pointer",
                          }}
                        >
                          {showCloudConvexHelp ? "Hide cloud setup" : "Use cloud Convex instead"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setConvexError(null);
                            void loadConvexStatus();
                          }}
                          style={{
                            border: "1px solid rgba(148, 163, 184, 0.28)",
                            background: "rgba(15, 23, 42, 0.6)",
                            color: "#e2e8f0",
                            borderRadius: "8px",
                            padding: "8px 12px",
                            cursor: "pointer",
                          }}
                        >
                          Check again
                        </button>
                      </div>
                      {convexActionMessage ? (
                        <p style={{ margin: "12px 0 0", color: "#bbf7d0" }}>{convexActionMessage}</p>
                      ) : null}
                      {convexActionError ? (
                        <p style={{ margin: "12px 0 0", color: "#fecaca" }}>{convexActionError}</p>
                      ) : null}
                      {showCloudConvexHelp ? (
                        <div
                          style={{
                            marginTop: "12px",
                            border: "1px solid rgba(148, 163, 184, 0.2)",
                            borderRadius: "10px",
                            padding: "12px",
                            background: "rgba(2, 6, 23, 0.35)",
                          }}
                        >
                          <p style={{ margin: 0, color: "#e2e8f0", fontWeight: 600 }}>
                            Cloud setup needs interactive Convex login.
                          </p>
                          <p style={{ margin: "8px 0 0", color: "#cbd5e1", lineHeight: 1.6 }}>
                            Run <code>pnpm exec convex dev</code> in a terminal, choose a new or existing cloud
                            project, then make sure <code>VITE_CONVEX_URL</code> and <code>CONVEX_URL</code> in{" "}
                            <code>.env.local</code> both use the same deployment URL.
                          </p>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}
        </article>

        {completionError ? (
          <p
            style={{
              margin: "16px 0 0",
              color: "#fecaca",
              background: "rgba(127, 29, 29, 0.24)",
              border: "1px solid rgba(248, 113, 113, 0.35)",
              borderRadius: "12px",
              padding: "10px 12px",
            }}
          >
            {completionError}
          </p>
        ) : null}

        {stepError ? (
          <p
            style={{
              margin: "16px 0 0",
              color: "#fecaca",
              background: "rgba(127, 29, 29, 0.24)",
              border: "1px solid rgba(248, 113, 113, 0.35)",
              borderRadius: "12px",
              padding: "10px 12px",
            }}
          >
            {stepError}
          </p>
        ) : null}

        {completed ? (
          <p
            style={{
              margin: "16px 0 0",
              color: "#bbf7d0",
              background: "rgba(20, 83, 45, 0.32)",
              border: "1px solid rgba(74, 222, 128, 0.35)",
              borderRadius: "12px",
              padding: "10px 12px",
              lineHeight: 1.6,
            }}
          >
            Onboarding is marked complete and <code>VITE_ONBOARDING_DONE=true</code> was written to{" "}
            <code>.env.local</code>. Restart <code>pnpm start</code> to load the main shell.
          </p>
        ) : null}

        <div style={{ display: "flex", gap: "10px", marginTop: "18px" }}>
          <button
            type="button"
            onClick={() => setStepIndex((index) => Math.max(0, index - 1))}
            disabled={isFirstStep || isCompleting || completed || isAdvancingStep}
            style={{
              border: "1px solid rgba(148, 163, 184, 0.35)",
              background: "rgba(15, 23, 42, 0.7)",
              color: "#e2e8f0",
              borderRadius: "10px",
              padding: "10px 14px",
              cursor: isFirstStep || isCompleting || completed || isAdvancingStep ? "not-allowed" : "pointer",
              opacity: isFirstStep || isCompleting || completed || isAdvancingStep ? 0.6 : 1,
            }}
          >
            Back
          </button>

          {!isLastStep ? (
            <button
              type="button"
              onClick={() => {
                void handleNext();
              }}
              disabled={
                isCompleting ||
                completed ||
                isAdvancingStep ||
                (stepIndex === 0 && (isCheckingTools || !!toolsError || tools.length === 0 || !system)) ||
                (stepIndex === 1 && (isCheckingConvex || isCreatingLocalConvex || !convexStatus?.ready))
              }
              style={{
                border: "1px solid rgba(56, 189, 248, 0.4)",
                background: "rgba(14, 116, 144, 0.4)",
                color: "#ecfeff",
                borderRadius: "10px",
                padding: "10px 14px",
                cursor:
                  isCompleting ||
                  completed ||
                  isAdvancingStep ||
                  (stepIndex === 0 && (isCheckingTools || !!toolsError || tools.length === 0 || !system)) ||
                  (stepIndex === 1 && (isCheckingConvex || isCreatingLocalConvex || !convexStatus?.ready))
                    ? "not-allowed"
                    : "pointer",
                opacity:
                  isCompleting ||
                  completed ||
                  isAdvancingStep ||
                  (stepIndex === 0 && (isCheckingTools || !!toolsError || tools.length === 0 || !system)) ||
                  (stepIndex === 1 && (isCheckingConvex || isCreatingLocalConvex || !convexStatus?.ready))
                    ? 0.6
                    : 1,
              }}
            >
              {isAdvancingStep ? "Saving..." : "Next"}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleComplete}
              disabled={isCompleting || completed}
              style={{
                border: "1px solid rgba(74, 222, 128, 0.45)",
                background: "rgba(22, 101, 52, 0.45)",
                color: "#ecfdf5",
                borderRadius: "10px",
                padding: "10px 14px",
                cursor: isCompleting || completed ? "not-allowed" : "pointer",
                opacity: isCompleting || completed ? 0.6 : 1,
              }}
            >
              {isCompleting ? "Completing..." : "Complete onboarding"}
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
