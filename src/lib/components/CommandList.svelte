<script lang="ts">
  import type { VutCommand } from '../types';

  export let commandList: VutCommand[];
  export let selectedId: string | null | undefined;
  export let onSelect: (id: string) => void;
  export let onAddNew: () => void;
  export let onReorder: (next: VutCommand[]) => void;
  export let onDelete: (id: string) => void;

  const moveBy = (index: number, delta: number) => {
    const next = [...commandList];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onReorder(next);
  };

  const remove = (command: VutCommand) => {
    if (confirm(`Delete the "${command.keyword}" command? This can't be undone.`)) onDelete(command.id);
  };
</script>

<div class="list-pane">
  <button class="btn primary add" type="button" on:click={onAddNew}>+ Add command</button>
  <div class="list" role="listbox">
    {#each commandList as command, index (command.id)}
      <div class="row" class:selected={command.id === selectedId}>
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div class="row-main" role="option" tabindex="-1" aria-selected={command.id === selectedId} on:click={() => onSelect(command.id)}>
          <span class="keyword">{command.keyword}</span>
          <span class="title">{command.title}</span>
        </div>
        <div class="row-actions">
          <button type="button" title="Move up" disabled={index === 0} on:click={() => moveBy(index, -1)}>↑</button>
          <button type="button" title="Move down" disabled={index === commandList.length - 1} on:click={() => moveBy(index, 1)}>↓</button>
          <button type="button" title="Delete" class="danger" on:click={() => remove(command)}>✕</button>
        </div>
      </div>
    {/each}
    {#if commandList.length === 0}
      <p class="empty">No commands yet - add one to get started.</p>
    {/if}
  </div>
</div>

<style>
  .list-pane {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 1rem;
    border-right: 1px solid var(--border);
    min-width: 0;
    overflow: hidden;
  }

  .add {
    flex-shrink: 0;
  }

  .list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .empty {
    color: var(--muted);
    font-size: 0.8rem;
    padding: 0.5rem 0.2rem;
  }

  .row {
    display: flex;
    align-items: center;
    border-radius: 0.5rem;
    gap: 0.3rem;
  }

  .row.selected {
    background: var(--accent-soft);
  }

  .row-main {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: 1;
    min-width: 0;
    padding: 0.45rem 0.5rem;
    cursor: pointer;
  }

  .keyword {
    flex-shrink: 0;
    font-size: 0.76rem;
    font-weight: 600;
    color: var(--accent);
    background: var(--panel-2);
    border-radius: 0.3rem;
    padding: 0.1rem 0.35rem;
  }

  .title {
    font-size: 0.82rem;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .row-actions {
    display: flex;
    flex-shrink: 0;
    gap: 0.15rem;
    padding-right: 0.3rem;
  }

  .row-actions button {
    border: 0;
    background: transparent;
    color: var(--muted);
    width: 1.4rem;
    height: 1.4rem;
    border-radius: 0.3rem;
    font-size: 0.75rem;
    padding: 0;
  }

  .row-actions button:hover:not(:disabled) {
    background: var(--panel-2);
    color: var(--text);
  }

  .row-actions button:disabled {
    opacity: 0.3;
  }

  .row-actions button.danger:hover {
    background: #ef4444;
    color: #fff;
  }

  .btn {
    border: 1px solid var(--border);
    border-radius: 0.45rem;
    background: var(--panel-2);
    color: var(--text);
    font-size: 0.82rem;
    padding: 0.5rem 0.9rem;
  }

  .btn.primary {
    background: var(--accent-soft);
    font-weight: 600;
  }
</style>
