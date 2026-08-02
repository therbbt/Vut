import { invoke } from '@tauri-apps/api/core';

const isTauriRuntime = () =>
  typeof window !== 'undefined' && Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);

export const DEFAULT_HOTKEY = 'Alt+Space';

const REAL_MODIFIERS = ['ctrl', 'control', 'alt', 'option', 'shift', 'super', 'cmd', 'command', 'meta', 'win'];

/**
 * CapsLock is a toggle key, not a modifier - the OS never reports it as
 * "held down" the way Ctrl/Alt/Shift/Super are, so the global-shortcut
 * plugin's accelerator parser (which AutoHotKey's low-level keyboard hook
 * can bypass, but Tauri's plugin cannot) has no way to register it. A combo
 * needs at least one real modifier plus a non-modifier key to be a valid
 * global accelerator.
 */
export const isValidHotkey = (accelerator: string): boolean => {
  const parts = accelerator
    .split('+')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length < 2) return false;
  const hasModifier = parts.slice(0, -1).every((p) => REAL_MODIFIERS.includes(p));
  const key = parts[parts.length - 1];
  return hasModifier && key.length > 0 && !REAL_MODIFIERS.includes(key) && key !== 'capslock';
};

// The global hotkey is registered and persisted entirely in Rust (see
// src-tauri/src/main.rs) so it works instantly even while the window is
// hidden, and is already active by the time the frontend loads.
export class HotkeyService {
  async get(): Promise<string> {
    if (!isTauriRuntime()) return DEFAULT_HOTKEY;
    return await invoke<string>('get_hotkey');
  }

  async set(hotkey: string): Promise<void> {
    if (!isTauriRuntime()) return;
    await invoke('set_hotkey', { hotkey });
  }
}
