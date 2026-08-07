<script lang="ts" context="module">
  import { icons } from '@lucide/svelte';

  interface IconEntry {
    name: string;
    label: string;
  }

  // Lucide's names are PascalCase ("ArrowUpRight") - split to "Arrow Up
  // Right" for a readable label and for search to match natural phrases
  // like "arrow up" via plain substring matching.
  const toLabel = (name: string): string => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2');

  const ALL_ICONS: IconEntry[] = Object.keys(icons)
    .sort()
    .map((name) => ({ name, label: toLabel(name) }));

  const MAX_RESULTS = 300;
</script>

<script lang="ts">
  import { tick } from 'svelte';
  import CommandIcon from './CommandIcon.svelte';

  // The icon field stays a plain editable <input> alongside this (see
  // CommandEditForm.svelte) - lets you clear it, or keep whatever legacy
  // text/emoji value was already there without needing this picker at all.
  export let value: string;
  export let onChange: (value: string) => void;

  let open = false;
  let query = '';
  let rootEl: HTMLDivElement | undefined;
  let searchEl: HTMLInputElement | undefined;

  $: filtered = (
    query.trim() ? ALL_ICONS.filter((e) => e.label.toLowerCase().includes(query.trim().toLowerCase())) : ALL_ICONS
  ).slice(0, MAX_RESULTS);

  const toggle = () => {
    open = !open;
    if (open) {
      query = '';
      void tick().then(() => searchEl?.focus());
    }
  };

  const choose = (name: string) => {
    onChange(`lucide:${name}`);
    open = false;
  };

  const onOutsideClick = (event: MouseEvent) => {
    if (open && rootEl && !rootEl.contains(event.target as Node)) open = false;
  };

  const onSearchKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      open = false;
    } else if (event.key === 'Enter' && filtered[0]) {
      event.preventDefault();
      choose(filtered[0].name);
    }
  };
</script>

<svelte:window on:mousedown={onOutsideClick} />

<div class="icon-picker" bind:this={rootEl}>
  <button class="trigger" type="button" on:click={toggle} aria-haspopup="listbox" aria-expanded={open} title="Pick an icon">
    <CommandIcon icon={value} fallback="?" size={18} />
  </button>
  {#if open}
    <div class="panel">
      <input
        bind:this={searchEl}
        bind:value={query}
        on:keydown={onSearchKeydown}
        class="search"
        type="text"
        placeholder="Search icons…"
        autocomplete="off"
        spellcheck="false"
      />
      <div class="grid" role="listbox">
        {#each filtered as entry (entry.name)}
          <button type="button" class="cell" title={entry.label} on:click={() => choose(entry.name)}>
            <svelte:component this={icons[entry.name as keyof typeof icons]} size={18} strokeWidth={1.75} />
          </button>
        {/each}
        {#if filtered.length === 0}
          <p class="empty">No matches</p>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .icon-picker {
    position: relative;
    flex-shrink: 0;
  }

  .trigger {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.4rem;
    height: 2.4rem;
    border: 1px solid var(--border);
    border-radius: 0.45rem;
    background: var(--panel-2);
    color: var(--text);
    cursor: pointer;
  }

  .trigger:hover {
    background: var(--accent-soft);
  }

  .panel {
    position: absolute;
    top: calc(100% + 0.25rem);
    right: 0;
    z-index: 10;
    width: 17rem;
    display: flex;
    flex-direction: column;
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    overflow: hidden;
  }

  .search {
    border: 0;
    border-bottom: 1px solid var(--border);
    background: transparent;
    color: var(--text);
    padding: 0.5rem 0.6rem;
    font-size: 0.82rem;
  }

  .search:focus {
    outline: none;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 0.15rem;
    padding: 0.4rem;
    max-height: 14rem;
    overflow-y: auto;
  }

  .cell {
    display: flex;
    align-items: center;
    justify-content: center;
    aspect-ratio: 1;
    border: 0;
    border-radius: 0.35rem;
    background: transparent;
    color: var(--text);
    cursor: pointer;
  }

  .cell:hover {
    background: var(--accent-soft);
  }

  .empty {
    grid-column: 1 / -1;
    margin: 0;
    padding: 0.6rem;
    font-size: 0.78rem;
    color: var(--muted);
    text-align: center;
  }
</style>
