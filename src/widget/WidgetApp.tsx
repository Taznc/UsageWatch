import { useEffect } from "react";
import { WidgetProvider } from "../context/WidgetContext";
import { WidgetOverlay } from "./WidgetOverlay";
import { isTauriRuntime } from "./preview";
import "./widget.css";

function WidgetRoot() {
  useEffect(() => {
    if (isTauriRuntime()) return;
    document.body.classList.add("widget-preview-body");
    return () => document.body.classList.remove("widget-preview-body");
  }, []);

  return <WidgetOverlay />;
}

export default function WidgetApp() {
  return (
    <WidgetProvider>
      <WidgetRoot />
    </WidgetProvider>
  );
}
