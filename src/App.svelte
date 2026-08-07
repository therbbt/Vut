<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { commands, settings, loadConfig, startConfigSync, saveCommands, saveSettings } from './lib/stores/configStore';
  import { loadPlugins, plugins, ensureDefaultCommands, applyConfigPatch, checkActiveStatus } from './lib/plugins/pluginStore';
  import type { PluginStatus } from './lib/plugins/types';
  import { matchCommands, describeAction, type MatchResult } from './lib/parser';
  import { runAction } from './lib/services/actionService';
  import type { VutSettings, VutCommand } from './lib/types';

  let query = '';
  let selectedIndex = 0;
  let inputEl: HTMLInputElement | undefined;
  let shellEl: HTMLDivElement | undefined;
  let running = false;
  let feedback: { ok: boolean; message: string } | null = null;

  // A plugin's live status (e.g. "timer running since…"), ticking in the
  // corner of the search bar - independent of query/results entirely, see
  // checkActiveStatus. nowTick just forces the elapsed-time label to
  // recompute every second; the actual status is only re-fetched from the
  // plugin on focus/after an action/periodically (see onMount below).
  let activeStatus: PluginStatus | null = null;
  let nowTick = Date.now();
  $: elapsedMs = activeStatus ? nowTick - new Date(activeStatus.since).getTime() : 0;

  const formatElapsed = (ms: number): string => {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const pad = (n: number) => String(n).padStart(2, '0');
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  };

  const refreshActiveStatus = async () => {
    activeStatus = await checkActiveStatus($commands);
  };

  $: baseResults = matchCommands(query, $commands);
  // A keyword that matches nothing still isn't a dead end: falls back to
  // running the configured default-search command against the whole typed
  // input, same as if the user had typed its keyword directly.
  $: results = withFallback(baseResults, query, $settings, $commands);

  const withFallback = (base: MatchResult[], q: string, s: VutSettings, all: VutCommand[]): MatchResult[] => {
    if (base.length > 0 || q.trim().length === 0) return base;
    const fallback = s.defaultSearchCommandId ? all.find((c) => c.id === s.defaultSearchCommandId) : undefined;
    return fallback ? [{ command: fallback, query: q, exact: true }] : [];
  };

  // Whatever the list becomes after a keystroke, the top result is always
  // the one Enter runs unless the user has explicitly moved the selection.
  $: {
    query;
    selectedIndex = 0;
  }

  // Feedback is deliberately NOT cleared by the reactive block above - a
  // keepOpen action clears `query` itself to reset the input for the next
  // command while leaving the just-shown message up, and query is also the
  // dependency that block reacts to, so clearing feedback there would wipe
  // it the instant it was set. Cleared here instead, at every point the
  // user themselves changes the query (typing, the CapsLock-safe insert
  // path, Tab-autocomplete) or a fresh summon starts a new session.
  const clearFeedback = () => (feedback = null);

  const iconLabel = (command: VutCommand): string => (command.icon?.trim() ? command.icon : command.title.charAt(0).toUpperCase() || '?');

  const runSelected = async () => {
    const result = results[selectedIndex];
    if (!result || running) return;
    running = true;
    feedback = null;
    try {
      const outcome = await runAction(result.command.action, result.query);
      if (!outcome.ok) {
        // Stays open on failure (same as a thrown error always has) - now
        // with a visible reason instead of only a console.error, since
        // "ran but the API call failed" needs to actually reach the user.
        feedback = { ok: false, message: outcome.message ?? 'Command failed.' };
        return;
      }
      if (outcome.configPatch) {
        const patched = applyConfigPatch(result.command, outcome.configPatch);
        await saveCommands($commands.map((c) => (c.id === patched.id ? patched : c)));
      }
      if (outcome.message) feedback = { ok: true, message: outcome.message };

      if (outcome.keepOpen) {
        // "Check on/steer an ongoing thing" actions (see PluginExecuteResult)
        // stay open - the user closes them with Escape or the summon hotkey,
        // not by the window vanishing the instant a command runs. Query
        // still resets so the next command can be typed right away.
        query = '';
        void refreshActiveStatus();
        return;
      }

      if (outcome.message) {
        // Give a real success message a moment to actually be read before
        // the window disappears - actions that don't return one (open_url,
        // launch_app, ...) close exactly as instantly as before.
        await new Promise((resolve) => setTimeout(resolve, 900));
      }
      query = '';
      await invoke('hide_window');
    } catch (err) {
      console.error('Vut: failed to run command', err);
      feedback = { ok: false, message: err instanceof Error ? err.message : 'Command failed.' };
    } finally {
      running = false;
    }
  };

  // Caps Lock is normally toggled ON as a side effect of triggering the
  // Caps+Space hotkey (see setup notes), so left unhandled every letter
  // typed right after summoning Vut would come out uppercase. Casing here
  // is derived only from Shift, ignoring whatever Caps Lock happens to be
  // doing - the query text should read the same regardless of Caps state.
  const insertAtCursor = (char: string) => {
    clearFeedback();
    if (!inputEl) {
      query += char;
      return;
    }
    const start = inputEl.selectionStart ?? query.length;
    const end = inputEl.selectionEnd ?? query.length;
    query = query.slice(0, start) + char + query.slice(end);
    void tick().then(() => {
      inputEl?.setSelectionRange(start + 1, start + 1);
    });
  };

  const onKeydown = (event: KeyboardEvent) => {
    if (/^[a-zA-Z]$/.test(event.key) && event.getModifierState('CapsLock')) {
      event.preventDefault();
      insertAtCursor(event.shiftKey ? event.key.toUpperCase() : event.key.toLowerCase());
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      query = '';
      void invoke('hide_window');
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (results.length) selectedIndex = Math.min(selectedIndex + 1, results.length - 1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (results.length) selectedIndex = Math.max(selectedIndex - 1, 0);
      return;
    }
    if (event.key === 'Tab') {
      const target = results[selectedIndex];
      if (target) {
        event.preventDefault();
        const firstToken = query.split(/\s/)[0] ?? '';
        if (target.command.keyword.toLowerCase() !== firstToken.toLowerCase()) {
          clearFeedback();
          query = `${target.command.keyword} `;
        }
      }
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      void runSelected();
    }
  };

  // Grows/shrinks the actual OS window to fit the results list as it
  // changes, rather than trusting a hardcoded height per row count - the
  // Rust side (see initial_main_window_height in main.rs) only needs to get
  // the size roughly right for the very first paint after a summon, since
  // this always corrects it a moment later against the real rendered size.
  const resizeToFit = async () => {
    await tick();
    const height = shellEl?.getBoundingClientRect().height;
    if (height) await invoke('resize_main_window', { height }).catch(() => {});
  };
  $: if (shellEl) {
    results;
    feedback;
    void resizeToFit();
  }

  onMount(() => {
    let unlistenFocus: (() => void) | undefined;
    let unlistenConfig: (() => void) | undefined;

    // Ticks the elapsed-time label every second; separate from how often
    // the status itself is actually re-fetched from the plugin (below).
    const tickInterval = setInterval(() => (nowTick = Date.now()), 1000);
    // Catches the timer having been stopped/started from somewhere other
    // than this window (TimePad's own UI, another device) while Vut
    // happens to be sitting open or hidden in the background.
    const statusInterval = setInterval(() => void refreshActiveStatus(), 30000);

    void (async () => {
      // Run together (both are IPC-heavy) rather than one after the other -
      // this all happens at app boot while the window is still hidden, well
      // before a hotkey summon could race a plugin command showing up in
      // results before its module has actually finished loading. Plugins
      // are disk-discovered, not part of config.json, so they're loaded
      // once here rather than through the config sync below - a newly
      // dropped-in plugin needs a restart to be picked up.
      await Promise.all([loadConfig(), loadPlugins()]);

      // A freshly-discovered plugin with defaultCommands gets its command(s)
      // added automatically - see ensureDefaultCommands for why this is
      // tracked in settings.seededPluginIds rather than "is a command using
      // this plugin currently present" (so deleting it afterward sticks).
      const seeding = ensureDefaultCommands($commands, $settings.seededPluginIds, $plugins);
      if (seeding) {
        await saveCommands(seeding.commands);
        await saveSettings({ seededPluginIds: seeding.seededPluginIds });
      }

      void refreshActiveStatus();
      unlistenConfig = await startConfigSync();

      const win = getCurrentWindow();
      unlistenFocus = await win.onFocusChanged(({ payload: focused }) => {
        if (focused) {
          query = '';
          selectedIndex = 0;
          clearFeedback();
          void refreshActiveStatus();
          requestAnimationFrame(() => inputEl?.focus());
        } else {
          void invoke('hide_window');
        }
      });
    })();

    return () => {
      unlistenFocus?.();
      unlistenConfig?.();
      clearInterval(tickInterval);
      clearInterval(statusInterval);
    };
  });
</script>

<svelte:head>
  <title>Vut</title>
</svelte:head>

<div class="shell" bind:this={shellEl}>
  <div class="input-row">
    <svg class="search-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
      <circle cx="6.8" cy="6.8" r="4.8" />
      <path d="M13.5 13.5L10.4 10.4" />
    </svg>
    <input
      bind:this={inputEl}
      bind:value={query}
      on:keydown={onKeydown}
      on:input={clearFeedback}
      class="input"
      type="text"
      placeholder="Type a keyword…"
      autocomplete="off"
      spellcheck="false"
    />
    {#if activeStatus}
      <span class="status-clock" title={activeStatus.label}>⏱ {formatElapsed(elapsedMs)}</span>
    {/if}
  </div>

  {#if feedback}
    <div class="feedback" class:error={!feedback.ok}>{feedback.message}</div>
  {/if}

  {#if results.length > 0}
    <div class="results" role="listbox">
      {#each results as result, index (result.command.id)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
          class="result-item"
          class:selected={index === selectedIndex}
          role="option"
          tabindex="-1"
          aria-selected={index === selectedIndex}
          on:mouseenter={() => (selectedIndex = index)}
          on:click={() => void runSelected()}
        >
          <span class="result-icon">{iconLabel(result.command)}</span>
          <span class="result-text">
            <span class="result-title">{result.command.title}</span>
            <span class="result-subtitle">{describeAction(result)}</span>
          </span>
          <span class="result-keyword">{result.command.keyword}</span>
        </div>
      {/each}
    </div>
  {:else if query.trim().length > 0}
    <div class="empty-state">No matching commands</div>
  {/if}
</div>

<style>
  :global(html[data-theme='light']) {
    color-scheme: light;
  }
  :global(html:not([data-theme='light'])) {
    color-scheme: dark;
  }

  .shell {
    display: flex;
    flex-direction: column;
    background: var(--panel);
    color: var(--text);
    border-radius: 0.85rem;
    border: 1px solid var(--border);
    box-shadow: 0 20px 48px rgba(0, 0, 0, 0.35);
    overflow: hidden;
  }

  .input-row {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 1.15rem 1.1rem;
    flex-shrink: 0;
  }

  .search-icon {
    flex-shrink: 0;
    color: var(--muted);
  }

  .input {
    flex: 1;
    border: 0;
    background: transparent;
    color: var(--text);
    font-size: 1.05rem;
    outline: none;
    min-width: 0;
  }

  .input::placeholder {
    color: var(--muted);
  }

  .status-clock {
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
    font-size: 0.8rem;
    color: var(--accent);
    background: var(--panel-2);
    border-radius: 0.4rem;
    padding: 0.25rem 0.5rem;
  }

  .results {
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--border);
    overflow-y: auto;
    padding: 0.35rem;
  }

  .result-item {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    padding: 0.5rem 0.6rem;
    border-radius: 0.55rem;
    cursor: pointer;
    min-height: 2.2rem;
  }

  .result-item.selected {
    background: var(--accent-soft);
  }

  .result-icon {
    flex-shrink: 0;
    width: 1.9rem;
    height: 1.9rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 0.5rem;
    background: var(--panel-2);
    color: var(--accent);
    font-size: 0.9rem;
    font-weight: 600;
  }

  .result-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }

  .result-title {
    font-size: 0.88rem;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .result-subtitle {
    font-size: 0.74rem;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .result-keyword {
    flex-shrink: 0;
    font-size: 0.72rem;
    color: var(--muted);
    background: var(--panel-2);
    border-radius: 0.35rem;
    padding: 0.15rem 0.4rem;
  }

  .empty-state {
    padding: 0.9rem 1.1rem;
    border-top: 1px solid var(--border);
    color: var(--muted);
    font-size: 0.82rem;
  }

  .feedback {
    padding: 0.9rem 1.1rem;
    border-top: 1px solid var(--border);
    color: var(--accent);
    font-size: 0.82rem;
  }

  .feedback.error {
    color: #ef4444;
  }
</style>
