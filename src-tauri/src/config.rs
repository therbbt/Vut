use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const CONFIG_FILE: &str = "config.json";

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CommandSpec {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
}

// Mirrors src/lib/types.ts's CommandAction discriminated union exactly, so
// the JSON on disk is the same shape the frontend already works with - a
// user hand-editing config.json sees the same field names the Settings UI
// would have written. `type` distinguishes the three action kinds;
// `launch_app` carries a second-level `kind` tag (uri vs command) via the
// nested LaunchAppAction enum, matching the nested `{ type: 'launch_app',
// kind: ... }` shape on the TS side.
// `rename_all` on an enum only cases the tag/variant names (the `type`
// value here) - it does NOT cascade into each struct variant's own fields,
// so `url_template` needs its own `rename_all` on that variant to come out
// as `urlTemplate` on the wire (learned the hard way: this shipped as
// `url_template`, which silently produced `undefined` when the frontend
// read `action.urlTemplate`).
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum CommandAction {
    #[serde(rename = "open_url")]
    OpenUrl {
        url: String,
        /// Executable name (e.g. "firefox", "google-chrome-stable") to open
        /// this URL with, bypassing the OS default browser. `None` (or
        /// missing on older config.json files) keeps using the OS default.
        #[serde(default)]
        browser: Option<String>,
    },
    #[serde(rename = "search", rename_all = "camelCase")]
    Search {
        url_template: String,
        #[serde(default)]
        browser: Option<String>,
    },
    #[serde(rename = "launch_app")]
    LaunchApp(LaunchAppAction),
    /// Opens Vut's own Settings window. A real command like any other -
    /// editable/renamable/deletable in the Commands manager - rather than a
    /// hardcoded frontend-only entry, so it needs no fields of its own: the
    /// `type` tag alone is enough for the frontend to know to call
    /// `show_settings` instead of the usual open_target/launch_app path.
    #[serde(rename = "open_settings")]
    OpenSettings,
    /// A plugin-defined action (see src-tauri/src/plugins.rs). One variant
    /// covers every plugin - `plugin_id` plus the frontend's runtime plugin
    /// registry is what differentiates behavior, so adding a second or
    /// third plugin never needs a new variant here. `fields` are the
    /// per-command values for whatever `configSchema` that plugin's
    /// manifest.json declares (e.g. a base URL and a token).
    #[serde(rename = "plugin", rename_all = "camelCase")]
    Plugin {
        plugin_id: String,
        #[serde(default)]
        fields: std::collections::HashMap<String, String>,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LaunchAppAction {
    #[serde(rename = "uri")]
    Uri { uri: String },
    #[serde(rename = "command")]
    Command {
        default: CommandSpec,
        #[serde(default)]
        windows: Option<CommandSpec>,
        #[serde(default)]
        macos: Option<CommandSpec>,
        #[serde(default)]
        linux: Option<CommandSpec>,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VutCommand {
    pub id: String,
    pub keyword: String,
    pub title: String,
    #[serde(default)]
    pub icon: Option<String>,
    pub action: CommandAction,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VutSettings {
    pub hotkey: String,
    pub theme: String,
    pub light_palette_id: String,
    pub dark_palette_id: String,
    pub autostart: bool,
    #[serde(default)]
    pub default_search_command_id: Option<String>,
    /// Plugin ids whose defaultCommands have already been seeded once (see
    /// ensureDefaultCommands in src/lib/plugins/pluginStore.ts) - checked
    /// instead of "does a command using this plugin currently exist" so
    /// deleting the auto-added command sticks, rather than it reappearing
    /// on every launch.
    #[serde(default)]
    pub seeded_plugin_ids: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct VutConfig {
    pub commands: Vec<VutCommand>,
    pub settings: VutSettings,
}

fn open_url(id: &str, keyword: &str, title: &str, url: &str) -> VutCommand {
    VutCommand {
        id: id.to_string(),
        keyword: keyword.to_string(),
        title: title.to_string(),
        icon: None,
        action: CommandAction::OpenUrl { url: url.to_string(), browser: None },
    }
}

fn settings_command() -> VutCommand {
    VutCommand {
        id: "settings".to_string(),
        keyword: "settings".to_string(),
        title: "Settings".to_string(),
        // A Lucide icon, not the "⚙️" emoji this shipped with originally -
        // emoji glyphs render in their own fixed color regardless of the
        // `color`/currentColor CSS applied to them, so it stood out instead
        // of picking up the palette's accent color like every other icon
        // (Lucide or the plain-letter fallback) already does.
        icon: Some("lucide:Settings".to_string()),
        action: CommandAction::OpenSettings,
    }
}

// Ships as the fresh-install config so a new user immediately sees all
// three action types working: a fixed URL, a {query} search template, and a
// URI-scheme app launch.
pub fn default_config() -> VutConfig {
    VutConfig {
        commands: vec![
            open_url("example-yt", "yt", "YouTube", "https://youtube.com"),
            VutCommand {
                id: "example-g".to_string(),
                keyword: "g".to_string(),
                title: "Google Search".to_string(),
                icon: None,
                action: CommandAction::Search {
                    url_template: "https://www.google.com/search?q={query}".to_string(),
                    browser: None,
                },
            },
            VutCommand {
                id: "example-spotify".to_string(),
                keyword: "spotify".to_string(),
                title: "Spotify".to_string(),
                icon: None,
                action: CommandAction::LaunchApp(LaunchAppAction::Uri {
                    uri: "spotify:".to_string(),
                }),
            },
            settings_command(),
        ],
        settings: VutSettings {
            hotkey: crate::DEFAULT_HOTKEY.to_string(),
            theme: "dark".to_string(),
            light_palette_id: "vut-light".to_string(),
            dark_palette_id: "vut-dark".to_string(),
            autostart: false,
            default_search_command_id: Some("example-g".to_string()),
            seeded_plugin_ids: Vec::new(),
        },
    }
}

pub fn config_file_path(data_dir: &Path) -> PathBuf {
    data_dir.join(CONFIG_FILE)
}

/// Settings used to be a hardcoded frontend-only entry, never written to
/// config.json (see the frontend's now-removed builtins.ts). Configs saved
/// before it became a real command are missing it entirely - add it back
/// once, on load, rather than leaving those users unable to reach Settings
/// through search until they notice and add it themselves.
fn ensure_settings_command(config: &mut VutConfig) -> bool {
    if config.commands.iter().any(|c| matches!(c.action, CommandAction::OpenSettings)) {
        return false;
    }
    config.commands.push(settings_command());
    true
}

/// Reads config.json, seeding it with `default_config()` on first run or if
/// the existing file fails to parse (rather than refusing to start - a
/// hand-edited config.json with a typo shouldn't brick the launcher).
pub fn load(data_dir: &Path) -> VutConfig {
    let path = config_file_path(data_dir);
    match std::fs::read_to_string(&path) {
        Ok(raw) => match serde_json::from_str::<VutConfig>(&raw) {
            Ok(mut config) => {
                if ensure_settings_command(&mut config) {
                    let _ = save(data_dir, &config);
                }
                config
            }
            Err(err) => {
                eprintln!("[vut] failed to parse {}: {err} - falling back to defaults", path.display());
                let config = default_config();
                let _ = save(data_dir, &config);
                config
            }
        },
        Err(_) => {
            let config = default_config();
            let _ = save(data_dir, &config);
            config
        }
    }
}

pub fn save(data_dir: &Path, config: &VutConfig) -> Result<(), String> {
    std::fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    std::fs::write(config_file_path(data_dir), json).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_action_round_trips_camel_case() {
        let json = serde_json::to_string(&default_config()).unwrap();
        eprintln!("SERIALIZED: {json}");
        assert!(json.contains("\"urlTemplate\""), "expected camelCase urlTemplate in: {json}");

        let parsed: VutConfig = serde_json::from_str(&json).unwrap();
        let g = parsed.commands.iter().find(|c| c.keyword == "g").unwrap();
        match &g.action {
            CommandAction::Search { url_template, .. } => {
                assert_eq!(url_template, "https://www.google.com/search?q={query}");
            }
            other => panic!("expected Search action, got {other:?}"),
        }
    }

    #[test]
    fn ensure_settings_command_adds_it_once() {
        let mut config = VutConfig {
            commands: vec![open_url("example-yt", "yt", "YouTube", "https://youtube.com")],
            settings: default_config().settings,
        };

        assert!(ensure_settings_command(&mut config), "should add it when missing");
        assert_eq!(config.commands.len(), 2);
        assert!(config.commands.iter().any(|c| matches!(c.action, CommandAction::OpenSettings)));

        assert!(!ensure_settings_command(&mut config), "should be a no-op once present");
        assert_eq!(config.commands.len(), 2);
    }
}
