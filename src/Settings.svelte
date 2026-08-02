<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { commands, settings, loadConfig, startConfigSync, saveCommands, saveSettings, configService } from './lib/stores/configStore';
  import { palettesForMode } from './lib/theme/palettes';
  import { HotkeyService, isValidHotkey } from './lib/services/hotkeyService';
  import { AutostartService } from './lib/services/autostartService';
  import CommandList from './lib/components/CommandList.svelte';
  import CommandEditForm from './lib/components/CommandEditForm.svelte';
  import type { VutCommand } from './lib/types';

  const hotkeyService = new HotkeyService();
  const autostartService = new AutostartService();

  let tab: 'general' | 'commands' = 'general';

  // The form's contents are derived purely from this mode flag plus the
  // live $commands store below - never stored as its own stateful copy -
  // so a save/delete elsewhere (or the cross-window config sync) is
  // instantly reflected without a separate sync step to keep in line.
  type FormMode = { kind: 'none' } | { kind: 'new' } | { kind: 'edit'; id: string };
  let formMode: FormMode = { kind: 'none' };

  const draftFor = (mode: FormMode, list: VutCommand[]): VutCommand | null | undefined => {
    if (mode.kind === 'none') return undefined;
    if (mode.kind === 'new') return null;
    return list.find((c) => c.id === mode.id);
  };

  $: selectedId = formMode.kind === 'edit' ? formMode.id : null;
  $: editingDraft = draftFor(formMode, $commands);

  let hotkeyRecording = false;
  let hotkeyError = '';
  let autostartEnabled = false;
  let configPath = '';
  let saveNotice = '';

  const selectCommand = (id: string) => {
    formMode = { kind: 'edit', id };
  };

  const addNew = () => {
    formMode = { kind: 'new' };
  };

  const cancelEdit = () => {
    formMode = { kind: 'none' };
  };

  const flashSaved = () => {
    saveNotice = 'Saved';
    setTimeout(() => (saveNotice = ''), 1500);
  };

  const onCommandSave = async (command: VutCommand) => {
    const exists = $commands.some((c) => c.id === command.id);
    const next = exists ? $commands.map((c) => (c.id === command.id ? command : c)) : [...$commands, command];
    await saveCommands(next);
    formMode = { kind: 'edit', id: command.id };
    flashSaved();
  };

  const onReorder = async (next: VutCommand[]) => {
    await saveCommands(next);
  };

  const onDelete = async (id: string) => {
    await saveCommands($commands.filter((c) => c.id !== id));
    if (formMode.kind === 'edit' && formMode.id === id) formMode = { kind: 'none' };
    if ($settings.defaultSearchCommandId === id) {
      await saveSettings({ defaultSearchCommandId: null });
    }
  };

  const searchCommands = () => $commands.filter((c) => c.action.type === 'search');

  // ---------- hotkey capture ----------

  const REAL_MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta', 'OS', 'AltGraph']);

  const normalizeKeyName = (key: string): string => {
    const map: Record<string, string> = {
      ' ': 'Space',
      ArrowUp: 'Up',
      ArrowDown: 'Down',
      ArrowLeft: 'Left',
      ArrowRight: 'Right',
    };
    if (map[key]) return map[key];
    return key.length === 1 ? key.toUpperCase() : key;
  };

  // If nothing arrives for a few seconds, the most likely explanation isn't
  // a bug in this capture code - it's that the desktop environment (KDE's
  // global shortcuts, GNOME's Activities key, etc.) already grabbed that
  // combo at the compositor level and never forwarded the keystroke to us
  // at all, so there's nothing here to catch or report an error for.
  const STUCK_HINT_DELAY_MS = 3000;
  let hotkeyStuckTimeoutId: ReturnType<typeof setTimeout> | undefined;
  let hotkeyHint = '';

  const startHotkeyCapture = () => {
    hotkeyRecording = true;
    hotkeyError = '';
    hotkeyHint = '';
    clearTimeout(hotkeyStuckTimeoutId);
    hotkeyStuckTimeoutId = setTimeout(() => {
      if (hotkeyRecording) {
        hotkeyHint =
          'Still waiting… if nothing happens when you press it, that combo is likely already claimed by a system shortcut (check your desktop’s keyboard shortcut settings) rather than a problem with Vut.';
      }
    }, STUCK_HINT_DELAY_MS);
  };

  onDestroy(() => clearTimeout(hotkeyStuckTimeoutId));

  const onHotkeyCaptureKeydown = async (event: KeyboardEvent) => {
    if (!hotkeyRecording) return;
    event.preventDefault();
    if (event.key === 'Escape') {
      hotkeyRecording = false;
      clearTimeout(hotkeyStuckTimeoutId);
      return;
    }
    if (REAL_MODIFIER_KEYS.has(event.key)) return;

    const parts: string[] = [];
    if (event.ctrlKey) parts.push('Ctrl');
    if (event.altKey) parts.push('Alt');
    if (event.shiftKey) parts.push('Shift');
    if (event.metaKey) parts.push('Super');
    parts.push(normalizeKeyName(event.key));
    const accelerator = parts.join('+');

    hotkeyRecording = false;
    hotkeyHint = '';
    clearTimeout(hotkeyStuckTimeoutId);
    if (!isValidHotkey(accelerator)) {
      hotkeyError = 'Choose a combo with at least one modifier (Ctrl/Alt/Shift/Super) plus a key. CapsLock can’t be used.';
      return;
    }
    try {
      await hotkeyService.set(accelerator);
      await saveSettings({ hotkey: accelerator });
      flashSaved();
    } catch (err) {
      hotkeyError = err instanceof Error ? err.message : String(err);
    }
  };

  // ---------- theme ----------

  const setMode = async (mode: 'light' | 'dark') => {
    await saveSettings({ theme: mode });
  };

  const setLightPalette = async (id: string) => {
    await saveSettings({ lightPaletteId: id });
  };

  const setDarkPalette = async (id: string) => {
    await saveSettings({ darkPaletteId: id });
  };

  // ---------- misc settings ----------

  const setAutostart = async (enabled: boolean) => {
    autostartEnabled = enabled;
    await autostartService.setEnabled(enabled);
    await saveSettings({ autostart: enabled });
  };

  const setDefaultSearch = async (id: string) => {
    await saveSettings({ defaultSearchCommandId: id || null });
  };

  const openConfigFile = () => void configService.openConfigFile();

  const quitApp = async () => {
    const { exit } = await import('@tauri-apps/plugin-process');
    await exit(0);
  };

  onMount(() => {
    let unlistenConfig: (() => void) | undefined;
    void (async () => {
      await loadConfig();
      unlistenConfig = await startConfigSync();
      autostartEnabled = await autostartService.isEnabled();
      configPath = await configService.configFilePath();
    })();
    return () => unlistenConfig?.();
  });
