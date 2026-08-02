const isTauriRuntime = () =>
  typeof window !== 'undefined' && Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);

export class AutostartService {
  async isEnabled(): Promise<boolean> {
    if (!isTauriRuntime()) return false;
    const { isEnabled } = await import('@tauri-apps/plugin-autostart');
    return await isEnabled();
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (!isTauriRuntime()) return;
    const { enable, disable } = await import('@tauri-apps/plugin-autostart');
    if (enabled) {
      await enable();
    } else {
      await disable();
    }
  }
}
