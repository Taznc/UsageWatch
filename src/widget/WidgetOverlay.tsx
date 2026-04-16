import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalPosition, LogicalSize } from "@tauri-apps/api/window";
import { useEffect, useMemo, useRef, useState } from "react";
import { useWidget } from "../context/WidgetContext";
import { useWidgetData } from "../hooks/useWidgetData";
import { useWidgetStore } from "../hooks/useWidgetStore";
import type { WidgetCardViewModel } from "../types/widget";
import { WidgetCard, resolveWidgetCardSecondary } from "./WidgetCard";
import { ProviderBadge } from "./ProviderBadge";
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

function measureWindowBounds(element: HTMLDivElement, scale: number) {
  const normalizedScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const rect = element.getBoundingClientRect();
  const visualWidth = rect.width;
  const visualHeight = rect.height;
  const fallbackWidth = element.scrollWidth * normalizedScale;
  const fallbackHeight = element.scrollHeight * normalizedScale;
  return {
    width: Math.ceil(Math.max(visualWidth, fallbackWidth)) + 2,
    height: Math.ceil(Math.max(visualHeight, fallbackHeight)) + 2,
  };
}

function compactLabel(card: WidgetCardViewModel) {
  return card.shortTitle ?? card.title.slice(0, 3).toUpperCase();
}

function TickerCell({
  card,
  resetDisplayMode,
}: {
  card: WidgetCardViewModel;
  resetDisplayMode: "time" | "countdown" | "both";
}) {
  const detailText = resolveWidgetCardSecondary(card, resetDisplayMode);

  return (
    <div className={`widget-ticker-cell${card.tone === "muted" ? " is-muted" : ""}`}>
      <span className="widget-ticker-cell__label">{compactLabel(card)}</span>
      <span className="widget-ticker-cell__value">{card.primary}</span>
      {detailText && <span className="widget-ticker-cell__sub">{detailText}</span>}
      {card.progress != null && (
        <span className="widget-ticker-cell__meter">
          <span className="widget-ticker-cell__fill" style={{ width: `${clampProgress(card.progress)}%` }} />
        </span>
      )}
    </div>
  );
}

