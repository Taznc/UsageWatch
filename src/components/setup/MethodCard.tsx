import type { MethodConfig } from "../../types/setup";

type MethodStatus = "idle" | "loading" | "success" | "error";

interface MethodCardProps {
  config: MethodConfig;
  status: MethodStatus;
  error?: string;
  selected?: boolean;
  onClick: () => void;
}

const METHOD_ICONS: Record<string, string> = {
  browser: "\u25C9",    // ◉
  desktop_app: "\u25C6", // ◆
  manual: "\u270E",      // ✎
};

export function MethodCard({ config, status, error, selected, onClick }: MethodCardProps) {
  const disabled = !config.available || status === "loading";

  return (
    <div
      className={[
        "method-card",
        !config.available && "unavailable",
        status === "loading" && "loading",
        status === "success" && "success",
        status === "error" && "error",
        selected && "selected",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        className="method-card-btn"
        onClick={onClick}
        disabled={disabled}
      >
        <span className="method-card-icon">{METHOD_ICONS[config.method] ?? "?"}</span>
        <div className="method-card-text">
          <span className="method-card-label">{config.label}</span>
          <span className="method-card-desc">
            {config.available ? config.description : config.unavailableReason}
          </span>
        </div>
        <span className="method-card-status">
          {status === "loading" && <span className="method-spinner" />}
          {status === "success" && "\u2713"}
        </span>
      </button>
      {status === "error" && error && (
        <div className="method-card-error">{error}</div>
      )}
    </div>
  );
}
