// Lightweight running-process detection used by the MCP manager to decide
// whether to offer a restart prompt after a config change.

use crate::commands::mcp::McpHost;
use serde::Deserialize;

#[cfg(target_os = "windows")]
mod windows_impl {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use std::path::PathBuf;
    use windows::core::PWSTR;
    use windows::Win32::Foundation::{CloseHandle, BOOL};
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, TerminateProcess, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE,
    };

    #[derive(Debug, Clone)]
    struct ProcessInfo {
        pid: u32,
        name: String,
        path: Option<PathBuf>,
    }

    fn running_processes() -> Vec<ProcessInfo> {
        let mut out = Vec::new();
        unsafe {
            let snap = match CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) {
                Ok(h) => h,
                Err(_) => return out,
            };
            let mut entry = PROCESSENTRY32W {
                dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
                ..Default::default()
            };
            if Process32FirstW(snap, &mut entry).is_ok() {
                loop {
                    let len = entry
                        .szExeFile
                        .iter()
                        .position(|&c| c == 0)
                        .unwrap_or(entry.szExeFile.len());
                    let name = OsString::from_wide(&entry.szExeFile[..len])
                        .to_string_lossy()
                        .into_owned();
                    if !name.is_empty() {
                        out.push(ProcessInfo {
                            pid: entry.th32ProcessID,
                            path: process_path(entry.th32ProcessID),
                            name,
                        });
                    }
                    if Process32NextW(snap, &mut entry).is_err() {
                        break;
                    }
                }
            }
            let _ = CloseHandle(snap);
        }
        out
    }

    fn process_path(pid: u32) -> Option<PathBuf> {
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, BOOL(0), pid).ok()?;
            let mut size = 32768u32;
            let mut buffer = vec![0u16; size as usize];
            let result = QueryFullProcessImageNameW(
                handle,
                PROCESS_NAME_WIN32,
                PWSTR(buffer.as_mut_ptr()),
                &mut size,
            );
            let _ = CloseHandle(handle);
            result.ok()?;
            Some(PathBuf::from(OsString::from_wide(&buffer[..size as usize])))
        }
    }

    pub fn running_process_names() -> Vec<String> {
        running_processes()
            .into_iter()
            .map(|process| process.name)
            .collect()
    }

    fn app_key(app: &str) -> String {
        app.trim_end_matches(".exe").to_ascii_lowercase()
    }

    fn looks_like_known_gui_app_path(app: &str, path: &std::path::Path) -> bool {
        let path = path.to_string_lossy().to_ascii_lowercase();
        match app_key(app).as_str() {
            "claude" => {
                (path.contains(r"\anthropicclaude\")
                    || path.contains(r"\appdata\local\claude\")
                    || path.contains(r"\programs\claude\")
                    || path.contains(r"\programs\anthropicclaude\"))
                    && !path.contains(r"\.local\bin\")
                    && !path.contains(r"\claude-cli")
            }
            "cursor" => path.contains(r"\programs\cursor\") || path.contains(r"\cursor\"),
            _ => true,
        }
    }

    /// Resolve the full install path for a known GUI app under %LOCALAPPDATA%.
    /// Returns None if nothing is found at any candidate path.
    fn find_install_path(app: &str) -> Option<PathBuf> {
        let local = std::env::var("LOCALAPPDATA").ok()?;
        let base = PathBuf::from(&local);

        let candidates: &[&str] = match app_key(app).as_str() {
            "claude" => &[
                // Electron installer (squirrel) puts it here
                r"Claude\Claude.exe",
                r"Programs\Claude\Claude.exe",
                r"AnthropicClaude\claude.exe",
                r"Programs\AnthropicClaude\claude.exe",
                r"AnthropicClaude\Claude.exe",
                r"Programs\AnthropicClaude\Claude.exe",
                r"Claude\app-*\Claude.exe",
                r"Programs\Claude\app-*\Claude.exe",
                r"AnthropicClaude\app-*\Claude.exe",
                r"Programs\AnthropicClaude\app-*\Claude.exe",
            ],
            "cursor" => &[
                r"Programs\cursor\Cursor.exe",
                r"Programs\Cursor\Cursor.exe",
                r"cursor\Cursor.exe",
            ],
            // Codex is a Windows Store (MSIX) app — cannot be launched via direct exe path.
            // Return None so the caller falls through to launch_store_app.
            "codex" => return None,
            _ => return None,
        };

        for rel in candidates {
            if rel.contains('*') {
                if let Some(path) = find_wildcard_path(&base, rel) {
                    return Some(path);
                }
            } else {
                let p = base.join(rel);
                if p.exists() {
                    return Some(p);
                }
            }
        }

        // Also try the App Paths registry key that installers register.
        // Query: reg query "HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\<Name>.exe" /ve
        let reg_key = format!(
            r"HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{}.exe",
            // Capitalise first letter as that's what most installers use
            {
                let mut c = app.chars();
                match c.next() {
                    None => String::new(),
                    Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                }
            }
        );
        if let Ok(output) = std::process::Command::new("reg")
            .args(["query", &reg_key, "/ve"])
            .output()
        {
            if output.status.success() {
                let text = String::from_utf8_lossy(&output.stdout);
                // Output looks like:
                //   (Default)    REG_SZ    C:\Users\...\Claude.exe
                for line in text.lines() {
                    let line = line.trim();
                    if let Some(idx) = line.rfind("REG_SZ") {
                        let path_str = line[idx + 6..].trim();
                        let p = PathBuf::from(path_str);
                        if p.exists() {
                            return Some(p);
                        }
                    }
                }
            }
        }

        // Same but HKLM
        let reg_key_lm = reg_key.replace("HKCU\\", "HKLM\\");
        if let Ok(output) = std::process::Command::new("reg")
            .args(["query", &reg_key_lm, "/ve"])
            .output()
        {
            if output.status.success() {
                let text = String::from_utf8_lossy(&output.stdout);
                for line in text.lines() {
                    let line = line.trim();
                    if let Some(idx) = line.rfind("REG_SZ") {
                        let path_str = line[idx + 6..].trim();
                        let p = PathBuf::from(path_str);
                        if p.exists() {
                            return Some(p);
                        }
                    }
                }
            }
        }

        None
    }

    fn find_wildcard_path(base: &std::path::Path, pattern: &str) -> Option<PathBuf> {
        let parts: Vec<&str> = pattern.split('\\').collect();
        let wildcard_index = parts.iter().position(|part| part.contains('*'))?;
        let mut dir = base.to_path_buf();
        for part in &parts[..wildcard_index] {
            dir.push(part);
        }

        let wildcard = parts[wildcard_index];
        let star_index = wildcard.find('*')?;
        let prefix = wildcard[..star_index].to_ascii_lowercase();
        let suffix = wildcard[star_index + 1..].to_ascii_lowercase();
        let tail = &parts[wildcard_index + 1..];
        let entries = std::fs::read_dir(dir).ok()?;
        for entry in entries.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if !file_type.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
            if !name.starts_with(&prefix) || !name.ends_with(&suffix) {
                continue;
            }
            let mut candidate = entry.path();
            for part in tail {
                candidate.push(part);
            }
            if candidate.exists() {
                return Some(candidate);
            }
        }
        None
    }

    fn find_running_app_path(app: &str) -> Option<PathBuf> {
        let key = app_key(app);
        running_processes()
            .into_iter()
            .filter(|process| app_key(&process.name) == key)
            .filter_map(|process| process.path)
            .find(|path| looks_like_known_gui_app_path(&key, path))
    }

    pub fn running_hosts() -> Vec<crate::commands::mcp::McpHost> {
        let processes = running_processes();
        let mut out = Vec::new();
        for host in [
            crate::commands::mcp::McpHost::ClaudeDesktop,
            crate::commands::mcp::McpHost::Cursor,
            crate::commands::mcp::McpHost::Codex,
        ] {
            let is_running = processes.iter().any(|process| {
                host.process_names_public().iter().any(|target| {
                    app_key(&process.name) == app_key(target)
                        && process
                            .path
                            .as_deref()
                            .map(|path| looks_like_known_gui_app_path(target, path))
                            .unwrap_or(!matches!(
                                host,
                                crate::commands::mcp::McpHost::ClaudeDesktop
                            ))
                })
            });
            if is_running {
                out.push(host);
            }
        }
        out
    }

    fn find_start_menu_shortcut(app: &str) -> Option<PathBuf> {
        let app = app_key(app);
        let mut roots = Vec::new();
        if let Ok(appdata) = std::env::var("APPDATA") {
            roots.push(PathBuf::from(appdata).join(r"Microsoft\Windows\Start Menu\Programs"));
        }
        if let Ok(program_data) = std::env::var("PROGRAMDATA") {
            roots.push(PathBuf::from(program_data).join(r"Microsoft\Windows\Start Menu\Programs"));
        }
        for root in roots {
            if let Some(path) = find_shortcut_recursive(&root, &app) {
                return Some(path);
            }
        }
        None
    }

    fn find_shortcut_recursive(dir: &std::path::Path, app: &str) -> Option<PathBuf> {
        let entries = std::fs::read_dir(dir).ok()?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Some(found) = find_shortcut_recursive(&path, app) {
                    return Some(found);
                }
                continue;
            }
            let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
                continue;
            };
            if !ext.eq_ignore_ascii_case("lnk") {
                continue;
            }
            let name = path
                .file_stem()
                .and_then(|n| n.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            if name == app || name.contains(&app) {
                return Some(path);
            }
        }
        None
    }

    /// Kill all processes whose image name matches `name` (case-insensitive).
    /// We kill by the *resolved* exe filename to avoid accidentally killing
    /// a same-named CLI tool (e.g. claude.exe CLI vs Claude.exe desktop).
    pub fn kill_by_image(name: &str) -> Result<(), String> {
        let key = app_key(name);
        for process in running_processes() {
            if app_key(&process.name) != key {
                continue;
            }
            let Some(path) = &process.path else { continue };
            if !looks_like_known_gui_app_path(&key, path) {
                continue;
            }
            unsafe {
                if let Ok(handle) = OpenProcess(PROCESS_TERMINATE, BOOL(0), process.pid) {
                    let _ = TerminateProcess(handle, 0);
                    let _ = CloseHandle(handle);
                }
            }
        }
        Ok(())
    }

    pub fn launch_app_named(name: &str) -> Result<(), String> {
        // Always prefer the resolved install path over PATH lookup.
        // This prevents accidentally launching the `claude` CLI (which lives on
        // PATH) instead of Claude Desktop (which does not).
        if let Some(path) = find_install_path(name) {
            std::process::Command::new(&path)
                .spawn()
                .map_err(|e| format!("launch {:?}: {e}", path))?;
            return Ok(());
        }

        if let Some(shortcut) = find_start_menu_shortcut(name) {
            std::process::Command::new("cmd")
                .args(["/C", "start", ""])
                .arg(&shortcut)
                .spawn()
                .map_err(|e| format!("launch shortcut {:?}: {e}", shortcut))?;
            return Ok(());
        }

        Err(format!(
            "Could not find installed {name} desktop app. Refusing to launch {name}.exe from PATH."
        ))
    }

    pub fn restart_app_named(name: &str) -> Result<(), String> {
        let running_path = find_running_app_path(name);
        kill_by_image(name)?;
        std::thread::sleep(std::time::Duration::from_millis(400));

        if let Some(path) = running_path {
            std::process::Command::new(&path)
                .spawn()
                .map_err(|e| format!("launch {:?}: {e}", path))?;
            return Ok(());
        }

        launch_app_named(name)
    }

    /// Launch a Windows Store (MSIX) app via the shell:AppsFolder protocol.
    /// Direct exe invocation fails for Store apps; Explorer handles the AUMID launch.
    pub fn launch_store_app(aumid: &str) -> Result<(), String> {
        let shell_url = format!("shell:AppsFolder\\{}", aumid);
        std::process::Command::new("explorer.exe")
            .arg(&shell_url)
            .spawn()
            .map_err(|e| format!("launch store app {aumid}: {e}"))?;
        Ok(())
    }

    /// Kill a process by its image name (e.g. "Codex.exe").
    pub fn kill_store_app(image: &str) -> Result<(), String> {
        // taskkill returns non-zero if the process wasn't running — that's fine.
        let _ = std::process::Command::new("taskkill")
            .args(["/IM", image, "/F"])
            .status()
            .map_err(|e| format!("taskkill {image}: {e}"))?;
        Ok(())
    }
}

#[cfg(target_os = "macos")]
mod macos_impl {

    pub fn running_process_names() -> Vec<String> {
        // Shell out to `pgrep -lx` for simplicity; matches exact process names.
        let mut out = Vec::new();
        for candidate in &["Claude", "Cursor", "Codex"] {
            if let Ok(output) = std::process::Command::new("pgrep")
                .args(["-x", candidate])
                .output()
            {
                if output.status.success() && !output.stdout.is_empty() {
                    out.push((*candidate).to_string());
                }
            }
        }
        out
    }

    pub fn kill_by_image(name: &str) -> Result<(), String> {
        // Try graceful quit via AppleScript first.
        let _ = std::process::Command::new("osascript")
            .args(["-e", &format!("tell application \"{}\" to quit", name)])
            .status();
        Ok(())
    }

    pub fn launch_app_named(name: &str) -> Result<(), String> {
        std::process::Command::new("open")
            .args(["-a", name])
            .spawn()
            .map_err(|e| format!("open -a {name}: {e}"))?;
        Ok(())
    }

    pub fn restart_app_named(name: &str) -> Result<(), String> {
        kill_by_image(name)?;
        std::thread::sleep(std::time::Duration::from_millis(400));
        launch_app_named(name)
    }

    pub fn launch_store_app(_aumid: &str) -> Result<(), String> {
        launch_app_named("Codex")
    }

    pub fn kill_store_app(_image: &str) -> Result<(), String> {
        kill_by_image("Codex")
    }
}

#[cfg(target_os = "linux")]
mod linux_impl {

    pub fn running_process_names() -> Vec<String> {
        let mut out = Vec::new();
        for candidate in &["claude", "Claude", "cursor", "Cursor", "codex", "Codex"] {
            if let Ok(output) = std::process::Command::new("pgrep")
                .args(["-x", candidate])
                .output()
            {
                if output.status.success() && !output.stdout.is_empty() {
                    out.push((*candidate).to_string());
                }
            }
        }
        out
    }

    pub fn kill_by_image(name: &str) -> Result<(), String> {
        let _ = std::process::Command::new("pkill")
            .args(["-x", name])
            .status();
        Ok(())
    }

    pub fn launch_app_named(name: &str) -> Result<(), String> {
        let lower = name.to_lowercase();
        std::process::Command::new(&lower)
            .spawn()
            .map_err(|e| format!("launch {lower}: {e}"))?;
        Ok(())
    }

    pub fn restart_app_named(name: &str) -> Result<(), String> {
        kill_by_image(name)?;
        std::thread::sleep(std::time::Duration::from_millis(400));
        launch_app_named(name)
    }

    pub fn launch_store_app(_aumid: &str) -> Result<(), String> {
        launch_app_named("codex")
    }

    pub fn kill_store_app(_image: &str) -> Result<(), String> {
        kill_by_image("codex")
    }
}

#[cfg(target_os = "linux")]
use linux_impl as platform;
#[cfg(target_os = "macos")]
use macos_impl as platform;
#[cfg(target_os = "windows")]
use windows_impl as platform;

pub fn running_process_names() -> Vec<String> {
    platform::running_process_names()
}

pub fn running_hosts() -> Vec<McpHost> {
    #[cfg(target_os = "windows")]
    {
        return platform::running_hosts();
    }

    #[cfg(not(target_os = "windows"))]
    {
        let names = running_process_names();
        let lower: Vec<String> = names.iter().map(|s| s.to_lowercase()).collect();
        let mut out = Vec::new();
        for host in [McpHost::ClaudeDesktop, McpHost::Cursor, McpHost::Codex] {
            let process_names = host.process_names_public();
            if process_names.iter().any(|target| {
                let t = target.to_lowercase();
                lower.iter().any(|n| n == &t)
            }) {
                out.push(host);
            }
        }
        out
    }
}

pub fn kill_host(host: McpHost) -> Result<(), String> {
    for name in host.process_names_public() {
        let _ = platform::kill_by_image(name);
    }
    Ok(())
}

pub fn launch_app_named(name: &str) -> Result<(), String> {
    platform::launch_app_named(name)
}

pub fn restart_app_named(name: &str) -> Result<(), String> {
    platform::restart_app_named(name)
}

pub fn launch_store_app(aumid: &str) -> Result<(), String> {
    platform::launch_store_app(aumid)
}

pub fn kill_store_app(image: &str) -> Result<(), String> {
    platform::kill_store_app(image)
}

#[derive(Debug, Clone, Deserialize)]
struct ProcessSnapshot {
    pid: u32,
    ppid: u32,
    name: String,
    #[serde(default, deserialize_with = "nullable_string")]
    command_line: String,
}

fn nullable_string<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(Option::<String>::deserialize(deserializer)?.unwrap_or_default())
}

fn process_snapshots() -> Result<Vec<ProcessSnapshot>, String> {
    #[cfg(target_os = "windows")]
    {
        let script = r#"
$ErrorActionPreference = 'SilentlyContinue'
Get-CimInstance Win32_Process |
  Select-Object @{Name='pid';Expression={$_.ProcessId}},
                @{Name='ppid';Expression={$_.ParentProcessId}},
                @{Name='name';Expression={$_.Name}},
                @{Name='command_line';Expression={$_.CommandLine}} |
  ConvertTo-Json -Compress
"#;
        let output = std::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", script])
            .output()
            .map_err(|e| format!("query processes: {e}"))?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        parse_process_json(&String::from_utf8_lossy(&output.stdout))
    }

    #[cfg(not(target_os = "windows"))]
    {
        let output = std::process::Command::new("ps")
            .args(["-axo", "pid=,ppid=,comm=,args="])
            .output()
            .map_err(|e| format!("query processes: {e}"))?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        Ok(String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter_map(parse_ps_line)
            .collect())
    }
}

#[cfg(target_os = "windows")]
fn parse_process_json(text: &str) -> Result<Vec<ProcessSnapshot>, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    if trimmed.starts_with('[') {
        serde_json::from_str(trimmed).map_err(|e| format!("parse process list: {e}"))
    } else {
        let one: ProcessSnapshot =
            serde_json::from_str(trimmed).map_err(|e| format!("parse process list: {e}"))?;
        Ok(vec![one])
    }
}

#[cfg(not(target_os = "windows"))]
fn parse_ps_line(line: &str) -> Option<ProcessSnapshot> {
    let mut parts = line.trim_start().splitn(4, char::is_whitespace);
    let pid = parts.next()?.trim().parse().ok()?;
    let rest = parts.as_str();
    let mut rest_parts = rest.trim_start().splitn(3, char::is_whitespace);
    let ppid = rest_parts.next()?.trim().parse().ok()?;
    let rest = rest_parts.as_str();
    let mut rest_parts = rest.trim_start().splitn(2, char::is_whitespace);
    let name = rest_parts.next()?.to_string();
    let command_line = rest_parts.as_str().trim().to_string();
    Some(ProcessSnapshot {
        pid,
        ppid,
        name,
        command_line,
    })
}

fn normalize_token(value: &str) -> String {
    value
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .to_ascii_lowercase()
}

fn is_generic_mcp_token(value: &str) -> bool {
    matches!(
        normalize_token(value).as_str(),
        ""
            | "/c"
            | "-c"
            | "-y"
            | "cmd"
            | "cmd.exe"
            | "node"
            | "node.exe"
            | "npx"
            | "npx.cmd"
            | "npx.exe"
            | "uv"
            | "uvx"
            | "python"
            | "python.exe"
            | "python3"
            | "mcp-remote"
            | "mcp-remote@latest"
    )
}

fn restart_match_tokens(command: &str, args: &[String]) -> Vec<String> {
    let mut tokens = Vec::new();
    if !is_generic_mcp_token(command) {
        tokens.push(command.to_string());
    }
    for arg in args {
        let token = normalize_token(arg);
        if token.len() < 4 || is_generic_mcp_token(&token) || token.starts_with("--") {
            continue;
        }
        tokens.push(arg.to_string());
    }
    tokens.sort();
    tokens.dedup();
    tokens
}

fn looks_like_host_process(process: &ProcessSnapshot) -> bool {
    let name = process.name.to_ascii_lowercase();
    matches!(
        name.as_str(),
        "claude.exe" | "claude" | "cursor.exe" | "cursor" | "codex.exe" | "codex"
    )
}

fn matching_process_score(process: &ProcessSnapshot, tokens: &[String]) -> usize {
    if looks_like_host_process(process) {
        return 0;
    }
    let haystack = process.command_line.to_ascii_lowercase();
    tokens
        .iter()
        .filter(|token| haystack.contains(&normalize_token(token)))
        .count()
}

fn descendant_pids(processes: &[ProcessSnapshot], root_pid: u32) -> Vec<u32> {
    let mut result = Vec::new();
    let mut stack = vec![root_pid];
    while let Some(pid) = stack.pop() {
        for child in processes.iter().filter(|process| process.ppid == pid) {
            result.push(child.pid);
            stack.push(child.pid);
        }
    }
    result
}

fn kill_pid(pid: u32) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status()
            .map_err(|e| format!("taskkill {pid}: {e}"))?;
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = std::process::Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .status()
            .map_err(|e| format!("kill {pid}: {e}"))?;
        Ok(())
    }
}

