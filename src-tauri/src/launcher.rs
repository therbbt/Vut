use crate::config::CommandSpec;
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
