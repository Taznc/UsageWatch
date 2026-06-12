import type { Organization } from "./usage";

/// Redacted account view returned by `list_claude_accounts` / `rescan_claude_accounts`.
/// Mirrors the Rust `ClaudeAccountView` (never carries the raw session key).
export interface ClaudeAccountView {
  id: string;
  label: string;
  email: string | null;
  display_name: string | null;
  source: string;
  org_id: string;
  org_name: string;
  added_at: string;
  last_verified: string;
  has_session: boolean;
  is_active: boolean;
}

/// One row from `rescan_claude_accounts` — mirrors the Rust `RescanRow`.
export interface RescanRow {
  instance: string;
  account: ClaudeAccountView | null;
  error: string | null;
  orgs: Organization[] | null;
  pending_session_key: string | null;
}
