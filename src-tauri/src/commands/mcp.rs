// MCP Manager
//
// Reads MCP server configuration from Claude Desktop, Claude Code, and Cursor;
// supports add/remove/enable/disable per host, normalized cross-host copy, and
// can detect whether the host app is running so the UI can offer to restart.
//
// Disable mechanism: a server is "disabled" by being moved from `mcpServers`
// into a sibling `_disabledMcpServers` object inside the same config file.
// Host apps ignore the unknown key, so the round-trip is lossless.
//
// All host config files are read as `serde_json::Value` (not strict structs)
// so unknown keys round-trip cleanly. Writes are atomic (temp file + rename)
// and the original is backed up under <app_data>/mcp-backups/ on first edit
// per file per session.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use toml_edit::{DocumentMut, Item, Table as TomlTable, Value as TomlValue};

// ── Models ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum McpHost {
    ClaudeDesktop,
    ClaudeCode,
    Cursor,
    Codex,
}

impl McpHost {
    fn as_str(&self) -> &'static str {
        match self {
            McpHost::ClaudeDesktop => "claudeDesktop",
            McpHost::ClaudeCode => "claudeCode",
            McpHost::Cursor => "cursor",
            McpHost::Codex => "codex",
        }
    }

    pub fn process_names_public(&self) -> &'static [&'static str] {
        match self {
            McpHost::ClaudeDesktop => &["Claude.exe", "Claude"],
            McpHost::ClaudeCode => &[], // CLI; no persistent process to restart
            McpHost::Cursor => &["Cursor.exe", "Cursor"],
            McpHost::Codex => &["Codex.exe", "Codex"],
        }
    }

    /// Best-effort relaunch command (host-specific).
    fn relaunch_args(&self) -> Option<RelaunchPlan> {
        match self {
            McpHost::ClaudeDesktop => Some(RelaunchPlan::AppNamed("Claude")),
            McpHost::Cursor => Some(RelaunchPlan::AppNamed("Cursor")),
            McpHost::ClaudeCode => None,
            McpHost::Codex => Some(RelaunchPlan::StoreApp {
                aumid: "OpenAI.Codex_2p2nqsd0c76g0!App",
                kill_image: "Codex.exe",
            }),
        }
    }
}

enum RelaunchPlan {
    /// macOS: `open -a <name>` ; Windows: try `start "" <name>.exe` via PATH/registry; Linux: try lowercase binary
    AppNamed(&'static str),
    /// Windows Store (MSIX) app — must be launched via shell:AppsFolder protocol, not direct exe path.
    StoreApp {
        aumid: &'static str,
        kill_image: &'static str,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, Hash, Eq, PartialEq)]
#[serde(tag = "kind", content = "path", rename_all = "camelCase")]
pub enum McpScope {
    Global,
    Project(PathBuf),
}

#[derive(Debug, Clone, Serialize, Deserialize, Hash, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HostTarget {
    pub host: McpHost,
    pub scope: McpScope,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Transport {
    Stdio,
    Sse,
    Http,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerEntry {
    pub name: String,
    pub transport: Transport,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headers: Option<HashMap<String, String>>,
    /// Original per-host JSON; preserved so editing from another host doesn't
    /// drop fields the host adapter doesn't model explicitly.
    pub raw: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpHostConfig {
    pub host: McpHost,
    pub scope: McpScope,
    pub path: PathBuf,
    pub detected: bool,
    pub readable: bool,
    pub enabled: Vec<McpServerEntry>,
    pub disabled: Vec<McpServerEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SupportLevel {
    Native,
    Translated,
    Unsupported,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteOutcome {
    pub target: HostTarget,
    pub support: SupportLevel,
    pub written: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddReport {
    pub outcomes: Vec<WriteOutcome>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedServerView {
    pub name: String,
    /// Per-host presence. Key is the HostTarget.key().
    pub presence: Vec<UnifiedPresence>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedPresence {
    pub target: HostTarget,
    pub enabled: bool,
    pub entry: McpServerEntry,
}

// ── Path resolution ───────────────────────────────────────────────────────

fn home_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var("USERPROFILE").ok().map(PathBuf::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("HOME").ok().map(PathBuf::from)
    }
}

fn claude_desktop_config_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").ok()?;
        Some(
            PathBuf::from(appdata)
                .join("Claude")
                .join("claude_desktop_config.json"),
        )
    }
    #[cfg(target_os = "macos")]
    {
        let home = home_dir()?;
        Some(home.join("Library/Application Support/Claude/claude_desktop_config.json"))
    }
    #[cfg(target_os = "linux")]
    {
        let home = home_dir()?;
        Some(home.join(".config/Claude/claude_desktop_config.json"))
    }
}

fn claude_code_user_config_path() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".claude.json"))
}

fn cursor_global_config_path() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".cursor").join("mcp.json"))
}

fn codex_global_config_path() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".codex").join("config.toml"))
}

fn project_config_path(host: McpHost, project_root: &Path) -> Option<PathBuf> {
    match host {
        McpHost::ClaudeCode => Some(project_root.join(".mcp.json")),
        McpHost::Cursor => Some(project_root.join(".cursor").join("mcp.json")),
        McpHost::ClaudeDesktop | McpHost::Codex => None,
    }
}

// ── Backups ───────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct McpSession {
    backed_up: HashSet<PathBuf>,
}

pub struct McpState(pub Mutex<McpSession>);

