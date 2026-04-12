import { useEffect, useRef } from "react";
import { getCurrentWindow, LogicalPosition, LogicalSize } from "@tauri-apps/api/window";
import { useWidget } from "../context/WidgetContext";
import { useWidgetData } from "../hooks/useWidgetData";
import { useWidgetStore } from "../hooks/useWidgetStore";
import { isTauriRuntime } from "./preview";
import { ReferenceGlassWidget } from "./ReferenceGlassWidget";

export function WidgetWindow() {
  useWidgetData();
  const { savePosition } = useWidgetStore();
  const { state } = useWidget();
  const containerRef = useRef<HTMLDivElement>(null);
  const restoredPositionRef = useRef(false);
  const tauri = isTauriRuntime();

  useEffect(() => {
    if (!tauri || restoredPositionRef.current) return;
    const { x, y } = state.layout.position;
    if (x > 0 || y > 0) {
      restoredPositionRef.current = true;
      getCurrentWindow().setPosition(new LogicalPosition(x, y));
    }
  }, [state.layout.position.x, state.layout.position.y, tauri]);

  useEffect(() => {
    if (!tauri) return;
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = Math.ceil(entry.contentRect.width);
        const height = Math.ceil(entry.contentRect.height);
        if (width > 0 && height > 0) {
          getCurrentWindow().setSize(new LogicalSize(width, height));
        }
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [tauri]);

  useEffect(() => {
    if (!tauri) return;
    const unlisten = getCurrentWindow().onMoved(({ payload: pos }) => {
      savePosition(pos.x, pos.y);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [savePosition, tauri]);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!tauri) return;
    if ((e.target as HTMLElement).closest("button, a, input, select, textarea")) return;
    getCurrentWindow().startDragging();
  }

  return (
    <div
      ref={containerRef}
      className="widget-window widget-window--reference"
      onPointerDown={handlePointerDown}
    >
      <ReferenceGlassWidget />
    </div>
  );
}
