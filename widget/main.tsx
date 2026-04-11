import React from "react";
import ReactDOM from "react-dom/client";
import WidgetApp from "../src/widget/WidgetApp";

ReactDOM.createRoot(document.getElementById("widget-root") as HTMLElement).render(
  <React.StrictMode>
    <WidgetApp />
  </React.StrictMode>,
);
