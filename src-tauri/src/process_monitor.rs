// Lightweight running-process detection used by the MCP manager to decide
// whether to offer a restart prompt after a config change.

use crate::commands::mcp::McpHost;

#[cfg(target_os = "windows")]
mod windows_impl {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use std::path::PathBuf;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };

    pub fn running_process_names() -> Vec<String> {
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
                        out.push(name);
                    }
                    if Process32NextW(snap, &mut entry).is_err() {
                        break;
                    }
                }
            }
            let _ = windows::Win32::Foundation::CloseHandle(snap);
        }
        out
    }

    /// Resolve the full install path for a known GUI app under %LOCALAPPDATA%.
    /// Returns None if nothing is found at any candidate path.
    fn find_install_path(app: &str) -> Option<PathBuf> {
        let local = std::env::var("LOCALAPPDATA").ok()?;
        let base = PathBuf::from(&local);

        let candidates: &[&str] = match app.to_ascii_lowercase().as_str() {
            "claude" => &[
                // Electron installer (squirrel) puts it here
                r"AnthropicClaude\claude.exe",
                r"Programs\AnthropicClaude\claude.exe",
                r"AnthropicClaude\Claude.exe",
                r"Programs\AnthropicClaude\Claude.exe",
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
            let p = base.join(rel);
            if p.exists() {
                return Some(p);
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

    /// Kill all processes whose image name matches `name` (case-insensitive).
    /// We kill by the *resolved* exe filename to avoid accidentally killing
    /// a same-named CLI tool (e.g. claude.exe CLI vs Claude.exe desktop).
    pub fn kill_by_image(name: &str) -> Result<(), String> {
        // Use the resolved path's filename when available so we're precise.
        let image = find_install_path(name)
            .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
            .unwrap_or_else(|| format!("{}.exe", name));

        let status = std::process::Command::new("taskkill")
            .args(["/IM", &image, "/F"])
            .status()
            .map_err(|e| format!("taskkill: {e}"))?;
        // taskkill returns non-zero if no matching process was found; that's fine.
        let _ = status;
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

        // Fallback: let Windows find it via App Paths / PATH.
        // Pass the display name without .exe so ShellExecute resolves it —
        // this is safer than appending .exe which could match CLI tools.
        let exe = format!("{}.exe", name);
        eprintln!(
            "[process_monitor] install path not found for '{}'; falling back to cmd start '{}'",
            name, exe
        );
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &exe])
            .spawn()
            .map_err(|e| format!("launch {exe}: {e}"))?;
        Ok(())
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

    pub fn launch_store_app(_aumid: &str) -> Result<(), String> {
        launch_app_named("codex")
    }

    pub fn kill_store_app(_image: &str) -> Result<(), String> {
        kill_by_image("codex")
    }
}

#[cfg(target_os = "windows")]
use windows_impl as platform;
#[cfg(target_os = "macos")]
use macos_impl as platform;
#[cfg(target_os = "linux")]
use linux_impl as platform;

pub fn running_process_names() -> Vec<String> {
    platform::running_process_names()
}

pub fn running_hosts() -> Vec<McpHost> {
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

pub fn kill_host(host: McpHost) -> Result<(), String> {
    for name in host.process_names_public() {
        let _ = platform::kill_by_image(name);
    }
    Ok(())
}

pub fn launch_app_named(name: &str) -> Result<(), String> {
    platform::launch_app_named(name)
}

pub fn launch_store_app(aumid: &str) -> Result<(), String> {
    platform::launch_store_app(aumid)
}

pub fn kill_store_app(image: &str) -> Result<(), String> {
    platform::kill_store_app(image)
}
