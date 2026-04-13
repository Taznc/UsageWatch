import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalPosition, LogicalSize } from "@tauri-apps/api/window";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useWidget } from "../context/WidgetContext";
import { useWidgetData } from "../hooks/useWidgetData";
import { useWidgetStore } from "../hooks/useWidgetStore";
import type { WidgetCardId, WidgetCardViewModel } from "../types/widget";
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

function isInHitbox(localX: number, localY: number, hitbox: Hitbox): boolean {
  return localX >= hitbox.left && localX <= hitbox.left + hitbox.width && localY >= hitbox.top && localY <= hitbox.top + hitbox.height;
}

function buildHitboxes(refs: Map<WidgetCardId, RefObject<HTMLDivElement | null>>, cardIds: WidgetCardId[]) {
  return cardIds
    .map((cardId) => {
      const node = refs.get(cardId)?.current;
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      } satisfies Hitbox;
    })
    .filter((box): box is Hitbox => box !== null);
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
  const cardRefs = useRef(new Map<WidgetCardId, RefObject<HTMLDivElement | null>>());
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

  function getCardRef(cardId: WidgetCardId) {
    if (!cardRefs.current.has(cardId)) {
      cardRefs.current.set(cardId, { current: null });
    }
    return cardRefs.current.get(cardId)!;
  }

  function recalcHitboxes(cardIds: WidgetCardId[]) {
    const next = buildHitboxes(cardRefs.current, cardIds);
    const header = headerRef.current?.getBoundingClientRect();
    if (header) {
      next.push({
        left: header.left,
        top: header.top,
        width: header.width,
        height: header.height,
      });
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
    const cardIds = visibleCards.map((card) => card.id);

    const recalc = () => {
      recalcHitboxes(cardIds);
    };

    const observer = new ResizeObserver(() => {
      recalc();
      if (tauri) {
        const rect = root.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          getCurrentWindow().setSize(new LogicalSize(Math.ceil(rect.width), Math.ceil(rect.height))).catch(() => {});
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
          getCurrentWindow().setSize(new LogicalSize(Math.ceil(rect.width), Math.ceil(rect.height))).catch(() => {});
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
    const cardIds = visibleCards.map((card) => card.id);
    const unlistenMove = getCurrentWindow().onMoved(({ payload }) => {
      if (!dragRef.current) return;
      savePosition(payload.x, payload.y);
      recalcHitboxes(cardIds);
    });

    return () => {
      unlistenMove.then((fn) => fn());
    };
  }, [savePosition, tauri, visibleCards]);

  useEffect(() => {
    if (!tauri) return;

    // Track window position in logical pixels for hit-testing.
    // rdev gives screen-level coords; getBoundingClientRect gives viewport-relative coords.
    // We need to subtract the window position to convert screen → viewport.
    const winPosRef = { x: 0, y: 0 };

    // Seed from the current window position
    getCurrentWindow().outerPosition().then((pos) => {
      winPosRef.x = pos.x / window.devicePixelRatio;
      winPosRef.y = pos.y / window.devicePixelRatio;
    }).catch(() => {});

    const unlistenPos = getCurrentWindow().onMoved(({ payload }) => {
      // onMoved payload is physical pixels on most platforms
      winPosRef.x = payload.x / window.devicePixelRatio;
      winPosRef.y = payload.y / window.devicePixelRatio;
    });

    const unlisten = listen<{ x: number; y: number }>("device-mouse-move", ({ payload }) => {
      // rdev coords: physical screen pixels
      const dpr = window.devicePixelRatio;
      const localX = payload.x / dpr - winPosRef.x;
      const localY = payload.y / dpr - winPosRef.y;
      const inCard = hitboxes.some((box) => isInHitbox(localX, localY, box));
      const shouldIgnore = !dragRef.current && !inCard;
      if (ignoreStateRef.current === shouldIgnore) return;
      ignoreStateRef.current = shouldIgnore;
      getCurrentWindow().setIgnoreCursorEvents(shouldIgnore).catch(() => {});
    });

    return () => {
      unlisten.then((fn) => fn());
      unlistenPos.then((fn) => fn());
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
    getCurrentWindow().startDragging().catch(() => {
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
              ref={getCardRef(card.id)}
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
              ref={getCardRef(card.id)}
              className="widget-overlay__card-shell widget-overlay__card-shell--deck"
              style={{ ["--widget-card-accent" as string]: card.accent }}
            >
              <DeckCell card={card} />
            </div>
          ))}
        </div>
      ) : (
        visibleCards.map((card) => (
          <div key={card.id} ref={getCardRef(card.id)} className="widget-overlay__card-shell">
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
