use crate::config::CommandSpec;
use serde::Serialize;
use std::collections::HashMap;
use tauri::{command, AppHandle};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_shell::ShellExt;

/// Opens a fixed URL, a resolved search URL, or a URI scheme (e.g.
/// `spotify:`) with the OS's default handler, or with `browser` if given
/// (the `open_url`/`search` action types' optional per-command browser
/// override - an executable name like "firefox" or "google-chrome-stable",
/// passed straight through to the `open` crate's `with_detached`, which
/// execs it as `<browser> <target>` on Linux/Windows and `open -a <browser>
/// <target>` on macOS).
///
/// Called via a Rust command rather than the opener plugin's JS binding
/// directly: the JS binding is gated by the `opener:allow-open-url`
/// capability, which requires a static list of allowed URL patterns. Every
/// target here comes from the user's own config (entirely user-authored,
/// like an AutoHotKey script), so it can be any scheme the user configured -
/// a fixed allowlist would defeat the point of a keyword launcher.
#[command]
pub fn open_target(app: AppHandle, target: String, browser: Option<String>) -> Result<(), String> {
    app.opener().open_url(target, browser).map_err(|e| e.to_string())
}

/// Spawns an explicit executable (the `launch_app` "command" sub-form),
/// picking the platform-specific override if one is set for the current OS.
/// Runs entirely in Rust (via the shell plugin's native `Command` builder,
/// not its JS binding) for the same reason as `open_target` above - the
/// executable path is user-configured, not something a static
/// `shell:allow-execute` scope entry could name in advance.
#[command]
pub fn launch_app_command(
    app: AppHandle,
    default: CommandSpec,
    windows: Option<CommandSpec>,
    macos: Option<CommandSpec>,
    linux: Option<CommandSpec>,
) -> Result<(), String> {
    let spec = if cfg!(target_os = "windows") {
        windows.unwrap_or(default)
    } else if cfg!(target_os = "macos") {
        macos.unwrap_or(default)
    } else {
        linux.unwrap_or(default)
    };

    if spec.command.trim().is_empty() {
        return Err("No command configured for this platform".into());
    }

    app.shell()
        .command(&spec.command)
        .args(&spec.args)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct PluginHttpResponse {
    status: u16,
    body: String,
    headers: HashMap<String, String>,
}

/// Proxies a plugin's HTTP request through a native client instead of the
/// webview's fetch(). The target is whatever URL that plugin's own config
/// (or the user) points it at - a real server can (and TimePad's did) allow
/// only specific origins via CORS, which a browser enforces against the
/// webview's fetch() but a native client is never subject to at all. The
/// frontend never calls this directly; loadPluginModule (see
/// pluginService.ts) transparently shadows `fetch` inside every loaded
/// plugin module with a shim that calls this instead, so plugin authors
/// just write normal fetch() calls.
#[command]
pub async fn plugin_http_fetch(
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<PluginHttpResponse, String> {
    let client = reqwest::Client::new();
    let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
    let mut request = client.request(method, &url);
    for (key, value) in headers {
        request = request.header(key, value);
    }
    if let Some(body) = body {
        request = request.body(body);
    }

    let response = request.send().await.map_err(|e| e.to_string())?;
    let status = response.status().as_u16();
    let response_headers = response
        .headers()
        .iter()
        .filter_map(|(name, value)| value.to_str().ok().map(|v| (name.to_string(), v.to_string())))
        .collect();
    let body = response.text().await.map_err(|e| e.to_string())?;

    Ok(PluginHttpResponse { status, body, headers: response_headers })
}
