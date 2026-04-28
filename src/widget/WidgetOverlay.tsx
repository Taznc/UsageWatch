import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { availableMonitors, getCurrentWindow, LogicalSize, PhysicalPosition } from "@tauri-apps/api/window";
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

type DesktopRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

const DEFAULT_WIDGET_PHYSICAL_POSITION = { x: 200, y: 100 };
const WIDGET_VISIBLE_MARGIN = 16;
const WIDGET_MIN_VISIBLE_PX = 48;

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

function isFinitePosition(position: { x: number; y: number }) {
  return Number.isFinite(position.x) && Number.isFinite(position.y);
}

function monitorWorkAreaRect(monitor: Awaited<ReturnType<typeof availableMonitors>>[number]): DesktopRect {
  const left = monitor.workArea.position.x;
  const top = monitor.workArea.position.y;
  const width = monitor.workArea.size.width;
  const height = monitor.workArea.size.height;
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
  };
}

function hasVisibleIntersection(
  position: { x: number; y: number },
  size: { width: number; height: number },
  area: DesktopRect,
) {
  const visibleWidth = Math.min(position.x + size.width, area.right) - Math.max(position.x, area.left);
  const visibleHeight = Math.min(position.y + size.height, area.bottom) - Math.max(position.y, area.top);
  return visibleWidth >= WIDGET_MIN_VISIBLE_PX && visibleHeight >= WIDGET_MIN_VISIBLE_PX;
}

function nearestArea(
  position: { x: number; y: number },
  size: { width: number; height: number },
  areas: DesktopRect[],
) {
  const centerX = position.x + size.width / 2;
  const centerY = position.y + size.height / 2;

  return areas.reduce((nearest, area) => {
    const areaCenterX = area.left + area.width / 2;
    const areaCenterY = area.top + area.height / 2;
    const distance = Math.hypot(centerX - areaCenterX, centerY - areaCenterY);
    return distance < nearest.distance ? { area, distance } : nearest;
  }, { area: areas[0], distance: Number.POSITIVE_INFINITY }).area;
}

function clampToArea(value: number, min: number, max: number) {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

async function resolveVisibleWidgetPosition(position: { x: number; y: number }) {
  const win = getCurrentWindow();
  const [monitors, size] = await Promise.all([
    availableMonitors(),
    win.outerSize().catch(() => ({ width: 380, height: 300 })),
  ]);
  const areas = monitors.map(monitorWorkAreaRect);

  if (!areas.length) {
    return isFinitePosition(position) ? position : DEFAULT_WIDGET_PHYSICAL_POSITION;
  }

  const desired = isFinitePosition(position) ? position : DEFAULT_WIDGET_PHYSICAL_POSITION;
  if (areas.some((area) => hasVisibleIntersection(desired, size, area))) {
    return desired;
  }

  const area = nearestArea(desired, size, areas);
  return {
    x: clampToArea(
      desired.x,
      area.left + WIDGET_VISIBLE_MARGIN,
      area.right - Math.min(size.width, area.width) - WIDGET_VISIBLE_MARGIN,
    ),
    y: clampToArea(
      desired.y,
      area.top + WIDGET_VISIBLE_MARGIN,
      area.bottom - Math.min(size.height, area.height) - WIDGET_VISIBLE_MARGIN,
    ),
  };
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
  const { savePosition, hydrated } = useWidgetStore();
  const { state } = useWidget();
  const rootRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef(false);
  const ignoreStateRef = useRef<boolean | null>(null);
  // True while we are calling setPosition programmatically; suppresses onMoved saves.
  const programmaticSetRef = useRef(false);
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

  // Keep the native window aligned with persisted layout. Wait for store hydration before
  // calling setPosition so the default {x:200,y:100} doesn't jump the widget on dev reload.
  // Skip while dragRef is true — the OS is already moving the window and calling setPosition
  // mid-drag causes the flashing/fighting feedback loop.
  useEffect(() => {
    if (!tauri || !hydrated || dragRef.current) return;
    let cancelled = false;
    programmaticSetRef.current = true;
    resolveVisibleWidgetPosition(state.layout.position)
      .then((position) => {
        if (cancelled) return;
        return getCurrentWindow()
          .setPosition(new PhysicalPosition(Math.round(position.x), Math.round(position.y)))
          .then(() => {
            if (
              Math.round(position.x) !== Math.round(state.layout.position.x) ||
              Math.round(position.y) !== Math.round(state.layout.position.y)
            ) {
              savePosition(Math.round(position.x), Math.round(position.y));
            }
          });
      })
      .catch(() => {});
    getCurrentWindow().setIgnoreCursorEvents(true).catch(() => {});
    ignoreStateRef.current = true;
    // Clear after 150ms — long enough for any onMoved echo from this setPosition to arrive.
    const t = setTimeout(() => { programmaticSetRef.current = false; }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [state.layout.position.x, state.layout.position.y, tauri, hydrated]);

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
      recalcHitboxes();
      // Skip saves triggered by our own programmatic setPosition calls.
      // dragRef.current is NOT used here: startDragging() resolves immediately on
      // Windows (non-blocking), so dragRef is already false by the time onMoved fires.
      if (programmaticSetRef.current) return;
      if (!Number.isFinite(payload.x) || !Number.isFinite(payload.y)) return;
      savePosition(payload.x, payload.y);
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
      .catch(() => {});
    // dragRef is cleared by pointerup/mouseup — NOT here.
    // startDragging() resolves immediately on Windows (non-blocking), so clearing
    // dragRef in .finally() would make it false before onMoved fires.
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
        opacity: state.layout.opacity,
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
