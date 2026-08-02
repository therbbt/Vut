import { writable } from 'svelte/store';
import { listen, emit } from '@tauri-apps/api/event';
import { ConfigService } from '../services/configService';
import { applyPalette, getPalette } from '../theme/palettes';
import type { VutCommand, VutSettings } from '../types';

// Each Tauri window is its own webview with its own JS heap, so a Settings
// window edit doesn't just show up in the main search window's store for
// free. CONFIG_CHANGED_EVENT is emitted (globally, reaching every window)
// after every write in this module, and every window that imports this
// store listens for it and reloads from the single Rust-owned config file -
// see startConfigSync() below.
const CONFIG_CHANGED_EVENT = 'vut://config-changed';

export const configService = new ConfigService();

export const commands = writable<VutCommand[]>([]);
export const settings = writable<VutSettings>({
  hotkey: 'Alt+Space',
  theme: 'dark',
  lightPaletteId: 'vut-light',
  darkPaletteId: 'vut-dark',
  autostart: false,
  defaultSearchCommandId: null,
});

let currentSettings: VutSettings | null = null;
settings.subscribe((s) => (currentSettings = s));

export const applyActivePalette = (): void => {
  if (!currentSettings) return;
  const id = currentSettings.theme === 'light' ? currentSettings.lightPaletteId : currentSettings.darkPaletteId;
  document.documentElement.dataset.theme = currentSettings.theme;
  applyPalette(getPalette(id));
};

export const loadConfig = async (): Promise<void> => {
  const config = await configService.load();
  commands.set(config.commands);
  settings.set(config.settings);
  applyActivePalette();
};

export const saveCommands = async (next: VutCommand[]): Promise<void> => {
  commands.set(next);
  await configService.saveCommands(next);
  await emit(CONFIG_CHANGED_EVENT);
};

export const saveSettings = async (partial: Partial<VutSettings>): Promise<void> => {
  settings.update((s) => ({ ...s, ...partial }));
  await configService.saveSettings(partial);
  applyActivePalette();
  await emit(CONFIG_CHANGED_EVENT);
};

// Called once per window on startup, after the first loadConfig(). Skips
// reacting to a window's own writes (it already applied them locally above)
// by simply re-loading unconditionally - loadConfig is cheap (one IPC round
// trip) and idempotent, so a redundant reload from your own emit is
// harmless.
export const startConfigSync = async (): Promise<() => void> => {
  const unlisten = await listen(CONFIG_CHANGED_EVENT, () => {
    void loadConfig();
  });
  return unlisten;
};
