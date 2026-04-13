import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalPosition, LogicalSize } from "@tauri-apps/api/window";
import { useEffect, useMemo, useRef, useState } from "react";
import { useWidget } from "../context/WidgetContext";
import { useWidgetData } from "../hooks/useWidgetData";
import { useWidgetStore } from "../hooks/useWidgetStore";
import type { WidgetCardViewModel } from "../types/widget";
import { WidgetCard } from "./WidgetCard";
import { MatrixRain } from "./MatrixRain";
import { isTauriRuntime } from "./preview";
import { selectWidgetCardModels } from "./selectors";
import { getWidgetTheme } from "./themes";

type Hitbox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

function isInHitbox(deviceX: number, deviceY: number, hitbox: Hitbox): boolean {
  const x = deviceX / window.devicePixelRatio;
  const y = deviceY / window.devicePixelRatio;
  return x >= hitbox.left && x <= hitbox.left + hitbox.width && y >= hitbox.top && y <= hitbox.top + hitbox.height;
}

function clampProgress(progress?: number | null) {
  if (progress == null || Number.isNaN(progress)) return 0;
  return Math.max(0, Math.min(100, progress));
}

function compactLabel(card: WidgetCardViewModel) {
  return card.shortTitle ?? card.title.slice(0, 3).toUpperCase();
}

function TickerCell({ card }: { card: WidgetCardViewModel }) {
  return (
    <div className={`widget-ticker-cell${card.tone === "muted" ? " is-muted" : ""}`}>
      <span className="widget-ticker-cell__label">{compactLabel(card)}</span>
      <span className="widget-ticker-cell__value">{card.primary}</span>
      {card.secondary && <span className="widget-ticker-cell__sub">{card.secondary}</span>}
      {card.progress != null && (
        <span className="widget-ticker-cell__meter">
          <span className="widget-ticker-cell__fill" style={{ width: `${clampProgress(card.progress)}%` }} />
        </span>
      )}
    </div>
  );
}

function DeckCell({ card }: { card: WidgetCardViewModel }) {
  return (
    <div className={`widget-deck-cell${card.tone === "muted" ? " is-muted" : ""}`}>
      <div className="widget-deck-cell__topline">
        <span className="widget-deck-cell__label">{card.title}</span>
        <span className="widget-deck-cell__icon">{card.icon}</span>
      </div>
      <div className="widget-deck-cell__value">{card.primary}</div>
      {card.secondary && <div className="widget-deck-cell__sub">{card.secondary}</div>}
      {card.progress != null && (
        <div className="widget-deck-cell__meter">
          <div className="widget-deck-cell__fill" style={{ width: `${clampProgress(card.progress)}%` }} />
        </div>
      )}
    </div>
  );
}

