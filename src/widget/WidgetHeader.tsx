import { getCurrentWindow } from "@tauri-apps/api/window";
import { useWidget } from "../context/WidgetContext";

export function WidgetHeader() {
  const { state, dispatch } = useWidget();
  const { isEditMode, layout } = state;
  const { columns } = layout;

  function handleMouseDown(e: React.MouseEvent) {
    // Buttons handle their own clicks; drag from any other part of the header
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    getCurrentWindow().startDragging();
  }

  function toggleColumns() {
    dispatch({ type: "SET_COLUMNS", columns: columns === 2 ? 1 : 2 });
  }

  return (
    <div
      className={`widget-header ${isEditMode ? "edit-active" : ""}`}
      onMouseDown={handleMouseDown}
    >
      {/* Grip icon — visual drag hint */}
      <span className="widget-header-grip">⠿</span>

      {/* Title fills center — largest draggable surface */}
      <span className="widget-header-title">UsageWatch</span>

      {/* Actions — must opt out of -webkit-app-region so they remain clickable */}
      <div className="widget-header-actions">
        {isEditMode && (
          <button
            className="widget-header-btn"
            onClick={toggleColumns}
            title={columns === 2 ? "Switch to 1 column" : "Switch to 2 columns"}
          >
            {columns === 2 ? "1 col" : "2 col"}
          </button>
        )}
        <button
          className={`widget-header-btn ${isEditMode ? "active" : ""}`}
          onClick={() => dispatch({ type: "TOGGLE_EDIT" })}
          title={isEditMode ? "Exit edit mode" : "Customize layout"}
        >
          {isEditMode ? "Done" : "Edit"}
        </button>
        <button
          className="widget-header-btn widget-header-close"
          onClick={() => getCurrentWindow().hide()}
          title="Close widget"
        >
          ×
        </button>
      </div>
    </div>
  );
}
