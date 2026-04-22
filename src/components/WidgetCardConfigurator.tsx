import { useState } from "react";
import type { Provider } from "../types/usage";
import type { WidgetCardId, WidgetProviderCardVisibility } from "../types/widget";

// ─── Metadata ────────────────────────────────────────────────────────────────

const CARD_META: Record<WidgetCardId, {
  label: string;
  desc: string;
  providers: Provider[];
  accent: string;
}> = {
  session:  { label: "5h Session",       desc: "Current 5-hour usage window",   providers: ["Claude", "Codex", "Cursor"], accent: "#6b9ef0" },
  weekly:   { label: "7-day Rolling",    desc: "Rolling weekly total",           providers: ["Claude", "Codex"],           accent: "#c4855a" },
  extra:    { label: "Extra Credits",    desc: "Paid overage usage",             providers: ["Claude"],                    accent: "#f59e0b" },
  balance:  { label: "Prepaid Balance",  desc: "Account credit reserve",         providers: ["Claude"],                    accent: "#22d3ee" },
  credits:  { label: "Codex Credits",    desc: "OpenAI credit balance",          providers: ["Codex"],                     accent: "#22c55e" },
  design:   { label: "Design 7-day",     desc: "Claude Design weekly window",    providers: ["Claude"],                    accent: "#a78bfa" },
  status:   { label: "API Status",       desc: "Service health indicator",       providers: ["Claude", "Codex", "Cursor"], accent: "#6ce7bd" },
};

const PROVIDER_META: Record<Provider, { initial: string; color: string }> = {
  Claude: { initial: "C", color: "#c4855a" },
  Codex:  { initial: "X", color: "#22c55e" },
  Cursor: { initial: "◎", color: "#60a5fa" },
};

// ─── Reorder helper ──────────────────────────────────────────────────────────

function insertBefore(order: WidgetCardId[], dragId: WidgetCardId, overId: WidgetCardId): WidgetCardId[] {
  const next = order.filter((id) => id !== dragId);
  const idx = next.indexOf(overId);
  next.splice(idx, 0, dragId);
  return next;
}

// ─── Drag handle SVG ─────────────────────────────────────────────────────────

