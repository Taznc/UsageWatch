import { useEffect } from "react";
import { WidgetProvider } from "../context/WidgetContext";
import { WidgetWindow } from "./WidgetWindow";
import { isTauriRuntime } from "./preview";
import "./widget.css";

function WidgetRoot() {
  useEffect(() => {
    if (isTauriRuntime()) return;
    document.body.classList.add("widget-preview-body");
    return () => document.body.classList.remove("widget-preview-body");
  }, []);

  return (
    <WidgetWindow />
  );
}

export default function WidgetApp() {
  return (
    <WidgetProvider>
      <WidgetRoot />
    </WidgetProvider>
  );
}
