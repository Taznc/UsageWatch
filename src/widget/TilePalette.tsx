import { useDraggable } from "@dnd-kit/core";
import { useWidget } from "../context/WidgetContext";
import { ALL_TILES, TILE_LABELS } from "../types/widget";
import type { TileId } from "../types/widget";

function DraggablePaletteTile({
  tileId,
  onAdd,
}: {
  tileId: TileId;
  onAdd: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: tileId });

  return (
    <button
      ref={setNodeRef}
      className={`palette-tile ${isDragging ? "dragging" : ""}`}
      onClick={onAdd}
      title={`Add ${TILE_LABELS[tileId]}`}
      {...attributes}
      {...listeners}
    >
      <span className="palette-tile-icon">+</span>
      <span className="palette-tile-label">{TILE_LABELS[tileId]}</span>
    </button>
  );
}

export function TilePalette() {
  const { state, dispatch } = useWidget();
  const { placedTiles } = state.layout;
  const availableTiles = ALL_TILES.filter((t) => !placedTiles.includes(t));

  function addTile(tileId: TileId) {
    if (!placedTiles.includes(tileId)) {
      dispatch({ type: "SET_PLACED_TILES", tiles: [...placedTiles, tileId] });
    }
  }

  if (availableTiles.length === 0) {
    return <div className="tile-palette tile-palette-empty">All tiles added</div>;
  }

  return (
    <div className="tile-palette">
      <div className="palette-label">Tap to add · Drag to place</div>
      <div className="palette-scroll">
        {availableTiles.map((tileId) => (
          <DraggablePaletteTile
            key={tileId}
            tileId={tileId}
            onAdd={() => addTile(tileId)}
          />
        ))}
      </div>
    </div>
  );
}