function DragHandle() {
  return (
    <svg
      width="10"
      height="14"
      viewBox="0 0 10 14"
      fill="currentColor"
      style={{ display: "block", flexShrink: 0 }}
    >
      <circle cx="2.5" cy="2"  r="1.15" />
      <circle cx="7.5" cy="2"  r="1.15" />
      <circle cx="2.5" cy="7"  r="1.15" />
      <circle cx="7.5" cy="7"  r="1.15" />
      <circle cx="2.5" cy="12" r="1.15" />
      <circle cx="7.5" cy="12" r="1.15" />
    </svg>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

interface Props {
  cardOrder: WidgetCardId[];
  cardVisibility: WidgetProviderCardVisibility;
  onReorder: (newOrder: WidgetCardId[]) => void;
  onVisibilityChange: (provider: Provider, cardId: WidgetCardId, value: boolean) => void;
}

export function WidgetCardConfigurator({ cardOrder, cardVisibility, onReorder, onVisibilityChange }: Props) {
  const [dragId, setDragId] = useState<WidgetCardId | null>(null);
  const [overId, setOverId] = useState<WidgetCardId | null>(null);

  function handleDragStart(e: React.DragEvent, id: WidgetCardId) {
    // dataTransfer.setData is required for HTML5 DnD to fire dragover/drop in WebView2
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
    setDragId(id);
  }

  function handleDragOver(e: React.DragEvent, id: WidgetCardId) {
    e.preventDefault();
    e.stopPropagation();
    if (id !== dragId) setOverId(id);
  }

  function handleDrop(e: React.DragEvent, id: WidgetCardId) {
    e.preventDefault();
    e.stopPropagation();
    const dropped = (e.dataTransfer.getData("text/plain") as WidgetCardId) || dragId;
    if (dropped && id !== dropped) {
      onReorder(insertBefore(cardOrder, dropped, id));
    }
    setDragId(null);
    setOverId(null);
  }

  function handleDragEnd() {
    setDragId(null);
    setOverId(null);
  }

  function handleListDragOver(e: React.DragEvent) {
    e.preventDefault();
  }

  function handleListDrop(e: React.DragEvent) {
    e.preventDefault();
    const dropped = (e.dataTransfer.getData("text/plain") as WidgetCardId) || dragId;
    if (dropped && overId === null) {
      const next = cardOrder.filter((id) => id !== dropped);
      next.push(dropped);
      onReorder(next);
    }
    setDragId(null);
    setOverId(null);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <p style={{
        fontSize: 11,
        color: "var(--text-muted)",
        lineHeight: 1.5,
        marginBottom: 2,
      }}>
        Drag rows to reorder. Toggle provider badges to show or hide a card for that provider.
        Order is shared across all themes.
      </p>

      <div
        onDragOver={handleListDragOver}
        onDrop={handleListDrop}
      >
        {cardOrder.map((cardId) => {
          const meta = CARD_META[cardId];
          const isDragging = dragId === cardId;
          const isTarget = overId === cardId;

          return (
            <div key={cardId}>
              {/* Drop-target indicator line */}
              <div style={{
                height: isTarget ? 2 : 0,
                background: "var(--blue)",
                borderRadius: 1,
                marginBottom: isTarget ? 4 : 0,
                transition: "height 0.1s, margin-bottom 0.1s",
                boxShadow: isTarget ? "0 0 6px rgba(59,130,246,0.6)" : "none",
              }} />

              <div
                draggable
                onDragStart={(e) => handleDragStart(e, cardId)}
                onDragOver={(e) => handleDragOver(e, cardId)}
                onDrop={(e) => handleDrop(e, cardId)}
                onDragEnd={handleDragEnd}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "7px 10px",
                  background: isDragging
                    ? "rgba(59,130,246,0.06)"
                    : "var(--bg-card)",
                  border: "1px solid var(--border)",
                  borderLeft: `3px solid ${meta.accent}`,
                  borderRadius: "var(--radius)",
                  opacity: isDragging ? 0.45 : 1,
                  cursor: "grab",
                  transition: "opacity 0.15s, background 0.15s",
                  userSelect: "none",
                  marginBottom: 4,
                }}
              >
                {/* Drag handle */}
                <span style={{ color: "var(--text-muted)", opacity: 0.5, flexShrink: 0 }}>
                  <DragHandle />
                </span>

                {/* Accent dot */}
                <span style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: meta.accent,
                  boxShadow: `0 0 5px ${meta.accent}88`,
                  flexShrink: 0,
                }} />

                {/* Label + description */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--text)",
                    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                    letterSpacing: "0.02em",
                    lineHeight: 1.2,
                  }}>
                    {meta.label}
                  </div>
                  <div style={{
                    fontSize: 10,
                    color: "var(--text-muted)",
                    marginTop: 2,
                    lineHeight: 1.3,
                  }}>
                    {meta.desc}
                  </div>
                </div>

                {/* Provider visibility badges */}
                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  {meta.providers.map((provider) => {
                    const pm = PROVIDER_META[provider];
                    const visible = cardVisibility[provider][cardId];
                    return (
                      <button
                        key={provider}
                        type="button"
                        title={`${visible ? "Hide" : "Show"} for ${provider}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onVisibilityChange(provider, cardId, !visible);
                        }}
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: "50%",
                          border: `1.5px solid ${visible ? pm.color : "rgba(255,255,255,0.12)"}`,
                          background: visible ? `${pm.color}22` : "transparent",
                          color: visible ? pm.color : "rgba(255,255,255,0.25)",
                          fontSize: 9,
                          fontWeight: 700,
                          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          transition: "all 0.15s",
                          flexShrink: 0,
                          lineHeight: 1,
                          padding: 0,
                        }}
                      >
                        {pm.initial}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Provider legend */}
      <div style={{
        display: "flex",
        gap: 12,
        marginTop: 2,
        paddingTop: 6,
        borderTop: "1px solid var(--border)",
      }}>
        {(["Claude", "Codex", "Cursor"] as Provider[]).map((p) => (
          <div key={p} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{
              width: 16,
              height: 16,
              borderRadius: "50%",
              border: `1.5px solid ${PROVIDER_META[p].color}`,
              background: `${PROVIDER_META[p].color}22`,
              color: PROVIDER_META[p].color,
              fontSize: 9,
              fontWeight: 700,
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}>
              {PROVIDER_META[p].initial}
            </span>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{p}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
