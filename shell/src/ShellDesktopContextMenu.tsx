import type { ReactNode } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { Check, Grid2x2, Image as ImageIcon, Layers3, Plus, RefreshCw, Server } from "lucide-react";

type DesktopTabId = "apps" | "services" | "server";

type ShellDesktopContextMenuProps = {
  activeTab: DesktopTabId;
  canCreateApp?: boolean;
  mountedAppId: string | null;
  onChangeTab: (tab: DesktopTabId) => void;
  onChangeWallpaper: () => void;
  onCreateApp?: () => void;
  onOpenApps: () => void;
  onRefresh: () => void;
  children: ReactNode;
};

type DesktopContextMenuItemProps = {
  icon: ReactNode;
  label: string;
  detail?: string;
  active?: boolean;
  onSelect: () => void;
};

function DesktopContextMenuItem(props: DesktopContextMenuItemProps) {
  const { icon, label, detail, active = false, onSelect } = props;

  return (
    <ContextMenu.Item
      onSelect={() => onSelect()}
      className="group relative flex cursor-default select-none items-start gap-3 rounded-[0.9rem] px-3 py-2.5 text-sm text-slate-200 outline-none transition-colors data-[highlighted]:bg-cyan-300/12 data-[highlighted]:text-white"
    >
      <span className="mt-0.5 text-cyan-200/70 transition-colors group-data-[highlighted]:text-cyan-100">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium tracking-[0.01em]">{label}</span>
        {detail ? <span className="mt-0.5 block text-xs leading-5 text-slate-500">{detail}</span> : null}
      </span>
      <Check
        className={`mt-0.5 size-4 text-cyan-200 transition-opacity group-data-[highlighted]:text-cyan-100 ${
          active ? "opacity-100" : "opacity-0"
        }`}
      />
    </ContextMenu.Item>
  );
}

export function ShellDesktopContextMenu(props: ShellDesktopContextMenuProps) {
  const {
    activeTab,
    canCreateApp = false,
    mountedAppId,
    onChangeTab,
    onChangeWallpaper,
    onCreateApp,
    onOpenApps,
    onRefresh,
    children,
  } = props;

  const refreshLabel =
    activeTab === "services" ? "Refresh Services" : activeTab === "server" ? "Refresh Server" : "Refresh Apps";
  const refreshDetail =
    activeTab === "services"
      ? "Reload service and OpenClaw status"
      : activeTab === "server"
        ? "Reload machine and runtime information"
        : "Reload app install and desktop state";

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          collisionPadding={16}
          className="z-[60] min-w-[260px] overflow-hidden rounded-[1.1rem] border border-cyan-200/12 bg-[#060a0f]/96 p-1.5 text-slate-100 shadow-[0_28px_90px_rgba(0,0,0,0.6)] backdrop-blur-xl"
        >
          <div className="rounded-[0.9rem] border border-white/6 bg-[linear-gradient(180deg,rgba(103,232,249,0.08),rgba(255,255,255,0.02)_22%,rgba(255,255,255,0.01))]">
            <div className="px-3 pb-2 pt-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-cyan-200/65">Desktop</p>
              <p className="mt-1 text-xs leading-5 text-slate-400">
                {mountedAppId ? (
                  <>
                    Mounted app: <span className="text-slate-200">{mountedAppId}</span>
                  </>
                ) : (
                  "Softbox host surface"
                )}
              </p>
            </div>

            <div className="px-1 pb-1">
              <DesktopContextMenuItem
                icon={<Grid2x2 className="size-4" />}
                label="Open App Switcher"
                detail="Open the shell-level app picker"
                onSelect={onOpenApps}
              />
              {canCreateApp && onCreateApp ? (
                <DesktopContextMenuItem
                  icon={<Plus className="size-4" />}
                  label="Create App"
                  detail="Create and seed a new Softbox app"
                  onSelect={onCreateApp}
                />
              ) : null}
              <DesktopContextMenuItem
                icon={<ImageIcon className="size-4" />}
                label="Change Wallpaper"
                detail="Pick a desktop wallpaper and fit mode"
                onSelect={onChangeWallpaper}
              />

              <ContextMenu.Separator className="mx-2 my-1.5 h-px bg-white/8" />

              <DesktopContextMenuItem
                icon={<Layers3 className="size-4" />}
                label="Services"
                detail="Open service status and OpenClaw controls"
                active={activeTab === "services"}
                onSelect={() => onChangeTab("services")}
              />
              <DesktopContextMenuItem
                icon={<Server className="size-4" />}
                label="Server"
                detail="Open machine and runtime information"
                active={activeTab === "server"}
                onSelect={() => onChangeTab("server")}
              />

              <ContextMenu.Separator className="mx-2 my-1.5 h-px bg-white/8" />

              <DesktopContextMenuItem
                icon={<RefreshCw className="size-4" />}
                label={refreshLabel}
                detail={refreshDetail}
                onSelect={onRefresh}
              />
            </div>
          </div>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