impl McpState {
    pub fn new() -> Self {
        Self(Mutex::new(McpSession::default()))
    }
}

fn backup_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?
        .join("mcp-backups");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create backup dir: {e}"))?;
    Ok(dir)
}

fn ensure_backup(
    app: &AppHandle,
    state: &McpState,
    host: McpHost,
    scope: &McpScope,
    src: &Path,
) -> Result<(), String> {
    if !src.exists() {
        return Ok(());
    }
    {
        let session = state.0.lock().unwrap();
        if session.backed_up.contains(src) {
            return Ok(());
        }
    }
    let dir = backup_dir(app)?;
    let scope_tag = match scope {
        McpScope::Global => "global".to_string(),
        McpScope::Project(p) => format!(
            "project-{}",
            p.file_name().and_then(|n| n.to_str()).unwrap_or("unnamed")
        ),
    };
    let ts = chrono::Utc::now().format("%Y%m%dT%H%M%S");
    let ext = match host {
        McpHost::Codex => "toml",
        _ => "json",
    };
    let dest = dir.join(format!("{}-{}-{}.{}", host.as_str(), scope_tag, ts, ext));
    std::fs::copy(src, &dest).map_err(|e| format!("backup copy failed: {e}"))?;
    let mut session = state.0.lock().unwrap();
    session.backed_up.insert(src.to_path_buf());
    Ok(())
}

// ── Atomic write ──────────────────────────────────────────────────────────

fn atomic_write_json(path: &Path, value: &Value) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("no parent dir for {}", path.display()))?;
    std::fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
    let tmp = parent.join(format!(
        ".{}.tmp-{}",
        path.file_name().and_then(|n| n.to_str()).unwrap_or("mcp"),
        std::process::id()
    ));
    let pretty = serde_json::to_string_pretty(value).map_err(|e| format!("serialize: {e}"))?;
    std::fs::write(&tmp, pretty).map_err(|e| format!("write tmp: {e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("rename: {e}"))?;
    Ok(())
}

// ── TOML IO (Codex) ───────────────────────────────────────────────────────

/// Convert a `toml_edit::Item` to a `serde_json::Value` for internal processing.
fn toml_item_to_json(item: &Item) -> Value {
    match item {
        Item::Value(v) => toml_scalar_to_json(v),
        Item::Table(t) => {
            let mut map = serde_json::Map::new();
            for (k, v) in t.iter() {
                map.insert(k.to_string(), toml_item_to_json(v));
            }
            Value::Object(map)
        }
        Item::ArrayOfTables(aot) => {
            let arr: Vec<Value> = aot
                .iter()
                .map(|t| {
                    let mut map = serde_json::Map::new();
                    for (k, v) in t.iter() {
                        map.insert(k.to_string(), toml_item_to_json(v));
                    }
                    Value::Object(map)
                })
                .collect();
            Value::Array(arr)
        }
        Item::None => Value::Null,
    }
}

fn toml_scalar_to_json(v: &TomlValue) -> Value {
    match v {
        TomlValue::String(s) => json!(s.value()),
        TomlValue::Integer(i) => json!(*i.value()),
        TomlValue::Float(f) => json!(*f.value()),
        TomlValue::Boolean(b) => json!(*b.value()),
        TomlValue::Array(arr) => Value::Array(arr.iter().map(toml_scalar_to_json).collect()),
        TomlValue::InlineTable(t) => {
            let mut map = serde_json::Map::new();
            for (k, v) in t.iter() {
                map.insert(k.to_string(), toml_scalar_to_json(v));
            }
            Value::Object(map)
        }
        TomlValue::Datetime(dt) => json!(dt.to_string()),
    }
}

/// Convert a JSON object (map of server names → field objects) into a
/// `toml_edit::Table` where each server is a TOML sub-table.
///
/// The `"type"` key is intentionally stripped — Codex infers transport from
/// the presence of `command` (stdio) or `url` (SSE/HTTP).
fn json_to_toml_table(obj: &serde_json::Map<String, Value>) -> TomlTable {
    let mut table = TomlTable::new();
    for (server_name, server_val) in obj {
        if let Some(fields) = server_val.as_object() {
            let mut sub = TomlTable::new();
            for (k, v) in fields {
                if k == "type" {
                    continue; // Codex infers transport — skip the type key
                }
                if let Some(tv) = json_to_toml_value(v) {
                    sub.insert(k, Item::Value(tv));
                }
            }
            table.insert(server_name, Item::Table(sub));
        }
    }
    table
}

fn json_to_toml_value(v: &Value) -> Option<TomlValue> {
    match v {
        Value::String(s) => Some(s.as_str().into()),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Some(i.into())
            } else {
                n.as_f64().map(|f| f.into())
            }
        }
        Value::Bool(b) => Some((*b).into()),
        Value::Array(arr) => {
            let mut ta = toml_edit::Array::new();
            for item in arr {
                if let Some(tv) = json_to_toml_value(item) {
                    ta.push(tv);
                }
            }
            Some(TomlValue::Array(ta))
        }
        Value::Object(map) => {
            let mut it = toml_edit::InlineTable::new();
            for (k, v2) in map {
                if let Some(tv) = json_to_toml_value(v2) {
                    it.insert(k, tv);
                }
            }
            Some(TomlValue::InlineTable(it))
        }
        Value::Null => None,
    }
}

