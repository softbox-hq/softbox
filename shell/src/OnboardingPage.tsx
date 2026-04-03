import { useState } from "react";

const onboardingSteps = [
  {
    title: "Step 1",
    body: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer nec odio. Praesent libero.",
  },
  {
    title: "Step 2",
    body: "Sed cursus ante dapibus diam. Sed nisi. Nulla quis sem at nibh elementum imperdiet.",
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

  const currentStep = onboardingSteps[stepIndex];
  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex === onboardingSteps.length - 1;

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
        display: "grid",
        placeItems: "center",
        background:
          "radial-gradient(circle at 10% 10%, rgba(56, 189, 248, 0.18), transparent 35%), radial-gradient(circle at 90% 20%, rgba(34, 197, 94, 0.12), transparent 35%), #05070b",
        color: "#e2e8f0",
        padding: "24px",
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: "760px",
          border: "1px solid rgba(148, 163, 184, 0.25)",
          borderRadius: "20px",
          background: "rgba(6, 10, 16, 0.78)",
          backdropFilter: "blur(8px)",
          padding: "28px",
          boxShadow: "0 20px 60px rgba(2, 6, 23, 0.5)",
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
            disabled={isFirstStep || isCompleting || completed}
            style={{
              border: "1px solid rgba(148, 163, 184, 0.35)",
              background: "rgba(15, 23, 42, 0.7)",
              color: "#e2e8f0",
              borderRadius: "10px",
              padding: "10px 14px",
              cursor: isFirstStep || isCompleting || completed ? "not-allowed" : "pointer",
              opacity: isFirstStep || isCompleting || completed ? 0.6 : 1,
            }}
          >
            Back
          </button>

          {!isLastStep ? (
            <button
              type="button"
              onClick={() => setStepIndex((index) => Math.min(onboardingSteps.length - 1, index + 1))}
              disabled={isCompleting || completed}
              style={{
                border: "1px solid rgba(56, 189, 248, 0.4)",
                background: "rgba(14, 116, 144, 0.4)",
                color: "#ecfeff",
                borderRadius: "10px",
                padding: "10px 14px",
                cursor: isCompleting || completed ? "not-allowed" : "pointer",
                opacity: isCompleting || completed ? 0.6 : 1,
              }}
            >
              Next
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
