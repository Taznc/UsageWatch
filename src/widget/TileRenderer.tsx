import { useWidget } from "../context/WidgetContext";
import { TILE_LABELS } from "../types/widget";
import type { TileId } from "../types/widget";
import { GaugeTile } from "./tiles/GaugeTile";
import { MoneyTile } from "./tiles/MoneyTile";
import { StatusTile } from "./tiles/StatusTile";
import { CreditsTile } from "./tiles/CreditsTile";

interface Props {
  tileId: TileId;
  editMode?: boolean;
  onRemove?: () => void;
}

export function TileRenderer({ tileId, editMode, onRemove }: Props) {
  const { state } = useWidget();
  const { usageData, codexData, billingData, status } = state;
  const label = TILE_LABELS[tileId];

  switch (tileId) {
    case "session_window": {
      const w = usageData?.five_hour;
      return (
        <GaugeTile
          label={label}
          pct={w?.utilization ?? 0}
          resetsAt={w?.resets_at ?? null}
          editMode={editMode}
          onRemove={onRemove}
        />
      );
    }
    case "weekly_window": {
      const w = usageData?.seven_day;
      return (
        <GaugeTile
          label={label}
          pct={w?.utilization ?? 0}
          resetsAt={w?.resets_at ?? null}
          editMode={editMode}
          onRemove={onRemove}
        />
      );
    }
    case "opus_window": {
      const w = usageData?.seven_day_opus;
      return (
        <GaugeTile
          label={label}
          pct={w?.utilization ?? 0}
          resetsAt={w?.resets_at ?? null}
          editMode={editMode}
          onRemove={onRemove}
        />
      );
    }
    case "sonnet_window": {
      const w = usageData?.seven_day_sonnet;
      return (
        <GaugeTile
          label={label}
          pct={w?.utilization ?? 0}
          resetsAt={w?.resets_at ?? null}
          editMode={editMode}
          onRemove={onRemove}
        />
      );
    }
    case "oauth_window": {
      const w = usageData?.seven_day_oauth_apps;
      return (
        <GaugeTile
          label={label}
          pct={w?.utilization ?? 0}
          resetsAt={w?.resets_at ?? null}
          editMode={editMode}
          onRemove={onRemove}
        />
      );
    }
    case "cowork_window": {
      const w = usageData?.seven_day_cowork;
      return (
        <GaugeTile
          label={label}
          pct={w?.utilization ?? 0}
          resetsAt={w?.resets_at ?? null}
          editMode={editMode}
          onRemove={onRemove}
        />
      );
    }
    case "extra_usage": {
      const ex = usageData?.extra_usage;
      return (
        <MoneyTile
          label={label}
          amount={ex?.used_credits ?? 0}
          limitAmount={ex?.monthly_limit ?? undefined}
          editMode={editMode}
          onRemove={onRemove}
        />
      );
    }
    case "prepaid_balance": {
      const credits = billingData?.prepaid_credits;
      return (
        <MoneyTile
          label={label}
          amount={credits?.amount ?? 0}
          editMode={editMode}
          onRemove={onRemove}
        />
      );
    }
    case "promo_credit": {
      const grant = billingData?.credit_grant;
      return (
        <MoneyTile
          label={label}
          amount={grant?.amount_minor_units ?? 0}
          editMode={editMode}
          onRemove={onRemove}
        />
      );
    }
    case "api_status": {
      return (
        <StatusTile
          indicator={status?.indicator ?? "none"}
          description={status?.description ?? "All systems operational"}
          editMode={editMode}
          onRemove={onRemove}
        />
      );
    }
    case "codex_session": {
      const w = codexData?.session_window;
      return (
        <GaugeTile
          label={label}
          pct={w?.used_percent ?? 0}
          resetsAt={w?.resets_at ?? null}
          editMode={editMode}
          onRemove={onRemove}
        />
      );
    }
    case "codex_weekly": {
      const w = codexData?.weekly_window;
      return (
        <GaugeTile
          label={label}
          pct={w?.used_percent ?? 0}
          resetsAt={w?.resets_at ?? null}
          editMode={editMode}
          onRemove={onRemove}
        />
      );
    }
    case "codex_credits": {
      const c = codexData?.credits;
      return (
        <CreditsTile
          label={label}
          unlimited={c?.unlimited ?? false}
          hasCredits={c?.has_credits ?? false}
          balance={c?.balance ?? null}
          editMode={editMode}
          onRemove={onRemove}
        />
      );
    }
    default:
      return null;
  }
}