function PinboardCell({
  card,
  resetDisplayMode,
}: {
  card: WidgetCardViewModel;
  resetDisplayMode: "time" | "countdown" | "both";
}) {
  const detailText = resolveWidgetCardSecondary(card, resetDisplayMode);

  return (
    <div className={`widget-pinboard-cell${card.tone === "muted" ? " is-muted" : ""}`}>
      <div className="widget-pinboard-cell__pin">{card.icon}</div>
      <div className="widget-pinboard-cell__body">
        <div className="widget-pinboard-cell__topline">
          <span className="widget-pinboard-cell__value">{card.primary}</span>
          <span className="widget-pinboard-cell__label">{card.title}</span>
        </div>
        {detailText && <div className="widget-pinboard-cell__sub">{detailText}</div>}
        {card.progress != null && (
          <div className="widget-pinboard-cell__meter">
            <div className="widget-pinboard-cell__fill" style={{ width: `${clampProgress(card.progress)}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}

export function WidgetOverlay() {
  useWidgetData();
  const { savePosition } = useWidgetStore();
  const { state } = useWidget();
  const rootRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef(false);
  const ignoreStateRef = useRef<boolean | null>(null);
  const [hitboxes, setHitboxes] = useState<Hitbox[]>([]);
  const tauri = isTauriRuntime();

  const visibleCards = useMemo(
    () => selectWidgetCardModels(state, state.layout).filter((card) => card.visible),
    [state],
  );
  const theme = getWidgetTheme(state.layout.themeId);
  const customization = state.layout.themeCustomizations[theme.id] ?? {};
  const resetDisplayMode = customization.resetDisplayMode ?? "time";

  function syncWindowSize(target: HTMLDivElement) {
    if (!tauri) return;
    const { width, height } = measureWindowBounds(target, state.layout.scale);
    if (width <= 0 || height <= 0) return;
    getCurrentWindow()
      .setSize(new LogicalSize(width, height))
      .then(() => emit("widget-geometry-sync"))
      .catch(() => {});
  }

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

  // Force the WebView2 background to transparent once the webview is ready.
  // Calling from JS guarantees the WebView2 controller is initialised.
  useEffect(() => {
    if (!tauri) return;
    invoke("force_widget_transparent").catch(() => {});
  }, [tauri]);

  // Keep the native window aligned with persisted layout whenever the store hydrates or the user moves.
  // (Previously we only applied position once on mount, so the default layout won before credentials.json loaded.)
  useEffect(() => {
    if (!tauri) return;
    getCurrentWindow()
      .setPosition(new LogicalPosition(state.layout.position.x, state.layout.position.y))
      .catch(() => {});
    getCurrentWindow().setIgnoreCursorEvents(true).catch(() => {});
    ignoreStateRef.current = true;
  }, [state.layout.position.x, state.layout.position.y, tauri]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let frame = 0;
    let nestedFrame = 0;
    let cancelled = false;

    const scheduleSync = () => {
      if (!tauri) return;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(nestedFrame);
      frame = requestAnimationFrame(() => {
        nestedFrame = requestAnimationFrame(() => {
          if (!cancelled && root.isConnected) {
            syncWindowSize(root);
          }
        });
      });
    };

    const recalc = () => {
      recalcHitboxes();
      scheduleSync();
    };

    const observer = new ResizeObserver(() => {
      recalc();
    });

    observer.observe(root);
    window.addEventListener("resize", recalc);
    recalc();

    if (tauri && "fonts" in document) {
      document.fonts.ready.then(() => {
        if (!cancelled) {
          scheduleSync();
        }
      });
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(nestedFrame);
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
    return () => {
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("mouseup", stopDragging);
    };
  }, []);

  function handleHeaderPointerDown() {
    dragRef.current = true;
    ignoreStateRef.current = false;
    if (!tauri) return;
    getCurrentWindow().setIgnoreCursorEvents(false).catch(() => {});
    getCurrentWindow()
      .startDragging()
      .catch(() => {})
      .finally(() => {
        dragRef.current = false;
      });
  }

  return (
    <div
      ref={rootRef}
      className={[
        "widget-overlay",
        `widget-overlay--${theme.id}`,
        `widget-overlay--${theme.layoutFamily}`,
        `widget-overlay--${theme.header.style}`,
        `widget-overlay--${state.layout.density}`,
      ].join(" ")}
      style={{
        ["--widget-stack-gap" as string]: `${theme.stackGap[state.layout.density]}px`,
        ["--widget-scale" as string]: String(state.layout.scale),
        ["--widget-accent-override" as string]: customization.accentColor || "",
      }}
    >
      <div
        ref={headerRef}
        className="widget-overlay__provider"
        onPointerDown={handleHeaderPointerDown}
      >
        <ProviderBadge
          provider={state.activeProvider}
          size={theme.header.badgeSize[state.layout.density]}
          badgeStyle={theme.header.badgeStyle}
          mode={customization.headerBadgeMode ?? "brand"}
          className="widget-overlay__provider-badge"
        />
        <span className="widget-overlay__provider-name">{state.activeProvider}</span>
      </div>
      {theme.id === "mono-ticker" ? (
        <div className="widget-overlay__ticker-board">
          {visibleCards.map((card) => (
            <div
              key={card.id}
              className="widget-overlay__card-shell widget-overlay__card-shell--ticker"
              style={{ ["--widget-card-accent" as string]: card.accent }}
            >
              <TickerCell card={card} resetDisplayMode={resetDisplayMode} />
            </div>
          ))}
        </div>
      ) : theme.id === "pinboard-mini" ? (
        <div className="widget-overlay__pinboard-board">
          {visibleCards.map((card) => (
            <div
              key={card.id}
              className="widget-overlay__card-shell widget-overlay__card-shell--pinboard"
              style={{ ["--widget-card-accent" as string]: card.accent }}
            >
              <PinboardCell card={card} resetDisplayMode={resetDisplayMode} />
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
              resetDisplayMode={resetDisplayMode}
            />
          </div>
        ))
      )}
    </div>
  );
}
