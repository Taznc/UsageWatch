import { getCurrentWindow } from "@tauri-apps/api/window";
import { useWidget } from "../context/WidgetContext";

interface Props {
  visible: boolean;
}

export function WidgetHeader({ visible }: Props) {
  const { dispatch } = useWidget();

  function handleMouseDown(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    getCurrentWindow().startDragging();
  }

  function handleClose() {
    getCurrentWindow().hide();
  }

  function handleEditToggle() {
    dispatch({ type: "TOGGLE_EDIT" });
  }

  return (
    <div
      className={`widget-header ${visible ? "visible" : ""}`}
      onMouseDown={handleMouseDown}
    >
      <div className="widget-header-drag-hint" />
      <div className="widget-header-actions">
        <button
          className="widget-header-btn"
          onClick={handleEditToggle}
          title="Edit layout"
        >
          ✎
        </button>
        <button
          className="widget-header-btn widget-header-close"
          onClick={handleClose}
          title="Close widget"
        >
          ×
        </button>
      </div>
    </div>
  );
}
