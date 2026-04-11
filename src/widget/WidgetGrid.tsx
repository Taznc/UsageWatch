import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useState } from "react";
import { useWidget } from "../context/WidgetContext";
import { TileRenderer } from "./TileRenderer";
import type { TileId } from "../types/widget";

function SortableTile({
  tileId,
  editMode,
  onRemove,
}: {
  tileId: TileId;
  editMode: boolean;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: tileId, disabled: !editMode });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1,
    gridColumn: tileId === "api_status" ? "span 2" : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`sortable-tile-wrapper ${editMode ? "edit-mode" : ""}`}
      {...(editMode ? { ...attributes, ...listeners } : {})}
    >
      <TileRenderer tileId={tileId} editMode={editMode} onRemove={onRemove} />
    </div>
  );
}

interface Props {
  onDropFromPalette: (tileId: TileId, overId: string | null) => void;
}

export function WidgetGrid({ onDropFromPalette }: Props) {
  const { state, dispatch } = useWidget();
  const { isEditMode, layout } = state;
  const { placedTiles } = layout;
  const [activeId, setActiveId] = useState<TileId | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  function handleDragStart(event: DragStartEvent) {
    const id = event.active.id as TileId;
    if (placedTiles.includes(id)) setActiveId(id);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!over || active.id === over.id) return;

    const activeId = active.id as TileId;
    const overId = over.id as string;

    if (placedTiles.includes(activeId)) {
      const oldIdx = placedTiles.indexOf(activeId);
      const newIdx = placedTiles.indexOf(overId as TileId);
      if (newIdx !== -1) {
        dispatch({ type: "SET_PLACED_TILES", tiles: arrayMove(placedTiles, oldIdx, newIdx) });
      }
    } else {
      onDropFromPalette(activeId, overId);
    }
  }

  function removeTile(tileId: TileId) {
    dispatch({ type: "SET_PLACED_TILES", tiles: placedTiles.filter((t) => t !== tileId) });
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={placedTiles} strategy={rectSortingStrategy}>
        <div className={`widget-grid ${isEditMode ? "edit-mode" : ""}`}>
          {placedTiles.map((tileId) => (
            <SortableTile
              key={tileId}
              tileId={tileId}
              editMode={isEditMode}
              onRemove={() => removeTile(tileId)}
            />
          ))}
          {placedTiles.length === 0 && isEditMode && (
            <div className="grid-empty-hint">
              Click tiles above to add them here
            </div>
          )}
        </div>
      </SortableContext>

      <DragOverlay>
        {activeId ? (
          <div className="tile-drag-overlay">
            <TileRenderer tileId={activeId} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
