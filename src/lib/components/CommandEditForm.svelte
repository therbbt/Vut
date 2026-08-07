<script lang="ts" context="module">
  import type { CommandAction, CommandSpec, VutCommand } from '../types';

  // Flattens the nested `{ type, kind }` union into one selector value for
  // the form's radio group - simpler to bind a <select> to than a 2-level
  // discriminated union. A plugin action is `plugin:<id>` so every loaded
  // plugin gets its own selectable option without extending this type.
  export type ActionKind = 'open_url' | 'search' | 'launch_uri' | 'launch_command' | 'open_settings' | `plugin:${string}`;

  export const actionKindOf = (action: CommandAction): ActionKind => {
    if (action.type === 'open_url') return 'open_url';
    if (action.type === 'search') return 'search';
    if (action.type === 'open_settings') return 'open_settings';
    if (action.type === 'plugin') return `plugin:${action.pluginId}`;
    return action.kind === 'uri' ? 'launch_uri' : 'launch_command';
  };
</script>

<script lang="ts">
  import { emptyCommandSpec, newCommandId } from '../types';
  import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
  import Dropdown from './Dropdown.svelte';
  import IconPicker from './IconPicker.svelte';
  import { plugins } from '../plugins/pluginStore';

  // undefined = nothing selected (placeholder); null = creating a new
  // command (blank form); a VutCommand = editing that existing command.
  export let command: VutCommand | null | undefined = undefined;
  export let onSave: (command: VutCommand) => void;
  export let onCancel: () => void;

  let keyword = '';
  let title = '';
  let icon = '';
  let kind: ActionKind = 'open_url';
  let openUrl = '';
  let searchTemplate = '';
  let browser = '';
  let launchUri = '';
  let pluginFields: Record<string, string> = {};
  let defaultSpec: CommandSpec = emptyCommandSpec();
  let windowsSpec: CommandSpec | null = null;
  let macosSpec: CommandSpec | null = null;
  let linuxSpec: CommandSpec | null = null;
  let editingId = '';
  let error = '';

  const specArgsText = (spec: CommandSpec | null): string => spec?.args.join(' ') ?? '';

  const load = (c: VutCommand | null | undefined) => {
    editingId = c?.id ?? '';
    keyword = c?.keyword ?? '';
    title = c?.title ?? '';
    icon = c?.icon ?? '';
    error = '';
    const action = c?.action;
    kind = action ? actionKindOf(action) : 'open_url';
    openUrl = action?.type === 'open_url' ? action.url : '';
    searchTemplate = action?.type === 'search' ? action.urlTemplate : 'https://www.google.com/search?q={query}';
    browser = (action?.type === 'open_url' || action?.type === 'search') && action.browser ? action.browser : '';
    launchUri = action?.type === 'launch_app' && action.kind === 'uri' ? action.uri : '';
    pluginFields = action?.type === 'plugin' ? { ...action.fields } : {};
    if (action?.type === 'launch_app' && action.kind === 'command') {
      defaultSpec = action.default;
      windowsSpec = action.windows;
      macosSpec = action.macos;
      linuxSpec = action.linux;
    } else {
      defaultSpec = emptyCommandSpec();
      windowsSpec = null;
      macosSpec = null;
      linuxSpec = null;
    }
  };

  $: load(command);
  $: isNew = editingId === '';

  $: activePluginId = kind.startsWith('plugin:') ? kind.slice('plugin:'.length) : null;
  $: activePluginManifest = activePluginId ? ($plugins.find((p) => p.id === activePluginId) ?? null) : null;
  $: actionOptions = [
    { value: 'open_url', label: 'Open a fixed URL' },
    { value: 'search', label: 'Search (URL template with {query})' },
    { value: 'launch_uri', label: 'Launch app via URI scheme' },
    { value: 'launch_command', label: 'Launch app via executable' },
    { value: 'open_settings', label: 'Open Vut Settings' },
    ...$plugins.map((p) => ({ value: `plugin:${p.id}`, label: p.name })),
  ];

  const toSpec = (commandText: string, argsText: string): CommandSpec => ({
    command: commandText.trim(),
    args: argsText.split(/\s+/).filter(Boolean),
  });

  let defaultArgsText = '';
  let windowsCommandText = '';
  let windowsArgsText = '';
  let macosCommandText = '';
  let macosArgsText = '';
  let linuxCommandText = '';
  let linuxArgsText = '';
  $: defaultArgsText = specArgsText(defaultSpec);
  $: windowsCommandText = windowsSpec?.command ?? '';
  $: windowsArgsText = specArgsText(windowsSpec);
  $: macosCommandText = macosSpec?.command ?? '';
  $: macosArgsText = specArgsText(macosSpec);
  $: linuxCommandText = linuxSpec?.command ?? '';
  $: linuxArgsText = specArgsText(linuxSpec);

  const browseForExecutable = async () => {
    const path = await openFileDialog({ multiple: false, directory: false });
    if (typeof path === 'string') defaultSpec = { ...defaultSpec, command: path };
  };

  const browseForBrowser = async () => {
    const path = await openFileDialog({ multiple: false, directory: false });
    if (typeof path === 'string') browser = path;
  };

  const save = () => {
    const trimmedKeyword = keyword.trim();
    const trimmedTitle = title.trim();
    if (!trimmedKeyword || !trimmedTitle) {
      error = 'Keyword and title are required.';
      return;
    }
    if (/\s/.test(trimmedKeyword)) {
      error = 'Keyword can’t contain spaces.';
      return;
    }

    let action: CommandAction;
    if (kind === 'open_url') {
      if (!openUrl.trim()) {
        error = 'URL is required.';
        return;
      }
      action = { type: 'open_url', url: openUrl.trim(), browser: browser.trim() || null };
    } else if (kind === 'search') {
      if (!searchTemplate.includes('{query}')) {
        error = 'Search URL must contain {query}.';
        return;
      }
      action = { type: 'search', urlTemplate: searchTemplate.trim(), browser: browser.trim() || null };
    } else if (kind === 'launch_uri') {
      if (!launchUri.trim()) {
        error = 'URI is required.';
        return;
      }
      action = { type: 'launch_app', kind: 'uri', uri: launchUri.trim() };
    } else if (kind === 'open_settings') {
      action = { type: 'open_settings' };
    } else if (kind.startsWith('plugin:')) {
      if (!activePluginId || !activePluginManifest) {
        error = 'This plugin is not loaded.';
        return;
      }
      const missing = activePluginManifest.configSchema.find((f) => f.required && !pluginFields[f.key]?.trim());
      if (missing) {
        error = `${missing.label} is required.`;
        return;
      }
      action = { type: 'plugin', pluginId: activePluginId, fields: { ...pluginFields } };
    } else {
      const def = toSpec(defaultSpec.command, defaultArgsText);
      if (!def.command) {
        error = 'Default command is required.';
        return;
      }
      action = {
        type: 'launch_app',
        kind: 'command',
        default: def,
        windows: windowsCommandText.trim() ? toSpec(windowsCommandText, windowsArgsText) : null,
        macos: macosCommandText.trim() ? toSpec(macosCommandText, macosArgsText) : null,
        linux: linuxCommandText.trim() ? toSpec(linuxCommandText, linuxArgsText) : null,
      };
    }

    onSave({
      id: editingId || newCommandId(),
      keyword: trimmedKeyword,
      title: trimmedTitle,
      icon: icon.trim() || null,
      action,
    });
  };
