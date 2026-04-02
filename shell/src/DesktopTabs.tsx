type DesktopTabId = "apps" | "services" | "server";

type DesktopTabsProps = {
  activeTab: DesktopTabId;
  onChange: (tab: DesktopTabId) => void;
};

const desktopTabs: Array<{ id: DesktopTabId; label: string }> = [
  { id: "apps", label: "Apps" },
  { id: "services", label: "Services" },
  { id: "server", label: "Server" },
];

export function DesktopTabs(props: DesktopTabsProps) {
  const { activeTab, onChange } = props;

  return (
    <div className="inline-flex w-fit border border-white/10 bg-black/20 p-1">
      {desktopTabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={`h-9 px-4 text-sm transition-colors ${
            activeTab === tab.id ? "bg-white text-black" : "text-slate-300 hover:bg-white/8"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
