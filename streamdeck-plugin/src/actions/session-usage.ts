import { action } from "@elgato/streamdeck";
import { UsageData } from "../api.js";
import { BaseUsageAction } from "./base-usage.js";

@action({ UUID: "com.usagewatch.session" })
export class SessionUsageAction extends BaseUsageAction {
  protected readonly label = "SESSION";

  protected getUtilization(data: UsageData): number | undefined {
    return data.five_hour?.utilization;
  }
}
