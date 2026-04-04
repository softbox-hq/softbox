import type { ReactNode } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";

type DesktopActionCardAction = {
  label: string;
  onClick: () => void;
  tone?: "primary" | "secondary";
  icon?: ReactNode;
  iconOnly?: boolean;
};

type DesktopActionCardProps = {
  title: string;
  iconSrc?: string;
  selected?: boolean;
  actions?: DesktopActionCardAction[];
  onClick?: () => void;
};

export function DesktopActionCard(props: DesktopActionCardProps) {
  const { title, iconSrc, selected = false, actions = [], onClick } = props;
  const fallbackLabel = title.slice(0, 2).toUpperCase();

  const trigger = (
    <button
      type="button"
      data-app-context-menu-trigger="true"
      data-desktop-context-menu-block="true"
      onClick={onClick}
      onContextMenu={(event) => {
        event.stopPropagation();
      }}
      className={`group flex w-[92px] flex-col items-center gap-2 rounded-xl px-2 py-2 text-center outline-none transition-colors ${
        selected
          ? "bg-cyan-300/10 ring-1 ring-cyan-200/25"
          : "hover:bg-white/6 focus-visible:bg-white/6"
      }`}
    >
      <span
        className={`pointer-events-none flex size-[72px] items-center justify-center overflow-hidden rounded-[1.35rem] shadow-[0_16px_30px_rgba(0,0,0,0.28)] transition-transform group-hover:scale-[1.03] ${
          iconSrc
            ? "bg-transparent"
            : "border border-white/10 bg-[linear-gradient(180deg,rgba(148,163,184,0.22),rgba(15,23,42,0.9))]"
        }`}
      >
        {iconSrc ? (
          <img src={iconSrc} alt="" className="pointer-events-none size-full object-contain" draggable={false} />
        ) : (
          <span className="pointer-events-none text-lg font-semibold tracking-[0.08em] text-slate-100">
            {fallbackLabel}
          </span>
        )}
      </span>
      <span
        className={`pointer-events-none max-w-full break-words text-[12px] leading-4 ${
          selected ? "font-semibold text-cyan-100" : "font-medium text-slate-100"
        }`}
      >
        {title}
      </span>
    </button>
  );

  if (actions.length === 0) {
    return trigger;
  }

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{trigger}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          collisionPadding={12}
          className="z-[70] min-w-[180px] overflow-hidden rounded-[1rem] border border-cyan-200/12 bg-[#060a0f]/96 p-1.5 text-slate-100 shadow-[0_28px_90px_rgba(0,0,0,0.6)] backdrop-blur-xl"
        >
          <div className="rounded-[0.85rem] border border-white/6 bg-[linear-gradient(180deg,rgba(103,232,249,0.06),rgba(255,255,255,0.02)_22%,rgba(255,255,255,0.01))] p-1">
            {onClick ? (
              <>
                <ContextMenu.Item
                  onSelect={() => onClick()}
                  className="flex cursor-default select-none items-center gap-3 rounded-[0.8rem] px-3 py-2 text-sm font-medium text-slate-100 outline-none transition-colors data-[highlighted]:bg-cyan-300/12"
                >
                  Open
                </ContextMenu.Item>
                <ContextMenu.Separator className="mx-2 my-1 h-px bg-white/8" />
              </>
            ) : null}

            {actions.map((action) => (
              <ContextMenu.Item
                key={action.label}
                onSelect={() => action.onClick()}
                className={`flex cursor-default select-none items-center gap-3 rounded-[0.8rem] px-3 py-2 text-sm outline-none transition-colors data-[highlighted]:bg-white/8 ${
                  action.tone === "secondary" ? "text-rose-200" : "text-slate-100"
                }`}
              >
                {action.icon ? <span className="inline-flex items-center justify-center">{action.icon}</span> : null}
                <span>{action.label}</span>
              </ContextMenu.Item>
            ))}
          </div>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
