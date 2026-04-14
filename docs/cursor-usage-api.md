# Cursor usage: APIs and the Enterprise fix

This document describes how UsageWatch loads Cursor plan usage, why it broke for some Enterprise accounts, and what we changed to fix it.

## Summary

Cursor usage is built from **two sources in parallel**:

1. **Dashboard REST** — `GET https://cursor.com/api/usage-summary`  
   - Authenticated with the **same bearer token** as the desktop app (`cursorAuth/accessToken`), or with a **browser cookie** string if the user saved one in Settings.  
   - When this response includes a positive **`limit`**, we treat **`used` / `limit`** from `individualUsage.overall` (or `teamUsage.overall`) as the **authoritative monthly meter**. That matches what you see on [cursor.com/dashboard/usage](https://cursor.com/dashboard/usage).

2. **Connect RPC** — `POST https://api2.cursor.sh/aiserver.v1.DashboardService/*`  
   - `GetCurrentPeriodUsage`, `GetPlanInfo`, etc.  
   - Fills **percent breakdowns** (auto / API), **bonus** fields, **spendLimitUsage** (on-demand caps), **displayMessage**, and plan metadata.

If `usage-summary` does not return a usable limit, we fall back to the Connect-derived **`planUsage`** / **`planInfo`** / **`spendLimitUsage`** stack (with numeric fields accepted as either JSON numbers or strings).

## Historical regression

In commit **`f43daf3`** (*feat: improve Cursor data collection via Connect RPC endpoints*), fetching moved to **Connect-only** and dropped the **`/api/usage-summary`** call.

Earlier code (e.g. parent of that change, **`d0d55fb`**) used **`usage-summary`** as the primary source for **`individualUsage.overall.{used,limit}`**.

For many **Enterprise** plans, the **web dashboard** still reflects **`usage-summary`**, while **`GetCurrentPeriodUsage`** may omit or zero out **`planUsage.limit`** / **`includedSpend`**. The UI then showed **0%** and “no dollar limit” even though the site showed real spend.

Restoring **`usage-summary`** (with **bearer** auth, not only cookies) fixes that class of accounts.

## Implementation pointers

| Area | Location |
|------|----------|
| Fetch + merge logic | `src-tauri/src/commands/cursor.rs` — `fetch_cursor_usage_internal`, `fetch_cursor_usage_summary_rest`, `parse_usage_summary_meter`, `cursor_get_f64` / `cursor_json_f64` |
| Percent when API sends `0%` but cents disagree | `src-tauri/src/models.rs` — `CursorUsageData::build` |
| Diagnostics | Tauri command `debug_cursor_api`; Settings → Debug → “Cursor API diagnostics” |

## Auth resolution (unchanged high level)

1. Manual value that looks like **cookies** (`=` / `;`) → extract bearer from `WorkosCursorSessionToken` for Connect; same string used as **Cookie** for `usage-summary` when applicable.  
2. Manual **plain bearer** → used for Connect and for **`usage-summary`** via `Authorization: Bearer`.  
3. Otherwise **`cursorAuth/accessToken`** from Cursor global storage (JSON or `state.vscdb` on Windows).

## Debugging

Run **Cursor API diagnostics** in Settings → Debug. The payload includes Connect RPC shapes and **`usage-summary`** status plus **`parsed_overall_meter`** (`used_cents` / `limit_cents`) when parsing succeeds.

## Related references

- Internal comparison commit: **`d0d55fb`** vs **`f43daf3`** on `src-tauri/src/commands/cursor.rs`.  
- Similar “dashboard vs Connect” split appears in community tools that integrate Cursor (e.g. openusage-style providers); UsageWatch does not depend on those repos, but the same API split explains recurring confusion.
