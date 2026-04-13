import { useMemo } from "react";
import { WidgetCard } from "./WidgetCard";
import { getWidgetTheme } from "./themes";
import { selectWidgetCardModels, type WidgetDataSnapshot } from "./selectors";
import { previewBillingData, previewCodexData, previewCursorData, previewStatus, previewUsageData } from "./preview";
import { DEFAULT_WIDGET_OVERLAY_LAYOUT } from "../types/widget";

export function WidgetPreview() {
  const snapshot = useMemo<WidgetDataSnapshot>(
    () => ({
      usageData: previewUsageData,
      codexData: previewCodexData,
      cursorData: previewCursorData,
      billingData: previewBillingData,
      status: previewStatus,
      activeProvider: "Claude",
    }),
    [],
  );

  const layout = DEFAULT_WIDGET_OVERLAY_LAYOUT;
  const theme = getWidgetTheme(layout.themeId);
  const cards = useMemo(
    () => selectWidgetCardModels(snapshot, layout).filter((card) => card.visible),
    [layout, snapshot],
  );

  return (
    <div
      className="widget-preview-stack"
      style={{ gap: theme.stackGap[layout.density] }}
    >
      {cards.map((card) => (
        <WidgetCard
          key={card.id}
          card={card}
          density={layout.density}
          theme={theme}
        />
      ))}
    </div>
  );
}
