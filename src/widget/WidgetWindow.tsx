import { useEffect, useRef } from "react";
import { getCurrentWindow, LogicalPosition, LogicalSize } from "@tauri-apps/api/window";
import { useWidget } from "../context/WidgetContext";
import { useWidgetData } from "../hooks/useWidgetData";
import { useWidgetStore } from "../hooks/useWidgetStore";
import { WidgetHeader } from "./WidgetHeader";
import { WidgetGrid } from "./WidgetGrid";
import { TilePalette } from "./TilePalette";
import type { TileId } from "../types/widget";

export function WidgetWindow() {
  useWidgetData();
  const { savePosition } = useWidgetStore();
  const { state, dispatch } = useWidget();
  const { layout, isEditMode } = state;
  const containerRef = useRef<HTMLDivElement>(null);

  // Restore saved window position on mount
  useEffect(() => {
    const { x, y } = layout.position;
    if (x > 0 || y > 0) {
      getCurrentWindow().setPosition(new LogicalPosition(x, y));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-resize window to match actual content height using ResizeObserver.
  // This is more reliable than manually computing heights because CSS determines
  // the actual tile heights — we just measure what's rendered.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const h = Math.ceil(entry.contentRect.height);
        if (h > 0) {
          getCurrentWindow().setSize(new LogicalSize(380, h));
        }
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Persist position whenever the user drags the window
  useEffect(() => {
    const unlisten = getCurrentWindow().onMoved(({ payload: pos }) => {
      savePosition(pos.x, pos.y);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [savePosition]);

  function handleDropFromPalette(tileId: TileId, overId: string | null) {
    const { placedTiles } = layout;
    if (placedTiles.includes(tileId)) return;
    if (overId && placedTiles.includes(overId as TileId)) {
      const idx = placedTiles.indexOf(overId as TileId);
      const newTiles = [...placedTiles];
      newTiles.splice(idx, 0, tileId);
      dispatch({ type: "SET_PLACED_TILES", tiles: newTiles });
    } else {
      dispatch({ type: "SET_PLACED_TILES", tiles: [...placedTiles, tileId] });
    }
  }

  return (
    <div
      ref={containerRef}
      className={`widget-window ${isEditMode ? "edit-mode" : ""}`}
    >
      <WidgetHeader />

      {isEditMode && <TilePalette />}

      <WidgetGrid onDropFromPalette={handleDropFromPalette} />
    </div>
  );
}
