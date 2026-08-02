<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { commands, settings, loadConfig, startConfigSync } from './lib/stores/configStore';
  import { matchCommands, describeAction, type MatchResult } from './lib/parser';
  import { runAction } from './lib/services/actionService';
  import type { VutSettings, VutCommand } from './lib/types';

  let query = '';
  let selectedIndex = 0;
  let inputEl: HTMLInputElement | undefined;
  let shellEl: HTMLDivElement | undefined;
  let running = false;

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

  const iconLabel = (command: VutCommand): string => (command.icon?.trim() ? command.icon : command.title.charAt(0).toUpperCase() || '?');

  const runSelected = async () => {
    const result = results[selectedIndex];
    if (!result || running) return;
    running = true;
    try {
      await runAction(result.command.action, result.query);
      query = '';
      await invoke('hide_window');
    } catch (err) {
      console.error('Vut: failed to run command', err);
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
    void resizeToFit();
  }

  onMount(() => {
    let unlistenFocus: (() => void) | undefined;
    let unlistenConfig: (() => void) | undefined;

    void (async () => {
      await loadConfig();
      unlistenConfig = await startConfigSync();

      const win = getCurrentWindow();
      unlistenFocus = await win.onFocusChanged(({ payload: focused }) => {
        if (focused) {
          query = '';
          selectedIndex = 0;
          requestAnimationFrame(() => inputEl?.focus());
        } else {
          void invoke('hide_window');
        }
      });
    })();

    return () => {
      unlistenFocus?.();
      unlistenConfig?.();
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
      class="input"
      type="text"
      placeholder="Type a keyword…"
      autocomplete="off"
      spellcheck="false"
    />
  </div>

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
</style>
