import { useEffect, useState, useRef } from "react";
import { getCurrentWindow, LogicalPosition, LogicalSize } from "@tauri-apps/api/window";
import { useWidget } from "../context/WidgetContext";
import { useWidgetData } from "../hooks/useWidgetData";
import { useWidgetStore } from "../hooks/useWidgetStore";
import { WidgetHeader } from "./WidgetHeader";
import { WidgetGrid } from "./WidgetGrid";
import { TilePalette } from "./TilePalette";
import type { TileId } from "../types/widget";

const HEADER_H = 28;
const TILE_H = 110;
const GRID_GAP = 8;
const GRID_PADDING_V = 10;
const PALETTE_H = 80;
const EDIT_BAR_H = 42;

function computeGridRows(tiles: TileId[]): number {
  let cells = 0;
  for (const t of tiles) {
    cells += t === "api_status" ? 2 : 1;
  }
  return Math.max(Math.ceil(cells / 2), 1);
}

function computeHeight(tiles: TileId[], editMode: boolean): number {
  const rows = computeGridRows(tiles);
  let h = HEADER_H + GRID_PADDING_V + rows * TILE_H + (rows - 1) * GRID_GAP + GRID_PADDING_V;
  if (editMode) h += PALETTE_H + EDIT_BAR_H;
  return Math.max(h, 130);
}

export function WidgetWindow() {
  // Initialize data subscriptions and store persistence (called once here only)
  useWidgetData();
  const { savePosition } = useWidgetStore();

  const { state, dispatch } = useWidget();
  const { layout, isEditMode } = state;
  const [headerVisible, setHeaderVisible] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore window position on mount
  useEffect(() => {
    const { x, y } = layout.position;
    if (x > 0 || y > 0) {
      getCurrentWindow().setPosition(new LogicalPosition(x, y));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Resize window when tiles or edit mode changes
  useEffect(() => {
    const h = computeHeight(layout.placedTiles, isEditMode);
    getCurrentWindow().setSize(new LogicalSize(380, h));
  }, [layout.placedTiles, isEditMode]);

  // Persist position whenever window is moved
  useEffect(() => {
    const unlisten = getCurrentWindow().onMoved(({ payload: pos }) => {
      savePosition(pos.x, pos.y);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [savePosition]);

  function handleMouseEnter() {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    setHeaderVisible(true);
  }

  function handleMouseLeave() {
    hoverTimerRef.current = setTimeout(() => setHeaderVisible(false), 400);
  }

  function handleDropFromPalette(tileId: TileId, overId: string | null) {
    const { placedTiles } = layout;
    if (overId && placedTiles.includes(overId as TileId)) {
      const idx = placedTiles.indexOf(overId as TileId);
      const newTiles = [...placedTiles];
      newTiles.splice(idx, 0, tileId);
      dispatch({ type: "SET_PLACED_TILES", tiles: newTiles });
    } else {
      if (!placedTiles.includes(tileId)) {
        dispatch({ type: "SET_PLACED_TILES", tiles: [...placedTiles, tileId] });
      }
    }
  }

  return (
    <div
      className={`widget-window ${isEditMode ? "edit-mode" : ""}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <WidgetHeader visible={headerVisible || isEditMode} />

      {isEditMode && <TilePalette />}

      <WidgetGrid onDropFromPalette={handleDropFromPalette} />

      {isEditMode && (
        <div className="edit-mode-bar">
          <button
            className="edit-done-btn"
            onClick={() => dispatch({ type: "EXIT_EDIT" })}
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}
