import { useState } from "react";
import type { ShellHostEmptyStateContent } from "./shellHostConfig";

type ShellHostEmptyStateProps = {
  content: ShellHostEmptyStateContent;
  composerHidden: boolean;
  canCreateApp?: boolean;
  onAppCreated?: () => void;
  onOpenApps: () => void;
  onTogglePromptHud: () => void;
};

export function ShellHostEmptyState(props: ShellHostEmptyStateProps) {
  const { content, composerHidden, canCreateApp = false, onAppCreated, onOpenApps, onTogglePromptHud } =
    props;
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [appName, setAppName] = useState("");
  const [createPending, setCreatePending] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const normalizedAppName = appName.trim().toLowerCase();
  const canSubmit =
    normalizedAppName.length > 0 &&
    /^[a-z0-9][a-z0-9-]*$/.test(normalizedAppName) &&
    !createPending;

  async function handleCreateApp() {
    if (!canSubmit) {
      setCreateError("Use lowercase letters, numbers, and hyphens only.");
      return;
    }

    setCreatePending(true);
    setCreateError(null);
    try {
      const response = await fetch("/__softbox/create-app", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          appId: normalizedAppName,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? `Request failed with ${response.status}`);
      }
      setCreateModalOpen(false);
      setAppName("");
      onAppCreated?.();
      onOpenApps();
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : String(error));
    } finally {
      setCreatePending(false);
    }
  }

  return (
    <>
      <section className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-4 pb-28 pt-24 sm:px-6 sm:pb-32 sm:pt-32">
        <div className="pointer-events-auto relative w-full max-w-2xl overflow-hidden rounded-[1.5rem] border border-white/10 bg-[#0d1014]/86 p-5 shadow-[0_24px_84px_rgba(0,0,0,0.38)] backdrop-blur-2xl sm:p-6">
          <div
            className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(103,232,249,0.08),transparent_36%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent_22%)]"
            aria-hidden="true"
          />
          <div className="relative">
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-cyan-200/60">
              {content.eyebrow}
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              {content.title}
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300">{content.body}</p>

            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              {content.steps.map((step, index) => (
                <div
                  key={`${index}-${step}`}
                  className="rounded-[1.1rem] border border-white/8 bg-black/20 px-4 py-3"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Step {index + 1}
                  </p>
                  <p className="mt-1.5 text-sm leading-5 text-slate-200">{step}</p>
                </div>
              ))}
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              {canCreateApp ? (
                <button
                  type="button"
                  onClick={() => {
                    setCreateError(null);
                    setCreateModalOpen(true);
                  }}
                  className="inline-flex h-9 items-center justify-center rounded-xl bg-cyan-300 px-3.5 text-sm font-medium text-black transition-colors hover:bg-cyan-200"
                >
                  Create app
                </button>
              ) : null}
              <button
                type="button"
                onClick={onOpenApps}
                className="inline-flex h-9 items-center justify-center rounded-xl bg-white px-3.5 text-sm font-medium text-black transition-colors hover:bg-slate-200"
              >
                Open apps
              </button>
              <button
                type="button"
                onClick={onTogglePromptHud}
                className="inline-flex h-9 items-center justify-center rounded-xl border border-white/10 bg-white/6 px-3.5 text-sm font-medium text-slate-200 transition-colors hover:bg-white/10"
              >
                {composerHidden ? "Show prompt HUD" : "Hide prompt HUD"}
              </button>
            </div>
          </div>
        </div>
      </section>

      {createModalOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 px-4">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-[1.5rem] border border-white/10 bg-[#10141a] p-5 shadow-[0_24px_84px_rgba(0,0,0,0.5)]"
          >
            <h3 className="text-lg font-semibold text-white">Create a new app</h3>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Enter an app id. Softbox will run the full onboarding flow for you.
            </p>
            <label className="mt-4 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              App id
            </label>
            <input
              autoFocus
              type="text"
              value={appName}
              onChange={(event) => {
                setAppName(event.target.value);
                setCreateError(null);
              }}
              placeholder="my-app"
              className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-cyan-300/50"
            />
            <p className="mt-2 text-xs text-slate-500">Lowercase letters, numbers, and hyphens only.</p>
            {createError ? <p className="mt-3 text-sm text-rose-300">{createError}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  if (createPending) return;
                  setCreateModalOpen(false);
                }}
                className="inline-flex h-9 items-center justify-center rounded-xl border border-white/10 bg-white/6 px-3.5 text-sm font-medium text-slate-200 transition-colors hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!canSubmit}
                onClick={() => void handleCreateApp()}
                className="inline-flex h-9 items-center justify-center rounded-xl bg-cyan-300 px-3.5 text-sm font-medium text-black transition-colors hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
              >
                {createPending ? "Creating..." : "Create app"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
