import { useEffect } from "react";
import { WidgetProvider } from "../context/WidgetContext";
import { WidgetOverlay } from "./WidgetOverlay";
import { isTauriRuntime } from "./preview";
import "./widget.css";

function WidgetRoot() {
  useEffect(() => {
    if (isTauriRuntime()) {
      document.documentElement.style.background = "transparent";
      document.documentElement.style.backgroundColor = "transparent";
      document.body.style.background = "transparent";
      document.body.style.backgroundColor = "transparent";
      document.getElementById("widget-root")?.style.setProperty("background", "transparent");
      document.getElementById("widget-root")?.style.setProperty("background-color", "transparent");
      return;
    }
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
