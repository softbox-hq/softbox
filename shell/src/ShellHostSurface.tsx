import { useState } from "react";
import { Plus } from "lucide-react";
import { DesktopActionCard } from "./DesktopActionCard";
import { DesktopTabs } from "./DesktopTabs";
import type { ServiceStatus } from "./serviceStatus";
import type { ServerInfo } from "./serverInfo";
import type { ShellHostEmptyStateContent } from "./shellHostConfig";
import { systemServices } from "./systemServices";

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
  const [activeTab, setActiveTab] = useState<"apps" | "services" | "server">("apps");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [appName, setAppName] = useState("");
  const [createPending, setCreatePending] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [serviceStatuses, setServiceStatuses] = useState<ServiceStatus[] | null>(null);
  const [servicesPending, setServicesPending] = useState(false);
  const [servicesError, setServicesError] = useState<string | null>(null);
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [serverInfoError, setServerInfoError] = useState<string | null>(null);

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

  async function loadServerInfo() {
    try {
      const response = await fetch("/__softbox/server-info", { cache: "no-store" });
      const payload = (await response.json()) as ServerInfo;
      setServerInfo(payload);
      setServerInfoError(null);
    } catch (error) {
      setServerInfoError(error instanceof Error ? error.message : String(error));
    }
  }

  async function loadServiceStatuses() {
    setServicesPending(true);
    try {
      const response = await fetch("/__softbox/service-status", { cache: "no-store" });
      const payload = (await response.json()) as ServiceStatus[];
      setServiceStatuses(payload);
      setServicesError(null);
    } catch (error) {
      setServicesError(error instanceof Error ? error.message : String(error));
    } finally {
      setServicesPending(false);
    }
  }

  function formatCheckedAt(timestamp: number) {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function statusTone(status: ServiceStatus["status"]) {
    if (status === "healthy") {
      return "bg-emerald-500/12 text-emerald-300";
    }
    if (status === "warning") {
      return "bg-amber-500/12 text-amber-200";
    }
    if (status === "error") {
      return "bg-rose-500/12 text-rose-200";
    }
    return "bg-white/8 text-slate-300";
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
              <div className="flex flex-col gap-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-cyan-200/60">
                  <span
                    className="text-2xl font-normal tracking-[0.12em] text-cyan-200/80"
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    {content.eyebrow}
                  </span>
                </p>
                <DesktopTabs activeTab={activeTab} onChange={setActiveTab} />
              </div>
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

            {activeTab === "apps" ? (
              <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
            ) : activeTab === "services" ? (
              <div className="mt-8 space-y-4">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void loadServiceStatuses()}
                    className="inline-flex h-9 items-center justify-center border border-white/10 bg-white/6 px-3.5 text-sm font-medium text-slate-200 transition-colors hover:bg-white/10"
                  >
                    {servicesPending ? "Checking..." : "Refresh services"}
                  </button>
                </div>

                {servicesError ? (
                  <div className="max-w-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">
                    {servicesError}
                  </div>
                ) : null}

                <div className="overflow-hidden border border-white/10 bg-[#0b0f13]/88">
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-white/10 text-sm">
                      <thead className="bg-white/[0.03]">
                        <tr>
                          <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-slate-400">
                            Service
                          </th>
                          <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-slate-400">
                            Role
                          </th>
                          <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-slate-400">
                            Status
                          </th>
                          <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-slate-400">
                            Checked
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">
                            Message
                          </th>
                        </tr>
                      </thead>

                      <tbody className="divide-y divide-white/6">
                        {(serviceStatuses ??
                          systemServices.map((service) => ({
                            ...service,
                            status: "unknown" as const,
                            message: "Not checked yet",
                            checkedAt: Date.now(),
                          }))).map((service) => (
                          <tr key={service.name} className="bg-black/10">
                            <td className="whitespace-nowrap px-4 py-3 font-medium text-white">
                              <div>{service.name}</div>
                              <div className="mt-1 text-xs text-slate-500">{service.detail}</div>
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-slate-300">
                              {service.role}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3">
                              <span
                                className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${statusTone(
                                  service.status,
                                )}`}
                              >
                                {service.status}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-slate-400">
                              {formatCheckedAt(service.checkedAt)}
                            </td>
                            <td className="px-4 py-3 text-slate-400">{service.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-8 space-y-4">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void loadServerInfo()}
                    className="inline-flex h-9 items-center justify-center border border-white/10 bg-white/6 px-3.5 text-sm font-medium text-slate-200 transition-colors hover:bg-white/10"
                  >
                    Refresh server
                  </button>
                </div>

                {serverInfoError ? (
                  <div className="max-w-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">
                    {serverInfoError}
                  </div>
                ) : null}

                {serverInfo ? (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {[
                      { label: "Host", value: serverInfo.hostname },
                      { label: "OS", value: `${serverInfo.platform} ${serverInfo.release}` },
                      { label: "Architecture", value: serverInfo.arch },
                      { label: "CPU", value: `${serverInfo.cpuModel} (${serverInfo.cpuCores} cores)` },
                      {
                        label: "RAM",
                        value: `${serverInfo.freeMemoryGb.toFixed(1)} GB free / ${serverInfo.totalMemoryGb.toFixed(1)} GB total`,
                      },
                      {
                        label: "Disk",
                        value:
                          serverInfo.diskTotalGb !== null && serverInfo.diskFreeGb !== null
                            ? `${serverInfo.diskFreeGb.toFixed(1)} GB free / ${serverInfo.diskTotalGb.toFixed(1)} GB total`
                            : "Unavailable",
                      },
                      { label: "Node", value: serverInfo.nodeVersion },
                    ].map((item) => (
                      <article key={item.label} className="border border-white/10 bg-black/20 p-4">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                          {item.label}
                        </p>
                        <p className="mt-2 text-sm leading-6 text-slate-200">{item.value}</p>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="max-w-xl border border-white/10 bg-black/20 p-5">
                    <p className="text-sm leading-6 text-slate-300">
                      Load the server view to inspect the current Softbox machine.
                    </p>
                    <p className="mt-3 text-xs leading-5 text-slate-500">
                      This includes host name, OS version, CPU, RAM, disk, and Node runtime.
                    </p>
                  </div>
                )}
              </div>
            )}
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
