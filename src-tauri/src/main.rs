#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;
mod launcher;

use config::VutConfig;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{command, AppHandle, LogicalSize, Manager, Size, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_opener::OpenerExt;

const TRAY_ICON_BYTES: &[u8] = include_bytes!("../icons/tray-icon.png");

/// Fallback hotkey until the user picks one in Settings. CapsLock+Space
/// (the user's ideal binding) can't be registered here - CapsLock is a
/// toggle key, not a modifier, and Tauri's global-shortcut plugin (unlike
/// AutoHotKey's low-level keyboard hook) has no way to treat it as one. See
/// is_valid_hotkey() below, which rejects any combo without a real modifier.
pub const DEFAULT_HOTKEY: &str = "Alt+Space";

const MAIN_WINDOW_WIDTH: f64 = 640.0;
/// Height of just the input bar, with no results showing.
const MAIN_WINDOW_BASE_HEIGHT: f64 = 76.0;

const REAL_MODIFIERS: [&str; 10] = [
    "ctrl", "control", "alt", "option", "shift", "super", "cmd", "command", "meta", "win",
];

/// A valid global accelerator needs at least one real modifier plus a
/// non-modifier key. Kept in sync with the same check in
/// src/lib/services/hotkeyService.ts (defense in depth - the frontend
/// already blocks invalid combos in the Settings UI before they ever reach
/// this command).
fn is_valid_hotkey(accelerator: &str) -> bool {
    let parts: Vec<String> = accelerator
        .split('+')
        .map(|p| p.trim().to_lowercase())
        .filter(|p| !p.is_empty())
        .collect();
    if parts.len() < 2 {
        return false;
    }
    let (mods, key) = parts.split_at(parts.len() - 1);
    let key = &key[0];
    mods.iter().all(|p| REAL_MODIFIERS.contains(&p.as_str()))
        && !REAL_MODIFIERS.contains(&key.as_str())
        && key != "capslock"
}

struct HotkeyState(Mutex<String>);

/// Mirrors whichever hide/show state we last told the window to be in.
/// Deliberately NOT re-derived from `window.is_visible()` on each call - see
/// the identical pattern (and its rationale) in FlashPad, which this project
/// otherwise mirrors closely. Starts `false` to match `visible: false` in
/// tauri.conf.json.
static WINDOW_SHOWN: AtomicBool = AtomicBool::new(false);

fn hide_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
        // Drop back out of the taskbar while hidden - it should only occupy
        // a taskbar slot for the moment it's actually summoned, not linger
        // there while sitting hidden in the tray.
        let _ = window.set_skip_taskbar(true);
        WINDOW_SHOWN.store(false, Ordering::SeqCst);
    }
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        // Reset to the base (no-results) size and re-center before every
        // summon, regardless of whatever size it grew to - or window-state
        // restored at launch - last time it was open. Every summon resets
        // the query to empty (see the focus-gained handler in App.svelte),
        // which shows no results until the user types, so the base height
        // is always correct here without waiting on the frontend to measure.
        let _ = window.set_size(Size::Logical(LogicalSize {
            width: MAIN_WINDOW_WIDTH,
            height: MAIN_WINDOW_BASE_HEIGHT,
        }));
        let _ = window.center();
        // Give the summoned window a taskbar entry so it's visible/alt-tabbable
        // while open, even though tauri.conf.json sets skipTaskbar: true as
        // the default (hidden) state.
        let _ = window.set_skip_taskbar(false);
        let _ = window.show();
        let _ = window.set_focus();
        #[cfg(target_os = "linux")]
        request_window_activation(&window);
        WINDOW_SHOWN.store(true, Ordering::SeqCst);
    }
}

/// `window.set_focus()` (tao's `gtk_window_present_with_time(GDK_CURRENT_TIME)`
/// under the hood) is a "normal application" focus request, which KWin's
/// focus-stealing prevention is specifically designed to reject when it
/// didn't originate from whatever window currently has focus - exactly the
/// summon-over-another-app case this hotkey exists for (e.g. hitting
/// Alt+Space while FlashPad has focus: input keeps going to FlashPad
/// instead of jumping to Vut's search box). Sending our own EWMH
/// `_NET_ACTIVE_WINDOW` client message with source indication 2 ("pager"/
/// external tool, not "application") sidesteps that check entirely - the
/// same mechanism `wmctrl -a`/`xdotool windowactivate` use, and one KWin
/// (and GNOME/others) treat as an authoritative user-facing request rather
/// than a background app trying to steal focus.
#[cfg(target_os = "linux")]
fn request_window_activation(window: &tauri::WebviewWindow) {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use x11rb::connection::Connection;
    use x11rb::protocol::xproto::{ClientMessageEvent, ConnectionExt, EventMask};

    let Ok(handle) = window.window_handle() else { return };
    let RawWindowHandle::Xlib(xlib) = handle.as_raw() else { return };
    let xid = xlib.window as u32;

    let Ok((conn, screen_num)) = x11rb::connect(None) else { return };
    let root = conn.setup().roots[screen_num].root;

    let Ok(cookie) = conn.intern_atom(false, b"_NET_ACTIVE_WINDOW") else { return };
    let Ok(atom_reply) = cookie.reply() else { return };

    let event = ClientMessageEvent::new(32, xid, atom_reply.atom, [2u32, 0, 0, 0, 0]);
    let mask = EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY;
    let _ = conn.send_event(false, root, mask, event);
    let _ = conn.flush();
}

fn toggle_main_window(app: &AppHandle) {
    if WINDOW_SHOWN.load(Ordering::SeqCst) {
        hide_main_window(app);
    } else {
        show_main_window(app);
    }
}

