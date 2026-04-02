import type { ReactNode } from "react";

type DesktopActionCardAction = {
  label: string;
  onClick: () => void;
  tone?: "primary" | "secondary";
  icon?: ReactNode;
  iconOnly?: boolean;
};

type DesktopActionCardProps = {
  eyebrow?: string;
  title: string;
  description: string;
  detail: string;
  accentClassName?: string;
  actions?: DesktopActionCardAction[];
  onClick?: () => void;
};

export function DesktopActionCard(props: DesktopActionCardProps) {
  const {
    eyebrow,
    title,
    description,
    detail,
    accentClassName = "from-cyan-300/30 via-cyan-200/10 to-transparent",
    actions = [],
    onClick,
  } = props;

  return (
    <article
      className={`max-w-[240px] overflow-hidden border border-white/10 bg-[#0a0d11]/80 ${onClick ? "cursor-pointer transition-colors hover:bg-[#0d1218]" : ""}`}
      onClick={onClick}
    >
      <div className={`h-16 bg-gradient-to-br ${accentClassName}`}>
        <div className="flex h-full items-end border-b border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(0,0,0,0.22))] p-3">
          <div>
            {eyebrow ? (
              <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/55">
                {eyebrow}
              </p>
            ) : null}
            <h2 className="mt-1 text-sm font-semibold tracking-tight text-white">{title}</h2>
          </div>
        </div>
      </div>

      <div className="space-y-3 p-3">
        <p className="text-xs leading-4 text-slate-300">{description}</p>

        <div className="border border-white/8 bg-black/20 px-2.5 py-2">
          <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            Detail
          </p>
          <p className="mt-1 text-[11px] leading-4 text-slate-200">{detail}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                action.onClick();
              }}
              aria-label={action.label}
              title={action.label}
              className={
                action.tone === "secondary"
                  ? `inline-flex h-10 items-center justify-center border border-white/10 bg-white/5 text-sm font-medium text-slate-200 transition-colors hover:bg-white/10 ${action.iconOnly ? "w-10" : "gap-2 px-4"}`
                  : `inline-flex h-10 items-center justify-center bg-white text-sm font-medium text-black transition-colors hover:bg-slate-200 ${action.iconOnly ? "w-10" : "gap-2 px-4"}`
              }
            >
              {action.icon ? <span className="inline-flex items-center justify-center">{action.icon}</span> : null}
              {action.iconOnly ? null : action.label}
            </button>
          ))}
        </div>
      </div>
    </article>
  );
}