</script>

<svelte:head>
  <title>Vut Settings</title>
</svelte:head>

<svelte:window on:keydown={onHotkeyCaptureKeydown} />

<div class="shell">
  <nav class="tabs">
    <button class:active={tab === 'general'} on:click={() => (tab = 'general')}>General</button>
    <button class:active={tab === 'commands'} on:click={() => (tab = 'commands')}>Commands</button>
    {#if saveNotice}<span class="save-notice">{saveNotice}</span>{/if}
  </nav>

  {#if tab === 'general'}
    <div class="general">
      <section>
        <h3>Global hotkey</h3>
        <p class="hint">
          Summons Vut from anywhere. Needs at least one modifier (Ctrl/Alt/Shift/Super) plus a key - CapsLock can't be
          registered as a global modifier (it's a toggle key, not held-down like the others), so it isn't offered here.
        </p>
        <button class="hotkey-btn" class:recording={hotkeyRecording} type="button" on:click={startHotkeyCapture}>
          {hotkeyRecording ? 'Press a key combo… (Esc to cancel)' : $settings.hotkey}
        </button>
        {#if hotkeyError}<p class="error">{hotkeyError}</p>{/if}
        {#if hotkeyRecording && hotkeyHint}<p class="hint">{hotkeyHint}</p>{/if}
      </section>

      <section>
        <h3>Theme</h3>
        <div class="mode-toggle">
          <button class:active={$settings.theme === 'light'} type="button" on:click={() => void setMode('light')}>Light</button>
          <button class:active={$settings.theme === 'dark'} type="button" on:click={() => void setMode('dark')}>Dark</button>
        </div>
        <div class="row two">
          <label>
            <span>Light palette</span>
            <select value={$settings.lightPaletteId} on:change={(e) => void setLightPalette(e.currentTarget.value)}>
              {#each palettesForMode('light') as palette (palette.id)}
                <option value={palette.id}>{palette.name}</option>
              {/each}
            </select>
          </label>
          <label>
            <span>Dark palette</span>
            <select value={$settings.darkPaletteId} on:change={(e) => void setDarkPalette(e.currentTarget.value)}>
              {#each palettesForMode('dark') as palette (palette.id)}
                <option value={palette.id}>{palette.name}</option>
              {/each}
            </select>
          </label>
        </div>
      </section>

      <section>
        <h3>Startup</h3>
        <label class="checkbox">
          <input type="checkbox" checked={autostartEnabled} on:change={(e) => void setAutostart(e.currentTarget.checked)} />
          <span>Launch Vut automatically on login</span>
        </label>
      </section>

      <section>
        <h3>Default search</h3>
        <p class="hint">Used when nothing typed matches a keyword, so no input is ever a dead end.</p>
        <select value={$settings.defaultSearchCommandId ?? ''} on:change={(e) => void setDefaultSearch(e.currentTarget.value)}>
          <option value="">None</option>
          {#each searchCommands() as command (command.id)}
            <option value={command.id}>{command.title} ({command.keyword})</option>
          {/each}
        </select>
      </section>

      <section>
        <h3>Config file</h3>
        <p class="hint mono">{configPath}</p>
        <div class="actions-row">
          <button class="btn" type="button" on:click={openConfigFile}>Open config file</button>
          <button class="btn danger" type="button" on:click={() => void quitApp()}>Quit Vut</button>
        </div>
      </section>
    </div>
  {:else}
    <div class="commands">
      <CommandList
        commandList={$commands}
        {selectedId}
        onSelect={selectCommand}
        onAddNew={addNew}
        onReorder={onReorder}
        onDelete={onDelete}
      />
      <CommandEditForm command={editingDraft} onSave={onCommandSave} onCancel={cancelEdit} />
    </div>
  {/if}
</div>

<style>
  :global(html) {
    color-scheme: dark;
  }
  :global(html[data-theme='light']) {
    color-scheme: light;
  }
  :global(html:not([data-theme='light'])) {
    color-scheme: dark;
  }
  :global(body) {
    background: var(--bg);
  }

  .shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--bg);
    color: var(--text);
  }

  .tabs {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.6rem 1rem;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .tabs button {
    border: 0;
    background: transparent;
    color: var(--muted);
    padding: 0.4rem 0.8rem;
    border-radius: 0.4rem;
    font-size: 0.85rem;
  }

  .tabs button.active {
    background: var(--panel-2);
    color: var(--text);
    font-weight: 600;
  }

  .save-notice {
    margin-left: auto;
    font-size: 0.75rem;
    color: var(--accent);
  }

  .general {
    flex: 1;
    overflow-y: auto;
    padding: 1.25rem 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    max-width: 640px;
  }

  .general h3 {
    margin: 0 0 0.5rem 0;
    font-size: 0.9rem;
  }

  .hint {
    margin: 0 0 0.6rem 0;
    font-size: 0.78rem;
    color: var(--muted);
    line-height: 1.5;
  }

  .hint.mono {
    font-family: ui-monospace, monospace;
    word-break: break-all;
  }

  .hotkey-btn {
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--panel-2);
    color: var(--text);
    padding: 0.6rem 1rem;
    font-size: 0.9rem;
    min-width: 220px;
  }

  .hotkey-btn.recording {
    outline: 2px solid var(--accent-soft);
    color: var(--accent);
  }

  .error {
    color: #ef4444;
    font-size: 0.78rem;
    margin: 0.5rem 0 0 0;
  }

  .mode-toggle {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    overflow: hidden;
    margin-bottom: 0.75rem;
  }

  .mode-toggle button {
    border: 0;
    background: var(--panel-2);
    color: var(--muted);
    padding: 0.4rem 1rem;
    font-size: 0.82rem;
  }

  .mode-toggle button.active {
    background: var(--accent-soft);
    color: var(--text);
    font-weight: 600;
  }

  .row {
    display: grid;
    gap: 0.75rem;
  }

  .row.two {
    grid-template-columns: 1fr 1fr;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.78rem;
    color: var(--muted);
  }

  select {
    border: 1px solid var(--border);
    border-radius: 0.45rem;
    background: var(--panel-2);
    color: var(--text);
    padding: 0.45rem 0.55rem;
    font-size: 0.85rem;
  }

  .checkbox {
    flex-direction: row;
    align-items: center;
    gap: 0.5rem;
    color: var(--text);
    font-size: 0.85rem;
  }

  .actions-row {
    display: flex;
    gap: 0.6rem;
  }

  .btn {
    border: 1px solid var(--border);
    border-radius: 0.45rem;
    background: var(--panel-2);
    color: var(--text);
    font-size: 0.82rem;
    padding: 0.5rem 0.9rem;
  }

  .btn.danger:hover {
    background: #ef4444;
    color: #fff;
    border-color: #ef4444;
  }

  .commands {
    flex: 1;
    display: grid;
    grid-template-columns: 260px 1fr;
    min-height: 0;
  }
</style>