/// Read Codex's `config.toml` and return a `HostFile` with the MCP server maps
/// extracted into a JSON envelope (same keys as JSON hosts: `mcpServers` /
/// `_disabledMcpServers`).  All other TOML keys are ignored here — they are
/// preserved by re-reading the original file in `atomic_write_toml` before
/// any write.
fn read_codex_host_file(path: &Path) -> Result<HostFile, String> {
    if !path.exists() {
        let mut hf = HostFile::empty();
        hf.format = HostFileFormat::Toml;
        return Ok(hf);
    }
    let text =
        std::fs::read_to_string(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    if text.trim().is_empty() {
        let mut hf = HostFile::empty();
        hf.format = HostFileFormat::Toml;
        return Ok(hf);
    }
    let doc = text
        .parse::<DocumentMut>()
        .map_err(|e| format!("parse TOML {}: {e}", path.display()))?;

    let mut enabled_map = serde_json::Map::new();
    let mut disabled_map = serde_json::Map::new();

    // TOML key: mcp_servers → internal JSON key: mcpServers
    if let Some(mcp) = doc.get("mcp_servers").and_then(|i| i.as_table()) {
        for (name, item) in mcp.iter() {
            enabled_map.insert(name.to_string(), toml_item_to_json(item));
        }
    }
    // TOML key: _disabled_mcp_servers → internal JSON key: _disabledMcpServers
    if let Some(dis) = doc.get("_disabled_mcp_servers").and_then(|i| i.as_table()) {
        for (name, item) in dis.iter() {
            disabled_map.insert(name.to_string(), toml_item_to_json(item));
        }
    }

    let root = json!({
        "mcpServers": Value::Object(enabled_map),
        "_disabledMcpServers": Value::Object(disabled_map),
    });

    Ok(HostFile {
        root,
        enabled_key: "mcpServers",
        disabled_key: "_disabledMcpServers",
        format: HostFileFormat::Toml,
    })
}

/// Write a Codex `HostFile` back to `config.toml`.
///
/// Re-reads the original file with `toml_edit` before writing so that all
/// non-MCP settings (model, features, projects, sandbox, etc.) are preserved
/// verbatim.  Only `mcp_servers` and `_disabled_mcp_servers` tables are
/// replaced.  The write is atomic (temp file → rename).
fn atomic_write_toml(path: &Path, file: &HostFile) -> Result<(), String> {
    // Re-read or create the document so non-MCP settings are preserved.
    let mut doc = if path.exists() {
        let text =
            std::fs::read_to_string(path).map_err(|e| format!("read {}: {e}", path.display()))?;
        text.parse::<DocumentMut>()
            .map_err(|e| format!("parse TOML for write {}: {e}", path.display()))?
    } else {
        DocumentMut::new()
    };

    // Replace mcp_servers.
    let empty_obj = serde_json::Map::new();
    let enabled = file
        .root
        .get("mcpServers")
        .and_then(|v| v.as_object())
        .unwrap_or(&empty_obj);
    if enabled.is_empty() {
        doc.remove("mcp_servers");
    } else {
        doc.insert("mcp_servers", Item::Table(json_to_toml_table(enabled)));
    }

    // Replace _disabled_mcp_servers.
    let disabled = file
        .root
        .get("_disabledMcpServers")
        .and_then(|v| v.as_object())
        .unwrap_or(&empty_obj);
    if disabled.is_empty() {
        doc.remove("_disabled_mcp_servers");
    } else {
        doc.insert(
            "_disabled_mcp_servers",
            Item::Table(json_to_toml_table(disabled)),
        );
    }

    // Atomic write: temp file → rename.
    let parent = path
        .parent()
        .ok_or_else(|| format!("no parent dir for {}", path.display()))?;
    std::fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
    let tmp = parent.join(format!(
        ".{}.tmp-{}",
        path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("config"),
        std::process::id()
    ));
    std::fs::write(&tmp, doc.to_string()).map_err(|e| format!("write tmp: {e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("rename: {e}"))?;
    Ok(())
}

// ── Read / write dispatch ─────────────────────────────────────────────────

/// Read a host file using the appropriate parser for its format.
fn read_host_file_for(host: McpHost, path: &Path) -> Result<HostFile, String> {
    match host {
        McpHost::Codex => read_codex_host_file(path),
        _ => read_host_file(path),
    }
}

/// Write a host file using the appropriate serialiser for its format.
fn write_host_file(path: &Path, file: &HostFile) -> Result<(), String> {
    match file.format {
        HostFileFormat::Json => atomic_write_json(path, &file.root),
        HostFileFormat::Toml => atomic_write_toml(path, file),
    }
}

// ── Adapter trait + per-host adapters ─────────────────────────────────────

/// Distinguishes JSON hosts (all existing) from the TOML-based Codex host.
/// Controls which IO path is used for reading and writing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HostFileFormat {
    Json,
    Toml,
}

/// A host's MCP file split into (enabled, disabled) raw JSON maps plus the
/// rest of the file we need to preserve verbatim on write.
#[derive(Debug, Clone)]
struct HostFile {
    /// The full file root JSON (preserves unknown keys for JSON hosts;
    /// for Codex/TOML hosts this is a synthetic JSON envelope built from the TOML).
    root: Value,
    /// Path inside `root` where the mcp blocks live. For Claude Desktop / Cursor
    /// they are at the top level; for Claude Code (`~/.claude.json`) they are
    /// also at the top level (`mcpServers`, `_disabledMcpServers`).
    enabled_key: &'static str,
    disabled_key: &'static str,
    /// Whether the underlying file is JSON or TOML.
    format: HostFileFormat,
}

impl HostFile {
    fn new(root: Value) -> Self {
        Self {
            root,
            enabled_key: "mcpServers",
            disabled_key: "_disabledMcpServers",
            format: HostFileFormat::Json,
        }
    }

    fn empty() -> Self {
        Self::new(json!({}))
    }

    fn ensure_objects(&mut self) {
        if !self.root.is_object() {
            self.root = json!({});
        }
        let obj = self.root.as_object_mut().unwrap();
        obj.entry(self.enabled_key.to_string())
            .or_insert_with(|| json!({}));
        // disabled is created lazily on first disable
    }

    fn enabled_map(&self) -> Option<&serde_json::Map<String, Value>> {
        self.root.get(self.enabled_key)?.as_object()
    }
    fn disabled_map(&self) -> Option<&serde_json::Map<String, Value>> {
        self.root.get(self.disabled_key)?.as_object()
    }
    fn enabled_map_mut(&mut self) -> &mut serde_json::Map<String, Value> {
        self.ensure_objects();
        self.root
            .as_object_mut()
            .unwrap()
            .get_mut(self.enabled_key)
            .unwrap()
            .as_object_mut()
            .unwrap()
    }
    fn disabled_map_mut(&mut self) -> &mut serde_json::Map<String, Value> {
        self.ensure_objects();
        let obj = self.root.as_object_mut().unwrap();
        obj.entry(self.disabled_key.to_string())
            .or_insert_with(|| json!({}));
        obj.get_mut(self.disabled_key)
            .unwrap()
            .as_object_mut()
            .unwrap()
    }
}

/// Detect transport from a raw JSON entry.
fn detect_transport(raw: &Value) -> Transport {
    if let Some(t) = raw.get("type").and_then(|v| v.as_str()) {
        return match t.to_ascii_lowercase().as_str() {
            "stdio" => Transport::Stdio,
            "sse" => Transport::Sse,
            "http" | "streamable-http" | "streamablehttp" => Transport::Http,
            _ => Transport::Unknown,
        };
    }
    if raw.get("command").is_some() {
        return Transport::Stdio;
    }
    if raw.get("url").is_some() {
        return Transport::Sse; // best-guess; user can change
    }
    Transport::Unknown
}

fn entry_from_value(name: &str, raw: &Value) -> McpServerEntry {
    let transport = detect_transport(raw);
    let command = raw
        .get("command")
        .and_then(|v| v.as_str())
        .map(String::from);
    let args = raw.get("args").and_then(|v| v.as_array()).map(|a| {
        a.iter()
            .filter_map(|x| x.as_str().map(String::from))
            .collect::<Vec<_>>()
    });
    let env = raw.get("env").and_then(|v| v.as_object()).map(|o| {
        o.iter()
            .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
            .collect::<HashMap<_, _>>()
    });
    let url = raw.get("url").and_then(|v| v.as_str()).map(String::from);
    let headers = raw.get("headers").and_then(|v| v.as_object()).map(|o| {
        o.iter()
            .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
            .collect::<HashMap<_, _>>()
    });
    McpServerEntry {
        name: name.to_string(),
        transport,
        command,
        args,
        env,
        url,
        headers,
        raw: raw.clone(),
    }
}

fn claude_desktop_mcp_remote_object(entry: &McpServerEntry) -> serde_json::Map<String, Value> {
    let url = entry.url.clone().unwrap_or_else(|| {
        entry
            .args
            .as_deref()
            .unwrap_or(&[])
            .iter()
            .find(|arg| {
                let lower = arg.to_ascii_lowercase();
                lower.starts_with("http://") || lower.starts_with("https://")
            })
            .cloned()
            .unwrap_or_default()
    });
    let mut args = vec![
        "/c".to_string(),
        "npx".to_string(),
        "mcp-remote@latest".to_string(),
        url.clone(),
    ];

    if let Some(headers) = &entry.headers {
        let mut pairs = headers.iter().collect::<Vec<_>>();
        pairs.sort_by(|a, b| a.0.cmp(b.0));
        for (key, value) in pairs {
            args.push("--header".to_string());
            args.push(format!("{key}: {value}"));
        }
    }
    if entry.headers.is_none() {
        let raw_args = entry.args.as_deref().unwrap_or(&[]);
        for window in raw_args.windows(2) {
            if window[0] == "--header" {
                args.push("--header".to_string());
                args.push(window[1].clone());
            }
        }
    }

    if url.to_ascii_lowercase().starts_with("http://") {
        args.push("--allow-http".to_string());
    }

    let mut obj = serde_json::Map::new();
    obj.insert("command".into(), json!("cmd"));
    obj.insert("args".into(), json!(args));
    obj
}

/// Convert a NormalizedServer entry into the on-disk JSON for a given host.
/// Returns (json, support_level).
fn entry_to_host_value(host: McpHost, entry: &McpServerEntry) -> (Value, SupportLevel) {
    // Start from the raw JSON so unknown fields (configured for that host) are preserved.
    // If raw is empty (new server) we build from scratch.
    let mut base = if entry.raw.is_object() {
        entry.raw.clone()
    } else {
        json!({})
    };
    let obj = base.as_object_mut().unwrap();

    let mut support = SupportLevel::Native;

    if matches!(host, McpHost::ClaudeDesktop)
        && matches!(entry.transport, Transport::Stdio)
        && entry
            .command
            .as_deref()
            .map(|cmd| cmd.eq_ignore_ascii_case("npx") || cmd.eq_ignore_ascii_case("npx.cmd"))
            .unwrap_or(false)
        && entry
            .args
            .as_deref()
            .unwrap_or(&[])
            .iter()
            .any(|arg| arg.to_ascii_lowercase().starts_with("mcp-remote"))
    {
        return (
            Value::Object(claude_desktop_mcp_remote_object(entry)),
            SupportLevel::Translated,
        );
    }

    match entry.transport {
        Transport::Stdio => {
            obj.remove("url");
            obj.remove("headers");
            if let Some(cmd) = &entry.command {
                obj.insert("command".into(), json!(cmd));
            }
            if let Some(args) = &entry.args {
                obj.insert("args".into(), json!(args));
            }
            if let Some(env) = &entry.env {
                obj.insert("env".into(), json!(env));
            }
            // Claude Desktop has historically only supported stdio; drop "type" key for it.
            // Codex infers transport from command vs url, but accepting "type" is forward-compatible.
            match host {
                McpHost::ClaudeDesktop => {
                    obj.remove("type");
                }
                McpHost::ClaudeCode | McpHost::Cursor | McpHost::Codex => {
                    obj.insert("type".into(), json!("stdio"));
                }
            }
        }
        Transport::Sse => {
            obj.remove("command");
            obj.remove("args");
            obj.remove("env");
            if let Some(url) = &entry.url {
                obj.insert("url".into(), json!(url));
            }
            if let Some(h) = &entry.headers {
                obj.insert("headers".into(), json!(h));
            }
            match host {
                // Cursor stores HTTP servers as SSE internally — round-trip as-is.
                McpHost::Cursor => {
                    obj.insert("type".into(), json!("sse"));
                }
                // Claude Desktop only supports stdio commands in its JSON config.
                // Wrap with mcp-remote so it can reach the remote SSE endpoint.
                McpHost::ClaudeDesktop => {
                    *obj = claude_desktop_mcp_remote_object(entry);
                    support = SupportLevel::Translated;
                }
                McpHost::ClaudeCode | McpHost::Codex => {
                    obj.insert("type".into(), json!("http"));
                    support = SupportLevel::Translated;
                }
            }
        }
        Transport::Http => {
            obj.remove("command");
            obj.remove("args");
            obj.remove("env");
            if let Some(url) = &entry.url {
                obj.insert("url".into(), json!(url));
            }
            if let Some(h) = &entry.headers {
                obj.insert("headers".into(), json!(h));
            }
            match host {
                McpHost::ClaudeCode | McpHost::Codex => {
                    obj.insert("type".into(), json!("http"));
                }
                // Claude Desktop only supports stdio commands in its JSON config.
                // Wrap with mcp-remote so it can reach the remote HTTP endpoint.
                McpHost::ClaudeDesktop => {
                    *obj = claude_desktop_mcp_remote_object(entry);
                    support = SupportLevel::Translated;
                }
                McpHost::Cursor => {
                    // Cursor stores HTTP as SSE-style entries.
                    obj.insert("type".into(), json!("sse"));
                    support = SupportLevel::Translated;
                }
            }
        }
        Transport::Unknown => {}
    }

    (Value::Object(obj.clone()), support)
}

// ── Read / write a host file ──────────────────────────────────────────────

fn read_host_file(path: &Path) -> Result<HostFile, String> {
    if !path.exists() {
        return Ok(HostFile::empty());
    }
    let text =
        std::fs::read_to_string(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    if text.trim().is_empty() {
        return Ok(HostFile::empty());
    }
    let root: Value =
        serde_json::from_str(&text).map_err(|e| format!("parse {}: {e}", path.display()))?;
    Ok(HostFile::new(root))
}

fn host_file_to_config(host: McpHost, scope: McpScope, path: PathBuf) -> McpHostConfig {
    let detected = path.exists();
    if !detected {
        return McpHostConfig {
            host,
            scope,
            path,
            detected: false,
            readable: false,
            enabled: vec![],
            disabled: vec![],
            error: None,
        };
    }
    match read_host_file_for(host, &path) {
        Ok(file) => {
            let enabled = file
                .enabled_map()
                .map(|m| {
                    m.iter()
                        .map(|(k, v)| entry_from_value(k, v))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            let disabled = file
                .disabled_map()
                .map(|m| {
                    m.iter()
                        .map(|(k, v)| entry_from_value(k, v))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            McpHostConfig {
                host,
                scope,
                path,
                detected: true,
                readable: true,
                enabled,
                disabled,
                error: None,
            }
        }
        Err(e) => McpHostConfig {
            host,
            scope,
            path,
            detected: true,
            readable: false,
            enabled: vec![],
            disabled: vec![],
            error: Some(e),
        },
    }
}

fn list_global_hosts() -> Vec<McpHostConfig> {
    let mut out = Vec::new();
    if let Some(p) = claude_desktop_config_path() {
        out.push(host_file_to_config(
            McpHost::ClaudeDesktop,
            McpScope::Global,
            p,
        ));
    }
    if let Some(p) = claude_code_user_config_path() {
        out.push(host_file_to_config(
            McpHost::ClaudeCode,
            McpScope::Global,
            p,
        ));
    }
    if let Some(p) = cursor_global_config_path() {
        out.push(host_file_to_config(McpHost::Cursor, McpScope::Global, p));
    }
    if let Some(p) = codex_global_config_path() {
        out.push(host_file_to_config(McpHost::Codex, McpScope::Global, p));
    }
    out
}

fn list_project_hosts(projects: &[PathBuf]) -> Vec<McpHostConfig> {
    let mut out = Vec::new();
    for root in projects {
        for host in [McpHost::ClaudeCode, McpHost::Cursor] {
            if let Some(p) = project_config_path(host, root) {
                out.push(host_file_to_config(
                    host,
                    McpScope::Project(root.clone()),
                    p,
                ));
            }
        }
    }
    out
}

// ── Project root persistence ──────────────────────────────────────────────

const PROJECTS_KEY: &str = "mcp_projects";

fn read_projects(app: &AppHandle) -> Vec<PathBuf> {
    use tauri_plugin_store::StoreExt;
    let Ok(store) = app.store("credentials.json") else {
        return Vec::new();
    };
    let Some(v) = store.get(PROJECTS_KEY) else {
        return Vec::new();
    };
    serde_json::from_value::<Vec<String>>(v)
        .unwrap_or_default()
        .into_iter()
        .map(PathBuf::from)
        .collect()
}

fn write_projects(app: &AppHandle, projects: &[PathBuf]) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;
    let store = app
        .store("credentials.json")
        .map_err(|e| format!("store: {e}"))?;
    let v: Vec<String> = projects.iter().map(|p| p.display().to_string()).collect();
    store.set(PROJECTS_KEY, json!(v));
    store.save().map_err(|e| format!("store save: {e}"))?;
    Ok(())
}

// ── Mutation helpers ──────────────────────────────────────────────────────

fn target_path(target: &HostTarget) -> Option<PathBuf> {
    match (target.host, &target.scope) {
        (McpHost::ClaudeDesktop, McpScope::Global) => claude_desktop_config_path(),
        (McpHost::ClaudeCode, McpScope::Global) => claude_code_user_config_path(),
        (McpHost::Cursor, McpScope::Global) => cursor_global_config_path(),
        (McpHost::Codex, McpScope::Global) => codex_global_config_path(),
        (McpHost::Codex, McpScope::Project(_)) => None,
        (host, McpScope::Project(p)) => project_config_path(host, p),
    }
}

fn set_server_in_file(file: &mut HostFile, name: &str, value: Value, enabled: bool) {
    // Remove from both maps first to avoid duplication
    if let Some(m) = file
        .root
        .get_mut(file.enabled_key)
        .and_then(|v| v.as_object_mut())
    {
        m.remove(name);
    }
    if let Some(m) = file
        .root
        .get_mut(file.disabled_key)
        .and_then(|v| v.as_object_mut())
    {
        m.remove(name);
    }
    if enabled {
        file.enabled_map_mut().insert(name.to_string(), value);
    } else {
        file.disabled_map_mut().insert(name.to_string(), value);
    }
}

fn move_server_in_file(file: &mut HostFile, name: &str, enable: bool) -> bool {
    let from_key = if enable {
        file.disabled_key
    } else {
        file.enabled_key
    };
    let val = file
        .root
        .get_mut(from_key)
        .and_then(|v| v.as_object_mut())
        .and_then(|m| m.remove(name));
    let Some(val) = val else { return false };
    if enable {
        file.enabled_map_mut().insert(name.to_string(), val);
    } else {
        file.disabled_map_mut().insert(name.to_string(), val);
    }
    true
}

fn remove_server_in_file(file: &mut HostFile, name: &str) -> bool {
    let mut removed = false;
    if let Some(m) = file
        .root
        .get_mut(file.enabled_key)
        .and_then(|v| v.as_object_mut())
    {
        if m.remove(name).is_some() {
            removed = true;
        }
    }
    if let Some(m) = file
        .root
        .get_mut(file.disabled_key)
        .and_then(|v| v.as_object_mut())
    {
        if m.remove(name).is_some() {
            removed = true;
        }
    }
    removed
}

// ── Notifications + restart prompt ────────────────────────────────────────

fn notify_change(app: &AppHandle, affected: &[McpHost], server_name: &str) {
    use tauri_plugin_notification::NotificationExt;
    let mut restartable: Vec<McpHost> = Vec::new();
    for host in affected.iter().copied() {
        if !restartable.contains(&host) {
            restartable.push(host);
        }
    }
    if restartable.is_empty() {
        return;
    }
    let body = format!(
        "{} changed in {}. Restart its MCP process to apply?",
        server_name,
        restartable
            .iter()
            .map(|h| match h {
                McpHost::ClaudeDesktop => "Claude Desktop",
                McpHost::Cursor => "Cursor",
                McpHost::ClaudeCode => "Claude Code",
                McpHost::Codex => "Codex",
            })
            .collect::<Vec<_>>()
            .join(", ")
    );
    let _ = app
        .notification()
        .builder()
        .title("MCP server changed")
        .body(body)
        .show();
    let _ = app.emit(
        "mcp-restart-prompt",
        json!({
            "hosts": restartable,
            "server": server_name,
        }),
    );
}

// ── Tauri commands ────────────────────────────────────────────────────────

#[tauri::command]
pub fn mcp_list_hosts(app: AppHandle) -> Vec<McpHostConfig> {
    let mut all = list_global_hosts();
    let projects = read_projects(&app);
    all.extend(list_project_hosts(&projects));
    all
}

#[tauri::command]
pub fn mcp_list_servers_unified(app: AppHandle) -> Vec<UnifiedServerView> {
    let hosts = mcp_list_hosts(app);
    let mut by_name: HashMap<String, UnifiedServerView> = HashMap::new();
    for h in hosts {
        if !h.detected {
            continue;
        }
        let target = HostTarget {
            host: h.host,
            scope: h.scope.clone(),
        };
        for entry in h.enabled.iter() {
            let v = by_name
                .entry(entry.name.clone())
                .or_insert_with(|| UnifiedServerView {
                    name: entry.name.clone(),
                    presence: vec![],
                });
            v.presence.push(UnifiedPresence {
                target: target.clone(),
                enabled: true,
                entry: entry.clone(),
            });
        }
        for entry in h.disabled.iter() {
            let v = by_name
                .entry(entry.name.clone())
                .or_insert_with(|| UnifiedServerView {
                    name: entry.name.clone(),
                    presence: vec![],
                });
            v.presence.push(UnifiedPresence {
                target: target.clone(),
                enabled: false,
                entry: entry.clone(),
            });
        }
    }
    let mut out: Vec<_> = by_name.into_values().collect();
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

#[tauri::command]
pub fn mcp_running_hosts() -> Vec<McpHost> {
    crate::process_monitor::running_hosts()
}

#[tauri::command]
pub fn mcp_register_project(app: AppHandle, path: String) -> Result<(), String> {
    let mut projects = read_projects(&app);
    let p = PathBuf::from(path);
    if !projects.iter().any(|x| x == &p) {
        projects.push(p);
    }
    write_projects(&app, &projects)
}

#[tauri::command]
pub fn mcp_unregister_project(app: AppHandle, path: String) -> Result<(), String> {
    let mut projects = read_projects(&app);
    let p = PathBuf::from(path);
    projects.retain(|x| x != &p);
    write_projects(&app, &projects)
}

#[tauri::command]
pub fn mcp_list_projects(app: AppHandle) -> Vec<String> {
    read_projects(&app)
        .into_iter()
        .map(|p| p.display().to_string())
        .collect()
}

#[tauri::command]
pub fn mcp_set_enabled(
    app: AppHandle,
    state: tauri::State<'_, std::sync::Arc<McpState>>,
    server: String,
    target: HostTarget,
    enabled: bool,
) -> Result<(), String> {
    let path = target_path(&target).ok_or_else(|| "no path for target".to_string())?;
    ensure_backup(&app, &state, target.host, &target.scope, &path)?;
    let mut file = read_host_file_for(target.host, &path)?;
    if !move_server_in_file(&mut file, &server, enabled) {
        return Err(format!(
            "server '{}' not found in {}",
            server,
            path.display()
        ));
    }
    write_host_file(&path, &file)?;
    notify_change(&app, &[target.host], &server);
    Ok(())
}

#[tauri::command]
pub fn mcp_set_enabled_bulk(
    app: AppHandle,
    state: tauri::State<'_, std::sync::Arc<McpState>>,
    server: String,
    changes: Vec<(HostTarget, bool)>,
) -> Result<(), String> {
    let mut affected: Vec<McpHost> = Vec::new();
    for (target, enabled) in changes {
        let path = target_path(&target).ok_or_else(|| "no path for target".to_string())?;
        ensure_backup(&app, &state, target.host, &target.scope, &path)?;
        let mut file = read_host_file_for(target.host, &path)?;
        if move_server_in_file(&mut file, &server, enabled) {
            write_host_file(&path, &file)?;
            if !affected.contains(&target.host) {
                affected.push(target.host);
            }
        }
    }
    notify_change(&app, &affected, &server);
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddServerInput {
    pub server: McpServerEntry,
    pub targets: Vec<HostTarget>,
    pub enabled: bool,
}

#[tauri::command]
pub fn mcp_add_server(
    app: AppHandle,
    state: tauri::State<'_, std::sync::Arc<McpState>>,
    input: AddServerInput,
) -> Result<AddReport, String> {
    let mut outcomes = Vec::new();
    let mut affected: Vec<McpHost> = Vec::new();
    for target in &input.targets {
        let Some(path) = target_path(target) else {
            outcomes.push(WriteOutcome {
                target: target.clone(),
                support: SupportLevel::Unsupported,
                written: false,
                note: Some("no config path for target".into()),
            });
            continue;
        };
        let (value, support) = entry_to_host_value(target.host, &input.server);
        if support == SupportLevel::Unsupported {
            outcomes.push(WriteOutcome {
                target: target.clone(),
                support,
                written: false,
                note: Some(format!(
                    "{:?} transport not supported by {:?}",
                    input.server.transport, target.host
                )),
            });
            continue;
        }
        ensure_backup(&app, &state, target.host, &target.scope, &path)?;
        let mut file = read_host_file_for(target.host, &path)?;
        set_server_in_file(&mut file, &input.server.name, value, input.enabled);
        write_host_file(&path, &file)?;
        if !affected.contains(&target.host) {
            affected.push(target.host);
        }
        outcomes.push(WriteOutcome {
            target: target.clone(),
            support,
            written: true,
            note: None,
        });
    }
    notify_change(&app, &affected, &input.server.name);
    Ok(AddReport { outcomes })
}

#[tauri::command]
pub fn mcp_remove_server(
    app: AppHandle,
    state: tauri::State<'_, std::sync::Arc<McpState>>,
    server: String,
    target: HostTarget,
) -> Result<(), String> {
    let path = target_path(&target).ok_or_else(|| "no path for target".to_string())?;
    ensure_backup(&app, &state, target.host, &target.scope, &path)?;
    let mut file = read_host_file_for(target.host, &path)?;
    if !remove_server_in_file(&mut file, &server) {
        return Err(format!("server '{}' not found", server));
    }
    write_host_file(&path, &file)?;
    notify_change(&app, &[target.host], &server);
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyServerInput {
    pub server: String,
    pub from: HostTarget,
    pub to: Vec<HostTarget>,
    pub enabled: bool,
}

#[tauri::command]
pub fn mcp_copy_server(
    app: AppHandle,
    state: tauri::State<'_, std::sync::Arc<McpState>>,
    input: CopyServerInput,
) -> Result<AddReport, String> {
    let path = target_path(&input.from).ok_or_else(|| "no path for source".to_string())?;
    let file = read_host_file_for(input.from.host, &path)?;
    let raw = file
        .enabled_map()
        .and_then(|m| m.get(&input.server))
        .or_else(|| file.disabled_map().and_then(|m| m.get(&input.server)))
        .cloned()
        .ok_or_else(|| format!("server '{}' not found at source", input.server))?;
    let entry = entry_from_value(&input.server, &raw);

    mcp_add_server(
        app,
        state,
        AddServerInput {
            server: entry,
            targets: input.to,
            enabled: input.enabled,
        },
    )
}

#[tauri::command]
pub fn mcp_restart_host(host: McpHost) -> Result<(), String> {
    let plan = host
        .relaunch_args()
        .ok_or_else(|| "host has no restart plan".to_string())?;
    // Brief pause so the OS releases file locks before relaunch.
    match plan {
        RelaunchPlan::AppNamed(name) => crate::process_monitor::restart_app_named(name),
        RelaunchPlan::StoreApp { aumid, kill_image } => {
            crate::process_monitor::kill_store_app(kill_image)?;
            std::thread::sleep(std::time::Duration::from_millis(400));
            crate::process_monitor::launch_store_app(aumid)
        }
    }
}

#[tauri::command]
pub fn mcp_restart_server(app: AppHandle, host: McpHost, server: String) -> Result<(), String> {
    let mut configs = list_global_hosts();
    let projects = read_projects(&app);
    configs.extend(list_project_hosts(&projects));

    let matching: Vec<&McpHostConfig> = configs
        .iter()
        .filter(|config| config.host == host && config.readable)
        .collect();

    let entry_is_enabled = matching.iter().any(|config| {
        config.enabled.iter().any(|entry| entry.name == server)
    });

    let entry = matching
        .iter()
        .find_map(|config| config.enabled.iter().find(|e| e.name == server))
        .cloned()
        .or_else(|| {
            matching
                .iter()
                .find_map(|config| config.disabled.iter().find(|e| e.name == server))
                .cloned()
        })
        .ok_or_else(|| format!("server '{server}' not found for {host:?}"))?;

    let (host_value, _) = entry_to_host_value(host, &entry);
    let command = host_value
        .get("command")
        .and_then(|v| v.as_str())
        .or(entry.command.as_deref())
        .ok_or_else(|| format!("server '{server}' has no command to restart"))?;
    let args = host_value
        .get("args")
        .and_then(|v| v.as_array())
        .map(|args| {
            args.iter()
                .filter_map(|arg| arg.as_str().map(String::from))
                .collect::<Vec<_>>()
        })
        .or(entry.args.clone())
        .unwrap_or_default();

    match crate::process_monitor::restart_mcp_server_process(&server, command, &args) {
        Ok(()) => Ok(()),
        Err(restart_error) if restart_error.starts_with("No running MCP process matched") => {
            // Only auto-launch when the server is enabled; after a disable we must not spawn it.
            if entry_is_enabled {
                crate::process_monitor::launch_mcp_server_process(command, &args)
                    .map_err(|launch_error| format!("{restart_error}; {launch_error}"))
            } else {
                Ok(())
            }
        }
        Err(err) => Err(err),
    }
}

#[tauri::command]
pub fn mcp_preview_translation(host: McpHost, server: McpServerEntry) -> Value {
    let (v, support) = entry_to_host_value(host, &server);
    json!({ "value": v, "support": support })
}

/// Debug: return the resolved config path and raw file contents for a host.
#[tauri::command]
pub fn mcp_debug_host(host: McpHost) -> Value {
    let path = match host {
        McpHost::ClaudeDesktop => claude_desktop_config_path(),
        McpHost::ClaudeCode => claude_code_user_config_path(),
        McpHost::Cursor => cursor_global_config_path(),
        McpHost::Codex => codex_global_config_path(),
    };
    let Some(path) = path else {
        return json!({ "error": "could not resolve path" });
    };
    let path_str = path.display().to_string();
    let exists = path.exists();
    if !exists {
        return json!({ "path": path_str, "exists": false });
    }
    match std::fs::read_to_string(&path) {
        Ok(text) => json!({ "path": path_str, "exists": true, "content": text }),
        Err(e) => json!({ "path": path_str, "exists": true, "error": e.to_string() }),
    }
}