</script>

{#if command === undefined}
  <div class="placeholder">Select a command to edit, or add a new one.</div>
{:else}
  <form class="form" on:submit|preventDefault={save}>
    <h3>{isNew ? 'New command' : 'Edit command'}</h3>

    <div class="row two">
      <label>
        <span>Keyword</span>
        <input bind:value={keyword} placeholder="yt" autocomplete="off" spellcheck="false" />
      </label>
      <label>
        <span>Icon (optional)</span>
        <div class="row-inline">
          <input bind:value={icon} placeholder="🔖 or leave blank" autocomplete="off" spellcheck="false" />
          <IconPicker value={icon} onChange={(e) => (icon = e)} />
        </div>
      </label>
    </div>

    <label>
      <span>Title</span>
      <input bind:value={title} placeholder="YouTube" autocomplete="off" />
    </label>

    <label>
      <span>Action</span>
      <Dropdown options={actionOptions} value={kind} onChange={(v) => (kind = v as ActionKind)} />
    </label>

    {#if kind === 'open_url'}
      <label>
        <span>URL</span>
        <input bind:value={openUrl} placeholder="https://youtube.com" autocomplete="off" />
      </label>
      <label>
        <span>Browser (optional)</span>
        <div class="row-inline">
          <input bind:value={browser} placeholder="firefox, google-chrome-stable… (leave blank for system default)" autocomplete="off" spellcheck="false" />
          <button type="button" class="btn ghost small" on:click={() => void browseForBrowser()}>Browse…</button>
        </div>
      </label>
    {:else if kind === 'search'}
      <label>
        <span>Search URL template</span>
        <input bind:value={searchTemplate} placeholder="https://www.google.com/search?q={'{query}'}" autocomplete="off" />
      </label>
      <p class="hint">Everything typed after the keyword is URL-encoded into <code>{'{query}'}</code>.</p>
      <label>
        <span>Browser (optional)</span>
        <div class="row-inline">
          <input bind:value={browser} placeholder="firefox, google-chrome-stable… (leave blank for system default)" autocomplete="off" spellcheck="false" />
          <button type="button" class="btn ghost small" on:click={() => void browseForBrowser()}>Browse…</button>
        </div>
      </label>
    {:else if kind === 'launch_uri'}
      <label>
        <span>URI</span>
        <input bind:value={launchUri} placeholder="spotify:" autocomplete="off" />
      </label>
      <p class="hint">Opened via the OS's registered handler for this scheme.</p>
    {:else if kind === 'open_settings'}
      <p class="hint">Opens this settings window. No additional configuration needed.</p>
    {:else if kind.startsWith('plugin:')}
      {#if activePluginManifest}
        {#if activePluginManifest.description}<p class="hint">{activePluginManifest.description}</p>{/if}
        {#each activePluginManifest.configSchema as field (field.key)}
          <label>
            <span>{field.label}</span>
            <input
              type={field.type === 'password' ? 'password' : 'text'}
              bind:value={pluginFields[field.key]}
              placeholder={field.placeholder ?? ''}
              autocomplete="off"
              spellcheck="false"
            />
          </label>
        {/each}
      {:else}
        <p class="error">This plugin isn't loaded (missing, or failed to load at startup).</p>
      {/if}
    {:else}
      <div class="row two">
        <label>
          <span>Default command</span>
          <input bind:value={defaultSpec.command} placeholder="/usr/bin/example" autocomplete="off" spellcheck="false" />
        </label>
        <label>
          <span>Args (space-separated)</span>
          <input bind:value={defaultArgsText} placeholder="--flag value" autocomplete="off" spellcheck="false" />
        </label>
      </div>
      <button type="button" class="btn ghost small" on:click={() => void browseForExecutable()}>Browse…</button>

      <p class="hint">Optional per-OS overrides (leave blank to use the default on that platform):</p>
      <div class="row three">
        <label>
          <span>Windows</span>
          <input bind:value={windowsCommandText} placeholder="command" autocomplete="off" spellcheck="false" />
          <input bind:value={windowsArgsText} placeholder="args" autocomplete="off" spellcheck="false" />
        </label>
        <label>
          <span>macOS</span>
          <input bind:value={macosCommandText} placeholder="command" autocomplete="off" spellcheck="false" />
          <input bind:value={macosArgsText} placeholder="args" autocomplete="off" spellcheck="false" />
        </label>
        <label>
          <span>Linux</span>
          <input bind:value={linuxCommandText} placeholder="command" autocomplete="off" spellcheck="false" />
          <input bind:value={linuxArgsText} placeholder="args" autocomplete="off" spellcheck="false" />
        </label>
      </div>
    {/if}

    {#if error}
      <p class="error">{error}</p>
    {/if}

    <div class="actions">
      <button type="button" class="btn ghost" on:click={onCancel}>Cancel</button>
      <button type="submit" class="btn primary">Save</button>
    </div>
  </form>
{/if}

<style>
  .placeholder {
    padding: 1.5rem;
    color: var(--muted);
    font-size: 0.85rem;
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1rem 1.25rem;
    min-height: 0;
    min-width: 0;
    overflow-y: auto;
  }

  .form h3 {
    margin: 0 0 0.25rem 0;
    font-size: 0.95rem;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.78rem;
    color: var(--muted);
  }

  .row {
    display: grid;
    gap: 0.6rem;
  }

  .row-inline {
    display: flex;
    gap: 0.5rem;
  }

  .row-inline input {
    flex: 1;
    min-width: 0;
  }

  .row.two {
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  }

  .row.three {
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  }

  input {
    min-width: 0;
    border: 1px solid var(--border);
    border-radius: 0.45rem;
    background: var(--panel-2);
    color: var(--text);
    padding: 0.45rem 0.55rem;
    font-size: 0.85rem;
  }

  input:focus {
    outline: 2px solid var(--accent-soft);
    outline-offset: 0;
  }

  .hint {
    margin: -0.3rem 0 0 0;
    font-size: 0.74rem;
    color: var(--muted);
  }

  .hint code {
    background: var(--panel-2);
    border-radius: 0.25rem;
    padding: 0.05rem 0.3rem;
  }

  .error {
    margin: 0;
    font-size: 0.78rem;
    color: #ef4444;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.5rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--border);
  }

  .btn {
    border: 1px solid var(--border);
    border-radius: 0.45rem;
    background: var(--panel-2);
    color: var(--text);
    font-size: 0.82rem;
    padding: 0.45rem 0.9rem;
  }

  .btn.small {
    padding: 0.3rem 0.6rem;
    font-size: 0.76rem;
    align-self: flex-start;
  }

  .btn.ghost {
    background: transparent;
  }

  .btn.ghost:hover {
    background: var(--panel-2);
  }

  .btn.primary {
    background: var(--accent-soft);
    font-weight: 600;
  }
</style>
