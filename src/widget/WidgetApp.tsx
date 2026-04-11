import { WidgetProvider } from "../context/WidgetContext";
import { WidgetWindow } from "./WidgetWindow";
import "./widget.css";

export default function WidgetApp() {
  return (
    <WidgetProvider>
      <WidgetWindow />
    </WidgetProvider>
  );
}
