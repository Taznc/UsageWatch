import { action } from "@elgato/streamdeck";
import { UsageData } from "../api.js";
import { BaseUsageAction } from "./base-usage.js";

@action({ UUID: "com.usagewatch.weekly" })
export class WeeklyUsageAction extends BaseUsageAction {
  protected readonly label = "WEEKLY";

  protected getUtilization(data: UsageData): number | undefined {
    return data.seven_day?.utilization;
  }
}