export function WidgetOverlay() {
  useWidgetData();
  const { savePosition } = useWidgetStore();
  const { state } = useWidget();
  const rootRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const restoredPositionRef = useRef(false);
  const dragRef = useRef(false);
  const ignoreStateRef = useRef<boolean | null>(null);
  const [hitboxes, setHitboxes] = useState<Hitbox[]>([]);
  const tauri = isTauriRuntime();

  const visibleCards = useMemo(
    () => selectWidgetCardModels(state, state.layout).filter((card) => card.visible),
    [state],
  );
  const theme = getWidgetTheme(state.layout.themeId);

  // Only the header is an interactive hitbox — cards are display-only (click-through).
  function recalcHitboxes() {
    const next: Hitbox[] = [];
    const header = headerRef.current?.getBoundingClientRect();
    if (header) {
      next.push({
        left: header.left,
        top: header.top,
        width: header.width,
        height: header.height,
      });
      // Push the header rect to the native drag monitor so it only allows
      // drag from the header, not from card areas that slip through during
      // the setIgnoreCursorEvents transition.
      if (tauri) {
        invoke("set_widget_drag_rect", {
          x: header.left,
          y: header.top,
          w: header.width,
          h: header.height,
        }).catch(() => {});
      }
    }
    setHitboxes(next);
  }

  useEffect(() => {
    if (!tauri) return;
    if (!restoredPositionRef.current) {
      restoredPositionRef.current = true;
      getCurrentWindow().setPosition(new LogicalPosition(state.layout.position.x, state.layout.position.y)).catch(() => {});
    }
    getCurrentWindow().setIgnoreCursorEvents(true).catch(() => {});
    ignoreStateRef.current = true;
  }, [state.layout.position.x, state.layout.position.y, tauri]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const recalc = () => {
      recalcHitboxes();
    };

    const observer = new ResizeObserver(() => {
      recalc();
      if (tauri) {
        const rect = root.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          getCurrentWindow().setSize(new LogicalSize(Math.ceil(rect.width), Math.ceil(rect.height)))
            .then(() => emit("widget-geometry-sync"))
            .catch(() => {});
        }
      }
    });

    observer.observe(root);
    window.addEventListener("resize", recalc);
    recalc();

    if (tauri) {
      requestAnimationFrame(() => {
        const rect = root.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          getCurrentWindow().setSize(new LogicalSize(Math.ceil(rect.width), Math.ceil(rect.height)))
            .then(() => emit("widget-geometry-sync"))
            .catch(() => {});
        }
      });
    }

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", recalc);
    };
  }, [tauri, visibleCards, theme, state.layout.density, state.layout.scale]);

  useEffect(() => {
    if (!tauri) return;
    const unlistenMove = getCurrentWindow().onMoved(({ payload }) => {
      if (!dragRef.current) return;
      savePosition(payload.x, payload.y);
      recalcHitboxes();
    });

    return () => {
      unlistenMove.then((fn) => fn());
    };
  }, [savePosition, tauri]);

  useEffect(() => {
    if (!tauri) return;

    const unlisten = listen<{ x: number; y: number }>("device-mouse-move", ({ payload }) => {
      const inHeader = hitboxes.some((box) => isInHitbox(payload.x, payload.y, box));
      const shouldIgnore = !dragRef.current && !inHeader;
      if (ignoreStateRef.current === shouldIgnore) return;
      ignoreStateRef.current = shouldIgnore;
      getCurrentWindow().setIgnoreCursorEvents(shouldIgnore).catch(() => {});
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [hitboxes, tauri]);

  useEffect(() => {
    function stopDragging() {
      dragRef.current = false;
    }

    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("mouseup", stopDragging);
    window.addEventListener("blur", stopDragging);
    return () => {
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("mouseup", stopDragging);
      window.removeEventListener("blur", stopDragging);
    };
  }, []);

  function handleHeaderPointerDown() {
    dragRef.current = true;
    ignoreStateRef.current = false;
    if (!tauri) return;
    getCurrentWindow().setIgnoreCursorEvents(false).catch(() => {});
    // On macOS, a native NSEvent local monitor calls performWindowDragWithEvent:
    // before this handler fires, so startDragging() is redundant there.
    // On other platforms, data-tauri-drag-region on the header handles it.
  }

  return (
    <div
      ref={rootRef}
      className={[
        "widget-overlay",
        `widget-overlay--${theme.id}`,
        `widget-overlay--${theme.layoutFamily}`,
        `widget-overlay--${theme.headerStyle}`,
        `widget-overlay--${state.layout.density}`,
      ].join(" ")}
      style={{
        ["--widget-stack-gap" as string]: `${theme.stackGap[state.layout.density]}px`,
        ["--widget-scale" as string]: String(state.layout.scale),
        ["--widget-accent-override" as string]: (state.layout.themeOverrides[theme.id]?.accentColor as string) || "",
      }}
    >
      <div
        ref={headerRef}
        className="widget-overlay__provider"
        data-tauri-drag-region
        onPointerDown={handleHeaderPointerDown}
      >
        <span className="widget-overlay__provider-dot" />
        <span className="widget-overlay__provider-name">{state.activeProvider}</span>
      </div>
      {theme.id === "matrix-rain" && (
        <MatrixRain
          opacity={0.1}
          speed={0.8}
          color={(state.layout.themeOverrides["matrix-rain"]?.accentColor as string) || "#00ff41"}
        />
      )}
      {theme.id === "mono-ticker" ? (
        <div className="widget-overlay__ticker-board">
          {visibleCards.map((card) => (
            <div
              key={card.id}
              className="widget-overlay__card-shell widget-overlay__card-shell--ticker"
              style={{ ["--widget-card-accent" as string]: card.accent }}
            >
              <TickerCell card={card} />
            </div>
          ))}
        </div>
      ) : theme.id === "signal-deck" ? (
        <div className="widget-overlay__deck-board">
          {visibleCards.map((card) => (
            <div
              key={card.id}
              className="widget-overlay__card-shell widget-overlay__card-shell--deck"
              style={{ ["--widget-card-accent" as string]: card.accent }}
            >
              <DeckCell card={card} />
            </div>
          ))}
        </div>
      ) : (
        visibleCards.map((card) => (
          <div key={card.id} className="widget-overlay__card-shell">
            <WidgetCard
              card={card}
              density={state.layout.density}
              theme={theme}
            />
          </div>
        ))
      )}
    </div>
  );
}
