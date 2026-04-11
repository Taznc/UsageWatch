import streamDeck from "@elgato/streamdeck";
import { SessionUsageAction } from "./actions/session-usage.js";
import { WeeklyUsageAction } from "./actions/weekly-usage.js";

streamDeck.actions.registerAction(new SessionUsageAction());
streamDeck.actions.registerAction(new WeeklyUsageAction());

streamDeck.connect();
