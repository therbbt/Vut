use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

fn default_field_type() -> String {
    "text".to_string()
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PluginFieldSchema {
    pub key: String,
    pub label: String,
    #[serde(rename = "type", default = "default_field_type")]
    pub field_type: String,
    #[serde(default)]
    pub placeholder: Option<String>,
    #[serde(default)]
    pub required: bool,
}

fn default_module() -> String {
    "index.js".to_string()
}

/// A command Vut creates automatically the first time this plugin is
/// discovered (see ensureDefaultCommands in src/lib/plugins/pluginStore.ts)
/// - so installing a plugin gets you a working command immediately instead
/// of a manual "add command, pick this action type, fill in fields" trip
/// through Settings. `fields` seeds that command's plugin config (e.g. a
/// default baseUrl) same as configSchema would.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PluginDefaultCommand {
    pub keyword: String,
    pub title: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub fields: std::collections::HashMap<String, String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub config_schema: Vec<PluginFieldSchema>,
    /// Fields for an optional login form Settings > Plugins renders inline
    /// (see PluginModule.login() on the TS side) - empty means the plugin
    /// has no interactive login step.
    #[serde(default)]
    pub login_schema: Vec<PluginFieldSchema>,
    #[serde(default)]
    pub default_commands: Vec<PluginDefaultCommand>,
    #[serde(default = "default_module")]
    pub module: String,
}

pub fn plugins_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("plugins")
}

/// Repo-bundled plugins (see plugins/ at the repo root) live next to
/// src-tauri at compile time. CARGO_MANIFEST_DIR is a compile-time constant
/// pointing at src-tauri/, so this only resolves correctly for a dev build
/// run from a checkout on this machine - fine for now since Vut isn't
/// packaged for other machines yet. A redistributed bundle would need this
/// swapped for `app.path().resource_dir()` plus `bundle.resources` in
/// tauri.conf.json.
fn bundled_plugins_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../plugins")
}

/// Copies the repo's bundled plugins into the data dir once, the first time
/// Vut ever looks for plugins - same "seed once, user owns it after" shape
/// as config::load's first-run default_config() write. Only triggers when
/// the whole plugins/ directory is absent, so deleting one plugin
/// afterward doesn't resurrect it on the next scan.
fn seed_bundled_plugins(data_dir: &Path) {
    let dest = plugins_dir(data_dir);
    if dest.exists() {
        return;
    }
    let src = bundled_plugins_dir();
    let Ok(entries) = std::fs::read_dir(&src) else { return };

    for entry in entries.flatten() {
        let plugin_src = entry.path();
        if !plugin_src.is_dir() {
            continue;
        }
        let Some(name) = plugin_src.file_name() else { continue };
        let plugin_dest = dest.join(name);
        if let Err(err) = copy_dir(&plugin_src, &plugin_dest) {
            eprintln!("[vut] failed to seed bundled plugin {}: {err}", plugin_src.display());
        }
    }
}

fn copy_dir(src: &Path, dest: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dest)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let dest_path = dest.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &dest_path)?;
        } else {
            std::fs::copy(entry.path(), dest_path)?;
        }
    }
    Ok(())
}

/// Scans <data_dir>/plugins/*/manifest.json, seeding from the bundled
/// plugins first if the directory doesn't exist yet. A plugin folder with a
/// missing/invalid manifest is skipped and logged, not fatal - same
/// principle as config::load's fallback for a broken config.json: one bad
/// plugin must never take the whole launcher down.
pub fn list(data_dir: &Path) -> Vec<PluginManifest> {
    seed_bundled_plugins(data_dir);

    let dir = plugins_dir(data_dir);
    let Ok(entries) = std::fs::read_dir(&dir) else { return Vec::new() };

    let mut manifests = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let manifest_path = path.join("manifest.json");
        let raw = match std::fs::read_to_string(&manifest_path) {
            Ok(raw) => raw,
            Err(_) => continue,
        };
        match serde_json::from_str::<PluginManifest>(&raw) {
            Ok(manifest) => manifests.push(manifest),
            Err(err) => eprintln!("[vut] skipping plugin at {}: {err}", path.display()),
        }
    }
    manifests
}

/// Re-derives the module path from the plugin's own manifest rather than
/// trusting a client-supplied path, so `plugin_id` can only ever resolve to
/// a file inside that plugin's own folder.
pub fn read_module(data_dir: &Path, plugin_id: &str) -> Result<String, String> {
    let manifest = list(data_dir)
        .into_iter()
        .find(|m| m.id == plugin_id)
        .ok_or_else(|| format!("Unknown plugin: {plugin_id}"))?;
    let path = plugins_dir(data_dir).join(plugin_id).join(&manifest.module);
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDataDir(PathBuf);

    impl TempDataDir {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("vut-plugins-test-{name}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
    }

    impl Drop for TempDataDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// Exercises the real seed-from-bundled-plugins path end to end (not
    /// just parsing) - this is what actually catches a broken
    /// CARGO_MANIFEST_DIR-relative path to plugins/ at the repo root, or a
    /// malformed manifest.json, before either would only surface as an
    /// empty dropdown in the running app.
    #[test]
    fn list_seeds_and_finds_bundled_timepad_plugin() {
        let data_dir = TempDataDir::new("seed");
        let manifests = list(&data_dir.0);

        let timepad = manifests.iter().find(|m| m.id == "timepad").expect("timepad plugin should be discovered");
        assert_eq!(timepad.name, "TimePad");
        assert_eq!(timepad.module, "index.js");
        assert!(timepad.config_schema.iter().any(|f| f.key == "baseUrl"));
        assert!(timepad.config_schema.iter().any(|f| f.key == "token" && f.field_type == "password"));
        assert!(timepad.login_schema.iter().any(|f| f.key == "email"));
        assert!(timepad.login_schema.iter().any(|f| f.key == "password" && f.field_type == "password"));
        assert_eq!(timepad.default_commands.len(), 1);
        assert_eq!(timepad.default_commands[0].keyword, "tp");

        let module_src = read_module(&data_dir.0, "timepad").expect("timepad module should be readable");
        assert!(module_src.contains("export default"));
        assert!(module_src.contains("async login("));
    }

    #[test]
    fn list_skips_a_broken_manifest_without_panicking() {
        let data_dir = TempDataDir::new("broken");
        let broken_dir = plugins_dir(&data_dir.0).join("broken");
        std::fs::create_dir_all(&broken_dir).unwrap();
        std::fs::write(broken_dir.join("manifest.json"), "not json").unwrap();

        // plugins_dir already exists (we just created it), so seeding is
        // skipped and this only sees the one broken plugin folder.
        let manifests = list(&data_dir.0);
        assert!(manifests.is_empty());
    }
}