pub fn restart_mcp_server_process(
    server_name: &str,
    command: &str,
    args: &[String],
) -> Result<(), String> {
    let tokens = restart_match_tokens(command, args);
    if tokens.is_empty() {
        return Err(format!(
            "Cannot identify process for '{server_name}' because its command has no unique tokens"
        ));
    }

    let current_pid = std::process::id();
    let processes = process_snapshots()?;
    let Some((candidate, score)) = processes
        .iter()
        .filter(|process| process.pid != current_pid)
        .map(|process| (process, matching_process_score(process, &tokens)))
        .filter(|(_, score)| *score > 0)
        .max_by_key(|(_, score)| *score)
    else {
        return Err(format!(
            "No running MCP process matched '{server_name}' ({})",
            tokens.join(", ")
        ));
    };

    if tokens.len() > 1 && score < 2 {
        return Err(format!(
            "Found only a weak process match for '{server_name}'. Refusing to kill PID {}.",
            candidate.pid
        ));
    }

    let mut pids = descendant_pids(&processes, candidate.pid);
    pids.push(candidate.pid);
    pids.sort_unstable();
    pids.dedup();
    for pid in pids.into_iter().rev() {
        kill_pid(pid)?;
    }
    Ok(())
}

pub fn launch_mcp_server_process(command: &str, args: &[String]) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let lower = command.to_ascii_lowercase();
        if matches!(lower.as_str(), "npx" | "npm" | "pnpm" | "yarn") {
            let cmd = format!("{command}.cmd");
            std::process::Command::new(cmd)
                .args(args)
                .spawn()
                .map_err(|e| format!("launch MCP server {command}: {e}"))?;
            return Ok(());
        }
    }

    std::process::Command::new(command)
        .args(args)
        .spawn()
        .map_err(|e| format!("launch MCP server {command}: {e}"))?;
    Ok(())
}
