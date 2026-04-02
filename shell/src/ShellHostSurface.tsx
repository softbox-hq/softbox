import { useState } from "react";
import { Plus } from "lucide-react";
import { DesktopActionCard } from "./DesktopActionCard";
import type { ShellHostEmptyStateContent } from "./shellHostConfig";

type ShellDesktopApp = {
  appId: string;
  name: string;
  activeVersion?: {
    versionNumber: number;
  } | null;
  templateSourceStatus?: string | null;
};

type ShellHostSurfaceProps = {
  content: ShellHostEmptyStateContent;
  apps: ShellDesktopApp[];
  selectedAppId: string | null;
  canCreateApp?: boolean;
  onAppCreated?: () => void;
  onOpenApps: () => void;
  onSelectApp: (appId: string) => void;
};

export function ShellHostSurface(props: ShellHostSurfaceProps) {
  const { content, apps, selectedAppId, canCreateApp = false, onAppCreated, onOpenApps, onSelectApp } =
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
      <section className="pointer-events-none absolute inset-0 z-10 flex items-stretch justify-stretch">
        <div className="pointer-events-auto relative h-full w-full overflow-hidden border-0 bg-[#0d1014]/72 px-6 py-6 shadow-none backdrop-blur-xl sm:px-8 sm:py-8">
          <div
            className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(103,232,249,0.08),transparent_36%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent_22%)]"
            aria-hidden="true"
          />
          <div className="relative mx-auto flex h-full w-full max-w-6xl flex-col">
            <div className="flex items-start justify-between gap-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-cyan-200/60">
                <span
                  className="text-2xl font-normal tracking-[0.12em] text-cyan-200/80"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {content.eyebrow}
                </span>
              </p>
              {canCreateApp ? (
                <button
                  type="button"
                  onClick={() => {
                    setCreateError(null);
                    setCreateModalOpen(true);
                  }}
                  aria-label="Create app"
                  title="Create app"
                  className="inline-flex h-10 w-10 items-center justify-center border border-white/10 bg-white/6 text-slate-100 transition-colors hover:bg-white/10"
                >
                  <Plus className="size-4" />
                </button>
              ) : null}
            </div>

            <div className="mt-8 grid gap-4 lg:grid-cols-2">
              {apps.map((app) => {
                const isSelected = selectedAppId === app.appId;
                const versionLabel =
                  typeof app.activeVersion?.versionNumber === "number"
                    ? `v${app.activeVersion.versionNumber}`
                    : "No versions yet";
                const sourceStatus = app.templateSourceStatus ?? "unknown";
                return (
                  <DesktopActionCard
                    key={app.appId}
                    eyebrow={isSelected ? "Mounted app" : "App"}
                    title={app.name || app.appId}
                    description={`Open ${app.appId} on the Softbox desktop and continue editing from its mounted runtime.`}
                    detail={`Template source: ${sourceStatus} · Active version: ${versionLabel}`}
                    accentClassName={
                      isSelected
                        ? "from-cyan-300/40 via-sky-300/15 to-transparent"
                        : "from-fuchsia-300/30 via-rose-300/12 to-transparent"
                    }
                    onClick={() => onSelectApp(app.appId)}
                    actions={[]}
                  />
                );
              })}
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
