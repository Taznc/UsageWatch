export type SectionId = "connections" | "tray" | "widget" | "alerts" | "mcp" | "general" | "debug";

const isMacSidebar = /mac/i.test(navigator.userAgent);

interface SidebarItem {
  id: SectionId;
  icon: string;
  label: string;
  debug?: boolean;
}

const SIDEBAR_ITEMS: SidebarItem[] = [
  { id: "connections", icon: "🔗", label: "Connections" },
  { id: "tray",        icon: "📊", label: isMacSidebar ? "Menu Bar" : "Tray" },
  { id: "widget",      icon: "🪟", label: "Widget" },
  { id: "alerts",      icon: "🔔", label: "Alerts" },
  { id: "mcp",         icon: "🧩", label: "MCP" },
  { id: "general",     icon: "⚙️",  label: "General" },
  { id: "debug",       icon: "🐛", label: "Debug", debug: true },
];

interface Props {
  active: SectionId;
  onSelect: (id: SectionId) => void;
}

export function SettingsSidebar({ active, onSelect }: Props) {
  return (
    <nav className="settings-sidebar" aria-label="Settings navigation">
      {SIDEBAR_ITEMS.map((item) => (
        <button
          key={item.id}
          className={[
            "snav-item",
            active === item.id ? "active" : "",
            item.debug ? "snav-item--debug" : "",
          ].filter(Boolean).join(" ")}
          onClick={() => onSelect(item.id)}
          aria-current={active === item.id ? "page" : undefined}
        >
          <span className="snav-icon" aria-hidden="true">{item.icon}</span>
          <span className="snav-label">{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