#[command]
fn hide_window(app: AppHandle) {
    hide_main_window(&app);
}

/// Grows/shrinks the main window's height as the results list renders.
/// Width stays fixed; height is clamped to never shrink below the
/// no-results base size. Tauri's `set_size` keeps the top-left corner
/// anchored, so the input bar never visibly moves - only the window's
/// bottom edge does.
#[command]
fn resize_main_window(app: AppHandle, height: f64) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window
            .set_size(Size::Logical(LogicalSize {
                width: MAIN_WINDOW_WIDTH,
                height: height.max(MAIN_WINDOW_BASE_HEIGHT),
            }))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[command]
fn get_hotkey(state: State<HotkeyState>) -> String {
    state.0.lock().unwrap().clone()
}

#[command]
fn set_hotkey(app: AppHandle, state: State<HotkeyState>, hotkey: String) -> Result<(), String> {
    let trimmed = hotkey.trim();
    if !is_valid_hotkey(trimmed) {
        return Err(
            "Hotkey needs at least one modifier (Ctrl/Alt/Shift/Super) plus a key - CapsLock can't be used as a global-shortcut modifier."
                .into(),
        );
    }

    let mut current = state.0.lock().map_err(|e| e.to_string())?;
    let shortcuts = app.global_shortcut();

    let _ = shortcuts.unregister(current.as_str());
    if let Err(err) = shortcuts.register(trimmed) {
        // Best-effort: put the old one back so the app isn't left without a
        // working hotkey (e.g. the new combo is already claimed by the OS).
        let _ = shortcuts.register(current.as_str());
        return Err(err.to_string());
    }

    *current = trimmed.to_string();

    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let mut cfg = config::load(&data_dir);
    cfg.settings.hotkey = trimmed.to_string();
    config::save(&data_dir, &cfg)?;

    Ok(())
}

#[command]
fn load_config(app: AppHandle) -> Result<VutConfig, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(config::load(&data_dir))
}

#[command]
fn save_config(app: AppHandle, config: VutConfig) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    config::save(&data_dir, &config)
}

#[command]
fn config_file_path(app: AppHandle) -> Result<String, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(config::config_file_path(&data_dir).to_string_lossy().to_string())
}

#[command]
fn open_config_file(app: AppHandle) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = config::config_file_path(&data_dir);
    // Ensure the file actually exists before handing it to the OS - a
    // brand-new install with default_config() already written covers the
    // common case, but this guards a rare race where the dir was cleared.
    if !path.exists() {
        let cfg = config::load(&data_dir);
        config::save(&data_dir, &cfg)?;
    }
    app.opener()
        .open_path(path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}

/// Gets-or-creates the Settings window. Built at runtime rather than
/// declared in tauri.conf.json, since it's only ever needed once the user
/// asks for it (tray menu or the search bar) - not on every launch.
#[command]
fn show_settings(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("settings") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(&app, "settings", WebviewUrl::App("settings.html".into()))
        .title("Vut Settings")
        .inner_size(760.0, 580.0)
        .min_inner_size(600.0, 440.0)
        .resizable(true)
        .center()
        .build()
        .map_err(|e| e.to_string())?;
    let _ = window.show();
    let _ = window.set_focus();
    Ok(())
}

fn main() {
    // See FlashPad's identical fix for why GTK is forced onto XWayland here:
    // KWin only negotiates a custom (decorations: false) title bar over
    // X11's Motif WM hints, not natively over Wayland.
    #[cfg(target_os = "linux")]
    {
        std::env::set_var("GDK_BACKEND", "x11");
    }

    tauri::Builder::default()
        .plugin(
            // VISIBLE is excluded so a hidden main window never gets shown
            // just because that's how it happened to be left last run -
            // show_main_window() always resets size/position on summon
            // anyway, so a restored size/position from a previous session
            // is harmless (it's fully overwritten before ever being shown).
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        & !tauri_plugin_window_state::StateFlags::VISIBLE
                        & !tauri_plugin_window_state::StateFlags::DECORATIONS,
                )
                .build(),
        )
        // No launch-arg flag needed here (unlike a normal-startup app):
        // Vut starts hidden in the tray on every launch regardless of how
        // it was started, so there's nothing to distinguish.
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle_main_window(app);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            hide_window,
            resize_main_window,
            get_hotkey,
            set_hotkey,
            load_config,
            save_config,
            config_file_path,
            open_config_file,
            show_settings,
            launcher::open_target,
            launcher::launch_app_command,
        ])
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");

            let cfg = config::load(&data_dir);
            let initial_hotkey = if is_valid_hotkey(&cfg.settings.hotkey) {
                cfg.settings.hotkey.clone()
            } else {
                DEFAULT_HOTKEY.to_string()
            };
            app.global_shortcut()
                .register(initial_hotkey.as_str())
                .expect("failed to register initial hotkey");
            app.manage(HotkeyState(Mutex::new(initial_hotkey)));

            let open_item = MenuItem::with_id(app, "show", "Show Vut", true, None::<&str>)?;
            let settings_item = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&open_item, &settings_item, &quit_item])?;

            let tray_icon = Image::from_bytes(TRAY_ICON_BYTES).expect("failed to decode tray icon");

            TrayIconBuilder::new()
                .icon(tray_icon)
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => show_main_window(app),
                    "settings" => {
                        let _ = show_settings(app.clone());
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            // The main window is never actually closed for the lifetime of
            // the app - only hidden - so Vut always has at least one window
            // and the OS-level "quit when last window closes" behavior
            // never triggers just because Settings was closed.
            if let Some(window) = app.get_webview_window("main") {
                let app_handle = app.handle().clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        hide_main_window(&app_handle);
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
