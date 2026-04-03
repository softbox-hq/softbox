import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { DesktopActionCard } from "./DesktopActionCard";
import { DesktopTabs } from "./DesktopTabs";
import type { OpenClawStatus } from "./openClaw";
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

type UnwrappedShellApp = {
  appId: string;
  relativePath: string;
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

function extractOpenClawAuthUrl(logs: string[]) {
  for (const line of logs) {
    const match = line.match(/Open:\s*(https:\/\/\S+)/i);
    if (match) {
      return match[1];
    }
  }
  return null;
}

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
  const [openClawStatus, setOpenClawStatus] = useState<OpenClawStatus | null>(null);
  const [openClawPending, setOpenClawPending] = useState(false);
  const [openClawError, setOpenClawError] = useState<string | null>(null);
  const [openClawActionPending, setOpenClawActionPending] = useState<string | null>(null);
  const [openClawConfigDirty, setOpenClawConfigDirty] = useState(false);
  const [gatewayBaseUrl, setGatewayBaseUrl] = useState("http://127.0.0.1:18789");
  const [gatewayToken, setGatewayToken] = useState("");
  const [routingMode, setRoutingMode] = useState<"shared" | "per_app">("per_app");
  const [agentId, setAgentId] = useState("");
  const [agentIdPrefix, setAgentIdPrefix] = useState("");
  const [sessionKeyPrefix, setSessionKeyPrefix] = useState("softbox");
  const [authChoice, setAuthChoice] = useState("oauth");
  const [providerSecret, setProviderSecret] = useState("");
  const [tokenProvider, setTokenProvider] = useState("openai-codex");
  const [oauthCallbackInput, setOauthCallbackInput] = useState("");
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [serverInfoError, setServerInfoError] = useState<string | null>(null);
  const [unwrappedApps, setUnwrappedApps] = useState<UnwrappedShellApp[]>([]);
  const [unwrappedError, setUnwrappedError] = useState<string | null>(null);
  const [wrapPendingAppId, setWrapPendingAppId] = useState<string | null>(null);
  const [uninstallPendingAppId, setUninstallPendingAppId] = useState<string | null>(null);
  const [wrapSuccessMessage, setWrapSuccessMessage] = useState<string | null>(null);

  const normalizedAppName = appName.trim().toLowerCase();
  const openClawAuthUrl =
    openClawStatus?.onboardSession.authUrl ??
    extractOpenClawAuthUrl(openClawStatus?.onboardSession.logs ?? []);
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

  async function loadUnwrappedApps() {
    try {
      const response = await fetch("/__softbox/apps/unwrapped", { cache: "no-store" });
      const payload = (await response.json()) as
        | { ok?: boolean; error?: string; apps?: UnwrappedShellApp[] }
        | undefined;
      if (!response.ok || !payload?.ok || !Array.isArray(payload.apps)) {
        throw new Error(payload?.error ?? `Request failed with ${response.status}`);
      }
      setUnwrappedApps(payload.apps);
      setUnwrappedError(null);
    } catch (error) {
      setUnwrappedError(error instanceof Error ? error.message : String(error));
    }
  }

  async function installApp(appId: string) {
    setWrapPendingAppId(appId);
    setWrapSuccessMessage(null);
    setUnwrappedError(null);
    try {
      const response = await fetch("/__softbox/apps/install", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ appId }),
      });
      const payload = (await response.json()) as
        | {
            ok?: boolean;
            error?: string;
            wrapped?: boolean;
            status?: OpenClawStatus;
          }
        | undefined;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? `Request failed with ${response.status}`);
      }
      if (payload.status) {
        setOpenClawStatus(payload.status);
      }
      setWrapSuccessMessage(`Installed '${appId}' (wrap + seed + agent sync).`);
      await loadUnwrappedApps();
      onAppCreated?.();
    } catch (error) {
      setUnwrappedError(error instanceof Error ? error.message : String(error));
    } finally {
      setWrapPendingAppId(null);
    }
  }

  async function uninstallApp(appId: string) {
    const confirmed = window.confirm(
      `Uninstall '${appId}'?\n\nThis will delete its Softbox data from Convex and unwrap local Softbox adapter files.`,
    );
    if (!confirmed) {
      return;
    }
    setUninstallPendingAppId(appId);
    setWrapSuccessMessage(null);
    setUnwrappedError(null);
    try {
      const response = await fetch("/__softbox/apps/uninstall", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ appId }),
      });
      const payload = (await response.json()) as
        | {
            ok?: boolean;
            error?: string;
            status?: OpenClawStatus;
          }
        | undefined;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? `Request failed with ${response.status}`);
      }
      if (payload.status) {
        setOpenClawStatus(payload.status);
      }
      setWrapSuccessMessage(`Uninstalled '${appId}' (deleted from Convex and unwrapped locally).`);
      await loadUnwrappedApps();
      onAppCreated?.();
    } catch (error) {
      setUnwrappedError(error instanceof Error ? error.message : String(error));
    } finally {
      setUninstallPendingAppId(null);
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

  async function loadOpenClawStatus(options?: { silent?: boolean }) {
    if (!options?.silent) {
      setOpenClawPending(true);
    }
    try {
      const response = await fetch("/__softbox/openclaw/status", { cache: "no-store" });
      const payload = (await response.json()) as OpenClawStatus | { error?: string };
      if (!response.ok || "error" in payload) {
        throw new Error(("error" in payload && payload.error) || `Request failed with ${response.status}`);
      }
      const status = payload as OpenClawStatus;
      setOpenClawStatus(status);
      if (!openClawConfigDirty) {
        setGatewayBaseUrl(status.config.gatewayBaseUrl ?? "http://127.0.0.1:18789");
        setGatewayToken("");
        setRoutingMode(status.config.routingMode);
        setAgentId(status.config.agentId ?? "");
        setAgentIdPrefix(status.config.agentIdPrefix ?? "");
        setSessionKeyPrefix(status.config.sessionKeyPrefix ?? "softbox");
      }
      setOpenClawError(null);
    } catch (error) {
      setOpenClawError(error instanceof Error ? error.message : String(error));
    } finally {
      if (!options?.silent) {
        setOpenClawPending(false);
      }
    }
  }

  async function saveOpenClawConfig() {
    setOpenClawActionPending("save");
    try {
      const response = await fetch("/__softbox/openclaw/configure", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          gatewayBaseUrl,
          gatewayToken,
          routingMode,
          agentId,
          agentIdPrefix,
          sessionKeyPrefix,
        }),
      });
      const payload = (await response.json()) as
        | { ok?: boolean; error?: string; status?: OpenClawStatus }
        | undefined;
      if (!response.ok || !payload?.ok || !payload.status) {
        throw new Error(payload?.error ?? `Request failed with ${response.status}`);
      }
      setOpenClawStatus(payload.status);
      setOpenClawConfigDirty(false);
      setGatewayToken("");
      setOpenClawError(null);
    } catch (error) {
      setOpenClawError(error instanceof Error ? error.message : String(error));
    } finally {
      setOpenClawActionPending(null);
    }
  }

  async function bootstrapOpenClawGateway() {
    setOpenClawActionPending("bootstrap");
    try {
      const response = await fetch("/__softbox/openclaw/gateway/bootstrap", {
        method: "POST",
      });
      const payload = (await response.json()) as
        | { ok?: boolean; error?: string; status?: OpenClawStatus }
        | undefined;
      if (!response.ok || !payload?.ok || !payload.status) {
        throw new Error(payload?.error ?? `Request failed with ${response.status}`);
      }
      setOpenClawStatus(payload.status);
      setGatewayBaseUrl(payload.status.config.gatewayBaseUrl ?? "http://127.0.0.1:18789");
      setGatewayToken("");
      setOpenClawError(null);
      setOpenClawConfigDirty(false);
    } catch (error) {
      setOpenClawError(error instanceof Error ? error.message : String(error));
    } finally {
      setOpenClawActionPending(null);
    }
  }

  async function startOpenClawGateway() {
    setOpenClawActionPending("start-gateway");
    try {
      const response = await fetch("/__softbox/openclaw/gateway/start", { method: "POST" });
      const payload = (await response.json()) as
        | { ok?: boolean; error?: string; status?: OpenClawStatus }
        | undefined;
      if (!response.ok || !payload?.ok || !payload.status) {
        throw new Error(payload?.error ?? `Request failed with ${response.status}`);
      }
      setOpenClawStatus(payload.status);
      setOpenClawError(null);
    } catch (error) {
      setOpenClawError(error instanceof Error ? error.message : String(error));
    } finally {
      setOpenClawActionPending(null);
    }
  }

  async function stopOpenClawGateway() {
    setOpenClawActionPending("stop-gateway");
    try {
      const response = await fetch("/__softbox/openclaw/gateway/stop", { method: "POST" });
      const payload = (await response.json()) as
        | { ok?: boolean; error?: string; status?: OpenClawStatus }
        | undefined;
      if (!response.ok || !payload?.ok || !payload.status) {
        throw new Error(payload?.error ?? `Request failed with ${response.status}`);
      }
      setOpenClawStatus(payload.status);
      setOpenClawError(null);
    } catch (error) {
      setOpenClawError(error instanceof Error ? error.message : String(error));
    } finally {
      setOpenClawActionPending(null);
    }
  }

  async function startOpenClawOnboard() {
    setOpenClawActionPending("onboard");
    try {
      const response = await fetch("/__softbox/openclaw/onboard/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          authChoice,
          providerSecret,
          tokenProvider,
          gatewayBaseUrl,
          gatewayToken,
        }),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? `Request failed with ${response.status}`);
      }
      setProviderSecret("");
      setOauthCallbackInput("");
      await loadOpenClawStatus({ silent: true });
    } catch (error) {
      setOpenClawError(error instanceof Error ? error.message : String(error));
    } finally {
      setOpenClawActionPending(null);
    }
  }

  async function submitOpenClawOnboardInput() {
    setOpenClawActionPending("submit-oauth");
    try {
      const response = await fetch("/__softbox/openclaw/onboard/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          value: oauthCallbackInput,
        }),
      });
      const payload = (await response.json()) as
        | { ok?: boolean; error?: string; session?: OpenClawStatus["onboardSession"] }
        | undefined;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? `Request failed with ${response.status}`);
      }
      setOauthCallbackInput("");
      await loadOpenClawStatus({ silent: true });
    } catch (error) {
      setOpenClawError(error instanceof Error ? error.message : String(error));
    } finally {
      setOpenClawActionPending(null);
    }
  }

  async function cancelOpenClawOnboard() {
    setOpenClawActionPending("cancel");
    try {
      const response = await fetch("/__softbox/openclaw/onboard/cancel", {
        method: "POST",
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? `Request failed with ${response.status}`);
      }
      setOauthCallbackInput("");
      await loadOpenClawStatus({ silent: true });
    } catch (error) {
      setOpenClawError(error instanceof Error ? error.message : String(error));
    } finally {
      setOpenClawActionPending(null);
    }
  }

  async function approveLatestPairing() {
    setOpenClawActionPending("approve");
    try {
      const response = await fetch("/__softbox/openclaw/pairing/approve-latest", {
        method: "POST",
      });
      const payload = (await response.json()) as
        | { ok?: boolean; error?: string; status?: OpenClawStatus }
        | undefined;
      if (!response.ok || !payload?.ok || !payload.status) {
        throw new Error(payload?.error ?? `Request failed with ${response.status}`);
      }
      setOpenClawStatus(payload.status);
      setOpenClawError(null);
    } catch (error) {
      setOpenClawError(error instanceof Error ? error.message : String(error));
    } finally {
      setOpenClawActionPending(null);
    }
  }

  async function syncOpenClawAgents() {
    setOpenClawActionPending("sync");
    try {
      const response = await fetch("/__softbox/openclaw/sync-agents", {
        method: "POST",
      });
      const payload = (await response.json()) as
        | { ok?: boolean; error?: string; status?: OpenClawStatus }
        | undefined;
      if (!response.ok || !payload?.ok || !payload.status) {
        throw new Error(payload?.error ?? `Request failed with ${response.status}`);
      }
      setOpenClawStatus(payload.status);
      setOpenClawError(null);
    } catch (error) {
      setOpenClawError(error instanceof Error ? error.message : String(error));
    } finally {
      setOpenClawActionPending(null);
    }
  }

  useEffect(() => {
    if (activeTab !== "apps") {
      return;
    }
    void loadUnwrappedApps();
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "services" || openClawStatus) {
      return;
    }
    void loadOpenClawStatus();
  }, [activeTab, openClawStatus]);

  useEffect(() => {
    if (
      activeTab !== "services" ||
      (openClawStatus?.onboardSession.status !== "running" &&
        openClawStatus?.gatewayRuntime.status !== "running")
    ) {
      return;
    }
    const interval = window.setInterval(() => {
      void loadOpenClawStatus({ silent: true });
    }, 2500);
    return () => window.clearInterval(interval);
  }, [activeTab, openClawStatus?.onboardSession.status, openClawStatus?.gatewayRuntime.status]);

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
      <section className="pointer-events-none absolute inset-0 z-10 flex items-stretch justify-stretch overflow-y-auto">
        <div className="pointer-events-auto relative min-h-full w-full overflow-y-auto border-0 bg-[#0d1014]/72 px-6 py-6 shadow-none backdrop-blur-xl sm:px-8 sm:py-8">
          <div
            className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(103,232,249,0.08),transparent_36%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent_22%)]"
            aria-hidden="true"
          />
          <div className="relative mx-auto flex min-h-full w-full max-w-6xl flex-col">
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
              <div className="mt-8 space-y-5">
                {unwrappedError ? (
                  <div className="max-w-3xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">
                    {unwrappedError}
                  </div>
                ) : null}

                {wrapSuccessMessage ? (
                  <div className="max-w-3xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">
                    {wrapSuccessMessage}
                  </div>
                ) : null}

                {unwrappedApps.length > 0 ? (
                  <section className="border border-amber-400/20 bg-amber-500/[0.06] p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-200/70">
                          Not Installed
                        </p>
                        <p className="mt-2 text-sm leading-6 text-amber-50/90">
                          These app folders exist under <code>/apps</code> but are not installed in
                          Softbox yet.
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {unwrappedApps.map((app) => (
                        <article
                          key={app.appId}
                          className="border border-amber-200/20 bg-black/20 p-4 text-sm"
                        >
                          <p className="font-semibold text-amber-50">{app.appId}</p>
                          <p className="mt-1 text-xs text-amber-100/70">{app.relativePath}</p>
                          <button
                            type="button"
                            onClick={() => void installApp(app.appId)}
                            disabled={wrapPendingAppId !== null || uninstallPendingAppId !== null}
                            className="mt-3 inline-flex h-9 items-center justify-center border border-amber-300/30 bg-amber-300/15 px-3.5 text-sm font-medium text-amber-100 transition-colors hover:bg-amber-300/25 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {wrapPendingAppId === app.appId
                              ? "Installing..."
                              : "Install app"}
                          </button>
                        </article>
                      ))}
                    </div>
                  </section>
                ) : null}

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
                        actions={[
                          {
                            label:
                              uninstallPendingAppId === app.appId ? "Uninstalling..." : "Uninstall",
                            tone: "secondary",
                            onClick: () => {
                              if (uninstallPendingAppId || wrapPendingAppId) {
                                return;
                              }
                              void uninstallApp(app.appId);
                            },
                          },
                        ]}
                      />
                    );
                  })}
                </div>
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

                <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                  <section className="border border-white/10 bg-black/20 p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                          OpenClaw Auth
                        </p>
                        <h3 className="mt-2 text-lg font-semibold text-white">Local engine setup</h3>
                        <p className="mt-2 text-sm leading-6 text-slate-300">
                          Softbox can bootstrap the local OpenClaw gateway from the machine config
                          under <code>~/.openclaw</code>, then keep the worker env in sync.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void loadOpenClawStatus()}
                        className="inline-flex h-9 items-center justify-center border border-white/10 bg-white/6 px-3.5 text-sm font-medium text-slate-200 transition-colors hover:bg-white/10"
                      >
                        {openClawPending ? "Checking..." : "Refresh OpenClaw"}
                      </button>
                    </div>

                    {openClawError ? (
                      <div className="mt-4 border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">
                        {openClawError}
                      </div>
                    ) : null}

                    <div className="mt-5 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void bootstrapOpenClawGateway()}
                        disabled={openClawActionPending !== null}
                        className="inline-flex h-9 items-center justify-center bg-cyan-300 px-3.5 text-sm font-medium text-black transition-colors hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                      >
                        {openClawActionPending === "bootstrap" ? "Bootstrapping..." : "Auto setup gateway"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void stopOpenClawGateway()}
                        disabled={openClawActionPending !== null}
                        className="inline-flex h-9 items-center justify-center border border-rose-500/30 bg-rose-500/10 px-3.5 text-sm font-medium text-rose-100 transition-colors hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {openClawActionPending === "stop-gateway" ? "Stopping..." : "Stop gateway"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void startOpenClawGateway()}
                        disabled={openClawActionPending !== null}
                        className="inline-flex h-9 items-center justify-center border border-white/10 bg-white/6 px-3.5 text-sm font-medium text-slate-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:bg-black/20 disabled:text-slate-500"
                      >
                        {openClawActionPending === "start-gateway" ? "Starting..." : "Start gateway"}
                      </button>
                    </div>

                    <div className="mt-5 grid gap-4 md:grid-cols-2">
                      <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                        Gateway URL
                        <input
                          type="text"
                          value={gatewayBaseUrl}
                          onChange={(event) => {
                            setGatewayBaseUrl(event.target.value);
                            setOpenClawConfigDirty(true);
                          }}
                          className="mt-2 h-11 w-full border border-white/10 bg-black/20 px-3 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-cyan-300/50"
                        />
                      </label>
                      <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                        Gateway token
                        <input
                          type="password"
                          value={gatewayToken}
                          onChange={(event) => {
                            setGatewayToken(event.target.value);
                            setOpenClawConfigDirty(true);
                          }}
                          placeholder={
                            openClawStatus?.config.gatewayTokenConfigured
                              ? "Stored locally. Enter a new token to rotate it."
                              : "Paste the local gateway token"
                          }
                          className="mt-2 h-11 w-full border border-white/10 bg-black/20 px-3 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-cyan-300/50"
                        />
                      </label>
                    </div>

                    <div className="mt-4 grid gap-4 md:grid-cols-3">
                      <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                        Routing
                        <select
                          value={routingMode}
                          onChange={(event) => {
                            const nextRoutingMode = event.target.value === "shared" ? "shared" : "per_app";
                            setRoutingMode(nextRoutingMode);
                            setOpenClawConfigDirty(true);
                          }}
                          className="mt-2 h-11 w-full border border-white/10 bg-black/20 px-3 text-sm text-white outline-none transition-colors focus:border-cyan-300/50"
                        >
                          <option value="per_app">Per app agents</option>
                          <option value="shared">Shared agent</option>
                        </select>
                      </label>

                      {routingMode === "shared" ? (
                        <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                          Agent id
                          <input
                            type="text"
                            value={agentId}
                            onChange={(event) => {
                              setAgentId(event.target.value);
                              setOpenClawConfigDirty(true);
                            }}
                            placeholder="softbox"
                            className="mt-2 h-11 w-full border border-white/10 bg-black/20 px-3 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-cyan-300/50"
                          />
                        </label>
                      ) : (
                        <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                          Agent id prefix
                          <input
                            type="text"
                            value={agentIdPrefix}
                            onChange={(event) => {
                              setAgentIdPrefix(event.target.value);
                              setOpenClawConfigDirty(true);
                            }}
                            placeholder="softbox-<checkout>-"
                            className="mt-2 h-11 w-full border border-white/10 bg-black/20 px-3 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-cyan-300/50"
                          />
                        </label>
                      )}

                      <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                        Session prefix
                        <input
                          type="text"
                          value={sessionKeyPrefix}
                          onChange={(event) => {
                            setSessionKeyPrefix(event.target.value);
                            setOpenClawConfigDirty(true);
                          }}
                          className="mt-2 h-11 w-full border border-white/10 bg-black/20 px-3 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-cyan-300/50"
                        />
                      </label>
                    </div>

                    <div className="mt-5 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void saveOpenClawConfig()}
                        disabled={openClawActionPending !== null}
                        className="inline-flex h-9 items-center justify-center bg-cyan-300 px-3.5 text-sm font-medium text-black transition-colors hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                      >
                        {openClawActionPending === "save" ? "Saving..." : "Save advanced config"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void approveLatestPairing()}
                        disabled={openClawActionPending !== null}
                        className="inline-flex h-9 items-center justify-center border border-white/10 bg-white/6 px-3.5 text-sm font-medium text-slate-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:bg-black/20 disabled:text-slate-500"
                      >
                        {openClawActionPending === "approve" ? "Approving..." : "Approve latest pairing"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void syncOpenClawAgents()}
                        disabled={openClawActionPending !== null}
                        className="inline-flex h-9 items-center justify-center border border-white/10 bg-white/6 px-3.5 text-sm font-medium text-slate-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:bg-black/20 disabled:text-slate-500"
                      >
                        {openClawActionPending === "sync" ? "Syncing..." : "Sync agents"}
                      </button>
                    </div>
                  </section>

                  <section className="border border-white/10 bg-black/20 p-5">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      OpenClaw State
                    </p>
                    <div className="mt-4 space-y-3 text-sm text-slate-300">
                      <div className="flex items-center justify-between gap-3">
                        <span>Gateway</span>
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${statusTone(openClawStatus?.gateway.status ?? "unknown")}`}>
                          {openClawStatus?.gateway.status ?? "unknown"}
                        </span>
                      </div>
                      <p className="text-xs leading-5 text-slate-500">
                        {openClawStatus?.gateway.message ?? "OpenClaw status has not been checked yet."}
                      </p>

                      <div className="flex items-center justify-between gap-3">
                        <span>Pairing</span>
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${statusTone(openClawStatus?.devices.status ?? "unknown")}`}>
                          {openClawStatus?.devices.status ?? "unknown"}
                        </span>
                      </div>
                      <p className="text-xs leading-5 text-slate-500">
                        {openClawStatus?.devices.message ?? "No pairing information yet."}
                      </p>
                      <p className="text-xs leading-5 text-slate-500">
                        Pending: {openClawStatus?.devices.pendingCount ?? 0} · Paired: {openClawStatus?.devices.pairedCount ?? 0}
                      </p>
                      <p className="text-xs leading-5 text-slate-500">
                        Pending scopes: {(openClawStatus?.devices.pendingScopes ?? []).join(", ") || "none"}
                      </p>
                      <p className="text-xs leading-5 text-slate-500">
                        Paired scopes: {(openClawStatus?.devices.pairedScopes ?? []).join(", ") || "none"}
                      </p>
                      <p className="text-xs leading-5 text-slate-500">
                        Gateway mode: {openClawStatus?.config.gatewayMode ?? "unset"} · Bind: {openClawStatus?.config.gatewayBind ?? "unset"}{openClawStatus?.config.gatewayCustomBindHost ? ` (${openClawStatus.config.gatewayCustomBindHost})` : ""} · Port: {openClawStatus?.config.gatewayPort ?? "unknown"}
                      </p>
                      <p className="text-xs leading-5 text-slate-500">
                        Token source: {openClawStatus?.config.gatewayTokenSource ?? "missing"}
                      </p>
                      <p className="text-xs leading-5 text-slate-500">
                        Runtime: {openClawStatus?.gatewayRuntime.status ?? "idle"}
                      </p>
                      <p className="text-xs leading-5 text-slate-500">
                        Routing: {openClawStatus?.config.routingMode ?? "unknown"} · Session prefix: {openClawStatus?.config.sessionKeyPrefix ?? "softbox"}
                      </p>
                    </div>
                  </section>
                </div>

                <section className="border border-white/10 bg-black/20 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Gateway Runtime
                      </p>
                      <h3 className="mt-2 text-lg font-semibold text-white">Local gateway process</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-300">
                        Softbox can start the local OpenClaw gateway itself, and the auth flow will do
                        that automatically when local gateway mode is configured.
                      </p>
                    </div>
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${statusTone(openClawStatus?.gatewayRuntime.status === "completed" ? "healthy" : openClawStatus?.gatewayRuntime.status === "running" ? "warning" : openClawStatus?.gatewayRuntime.status === "failed" ? "error" : "unknown")}`}>
                      {openClawStatus?.gatewayRuntime.status ?? "idle"}
                    </span>
                  </div>
                  <div className="mt-4 border border-white/10 bg-[#0a0d10]">
                    <div className="space-y-3 px-4 py-4">
                      <p className="text-xs leading-5 text-slate-500">
                        {openClawStatus?.gatewayRuntime.command ?? "No local gateway process started from Softbox yet."}
                      </p>
                      {openClawStatus?.gatewayRuntime.error ? (
                        <p className="text-xs leading-5 text-rose-300">{openClawStatus.gatewayRuntime.error}</p>
                      ) : null}
                      <pre className="max-h-52 overflow-auto whitespace-pre-wrap text-xs leading-5 text-slate-300">
                        {(openClawStatus?.gatewayRuntime.logs ?? []).join("\n") || "Gateway logs will appear here."}
                      </pre>
                    </div>
                  </div>
                </section>

                <section className="border border-white/10 bg-black/20 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Provider Auth
                      </p>
                      <h3 className="mt-2 text-lg font-semibold text-white">Run OpenClaw onboard</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-300">
                        Softbox runs local OpenClaw auth on this machine. OpenAI OAuth launches the
                        browser login flow, while API key and token modes still use local CLI auth.
                      </p>
                    </div>
                    {openClawStatus?.onboardSession.status === "running" ? (
                      <button
                        type="button"
                        onClick={() => void cancelOpenClawOnboard()}
                        disabled={openClawActionPending !== null}
                        className="inline-flex h-9 items-center justify-center border border-rose-500/30 bg-rose-500/10 px-3.5 text-sm font-medium text-rose-100 transition-colors hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {openClawActionPending === "cancel" ? "Stopping..." : "Stop"}
                      </button>
                    ) : null}
                  </div>

                  <div className="mt-5 grid gap-4 md:grid-cols-3">
                    <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                      Auth mode
                      <select
                        value={authChoice}
                        onChange={(event) => setAuthChoice(event.target.value)}
                        className="mt-2 h-11 w-full border border-white/10 bg-black/20 px-3 text-sm text-white outline-none transition-colors focus:border-cyan-300/50"
                      >
                        <option value="oauth">OpenAI OAuth (browser)</option>
                        <option value="openai-api-key">OpenAI API key</option>
                        <option value="token">Manual provider token</option>
                      </select>
                    </label>
                    <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                      {authChoice === "token" ? "Token provider" : "Credential"}
                      {authChoice === "token" ? (
                        <input
                          type="text"
                          value={tokenProvider}
                          onChange={(event) => setTokenProvider(event.target.value)}
                          className="mt-2 h-11 w-full border border-white/10 bg-black/20 px-3 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-cyan-300/50"
                        />
                      ) : (
                        <input
                          type="password"
                          value={providerSecret}
                          onChange={(event) => setProviderSecret(event.target.value)}
                          placeholder={
                            authChoice === "oauth"
                              ? "Opens the browser login flow. No secret needed."
                              : authChoice === "openai-api-key"
                                ? "Paste the OpenAI API key"
                                : "Optional"
                          }
                          className="mt-2 h-11 w-full border border-white/10 bg-black/20 px-3 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-cyan-300/50"
                        />
                      )}
                    </label>
                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={() => void startOpenClawOnboard()}
                        disabled={openClawActionPending !== null || openClawStatus?.onboardSession.status === "running"}
                        className="inline-flex h-11 w-full items-center justify-center bg-cyan-300 px-3.5 text-sm font-medium text-black transition-colors hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                      >
                        {openClawActionPending === "onboard" ? "Starting..." : "Run auth flow"}
                      </button>
                    </div>
                  </div>

                  <div className="mt-5 border border-white/10 bg-[#0a0d10]">
                    <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                        Onboard session
                      </p>
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${statusTone(openClawStatus?.onboardSession.status === "completed" ? "healthy" : openClawStatus?.onboardSession.status === "running" ? "warning" : openClawStatus?.onboardSession.status === "failed" ? "error" : "unknown")}`}>
                        {openClawStatus?.onboardSession.status ?? "idle"}
                      </span>
                    </div>
                    <div className="space-y-3 px-4 py-4">
                      <p className="text-xs leading-5 text-slate-500">
                        {openClawStatus?.onboardSession.command ?? "No OpenClaw onboard command has run yet."}
                      </p>
                      {openClawAuthUrl ? (
                        <div className="space-y-2">
                          <a
                            href={openClawAuthUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex h-9 items-center justify-center bg-cyan-300 px-3.5 text-sm font-medium text-black transition-colors hover:bg-cyan-200"
                          >
                            Open OAuth URL
                          </a>
                          <p className="text-xs leading-5 text-slate-500">
                            If OpenClaw falls back to manual paste, finish sign-in in the browser and paste
                            the authorization code or full redirect URL below.
                          </p>
                        </div>
                      ) : null}
                      {openClawStatus?.onboardSession.awaitingInput ? (
                        <div className="space-y-3 border border-white/10 bg-black/20 p-3">
                          <p className="text-xs leading-5 text-slate-300">
                            {openClawStatus.onboardSession.inputPrompt ??
                              "Paste the authorization code or full redirect URL."}
                          </p>
                          <textarea
                            value={oauthCallbackInput}
                            onChange={(event) => setOauthCallbackInput(event.target.value)}
                            rows={3}
                            className="w-full border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-cyan-300/50"
                            placeholder="Paste the authorization code or full redirect URL"
                          />
                          <button
                            type="button"
                            onClick={() => void submitOpenClawOnboardInput()}
                            disabled={openClawActionPending !== null || oauthCallbackInput.trim().length === 0}
                            className="inline-flex h-9 items-center justify-center bg-cyan-300 px-3.5 text-sm font-medium text-black transition-colors hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                          >
                            {openClawActionPending === "submit-oauth"
                              ? "Submitting..."
                              : "Submit auth code"}
                          </button>
                        </div>
                      ) : null}
                      {openClawStatus?.onboardSession.error ? (
                        <p className="text-xs leading-5 text-rose-300">{openClawStatus.onboardSession.error}</p>
                      ) : null}
                      <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-xs leading-5 text-slate-300">
                        {(openClawStatus?.onboardSession.logs ?? []).join("\n") || "Session output will appear here."}
                      </pre>
                    </div>
                  </div>
                </section>
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
