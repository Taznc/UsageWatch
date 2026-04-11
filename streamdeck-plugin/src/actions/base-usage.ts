import {
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
  WillDisappearEvent,
} from "@elgato/streamdeck";

import { fetchUsage, openWindow, UsageData } from "../api.js";
import { renderUsageKey } from "../render.js";

/**
 * Base class for Session and Weekly usage actions.
 *
 * Manages per-key polling intervals using Maps keyed by the action instance
 * ID, so multiple instances of the same action on different Stream Deck pages
 * each get their own independent refresh cycle.
 */
export abstract class BaseUsageAction extends SingletonAction {
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  private cancelled = new Map<string, boolean>();

  /** Display label shown on the key (e.g. "SESSION" or "WEEKLY") */
  protected abstract readonly label: string;

  /** Extract the relevant utilization value from a successful UsageData response */
  protected abstract getUtilization(data: UsageData): number | undefined;

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    const id = ev.action.id;
    this.cancelled.set(id, false);

    // Clear the default title once — our image is the only visual
    await ev.action.setTitle("");

    // Initial render, then poll every 10 seconds
    await this.refresh(ev.action, id);
    const timer = setInterval(() => this.refresh(ev.action, id), 10_000);
    this.timers.set(id, timer);
  }

  override onWillDisappear(ev: WillDisappearEvent): void {
    const id = ev.action.id;
    // Mark as cancelled so any in-flight refresh() skips its setImage call
    this.cancelled.set(id, true);
    const timer = this.timers.get(id);
    if (timer !== undefined) {
      clearInterval(timer);
      this.timers.delete(id);
    }
  }

  override async onKeyDown(_ev: KeyDownEvent): Promise<void> {
    await openWindow();
  }

  private async refresh(
    actionInst: WillAppearEvent["action"],
    id: string,
  ): Promise<void> {
    const update = await fetchUsage();

    // Guard: if the key disappeared while we were fetching, drop the update
    if (this.cancelled.get(id)) return;

    const pct =
      update?.data ? (this.getUtilization(update.data) ?? null) : null;
    const image = renderUsageKey(this.label, pct);
    await actionInst.setImage(image);
  }
}
