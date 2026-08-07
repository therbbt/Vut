import { invoke } from '@tauri-apps/api/core';
import type { VutConfig, VutCommand, VutSettings } from '../types';

const isTauriRuntime = () =>
  typeof window !== 'undefined' && Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);

// Bootstrap values only used outside a Tauri runtime (browser preview) - the
// real defaults (including the example yt/g/spotify commands) are seeded by
// Rust on first run, see src-tauri/src/config.rs.
const FALLBACK_CONFIG: VutConfig = {
  commands: [],
  settings: {
    hotkey: 'Alt+Space',
    theme: 'dark',
    lightPaletteId: 'vut-light',
    darkPaletteId: 'vut-dark',
    autostart: false,
    defaultSearchCommandId: null,
    seededPluginIds: [],
  },
};

// Config (commands + settings) is persisted entirely by Rust as a single
// human-editable JSON file in the app data dir - see config.rs. Keeping the
// read/write path in Rust means the "open config file" escape hatch in
// Settings and the in-app editor can never race each other or disagree on
// where the file lives.
export class ConfigService {
  private cached: VutConfig | null = null;

  async load(): Promise<VutConfig> {
    if (!isTauriRuntime()) return FALLBACK_CONFIG;
    this.cached = await invoke<VutConfig>('load_config');
    return this.cached;
  }

  getCached(): VutConfig {
    return this.cached ?? FALLBACK_CONFIG;
  }

  async saveCommands(commands: VutCommand[]): Promise<void> {
    if (!isTauriRuntime()) return;
    const current = this.cached ?? (await this.load());
    this.cached = { ...current, commands };
    await invoke('save_config', { config: this.cached });
  }

  async saveSettings(settings: Partial<VutSettings>): Promise<void> {
    if (!isTauriRuntime()) return;
    const current = this.cached ?? (await this.load());
    this.cached = { ...current, settings: { ...current.settings, ...settings } };
    await invoke('save_config', { config: this.cached });
  }

  async configFilePath(): Promise<string> {
    if (!isTauriRuntime()) return '';
    return await invoke<string>('config_file_path');
  }

  async openConfigFile(): Promise<void> {
    if (!isTauriRuntime()) return;
    await invoke('open_config_file');
  }
}
