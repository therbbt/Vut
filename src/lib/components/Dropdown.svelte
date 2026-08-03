<script lang="ts" context="module">
  export interface DropdownOption {
    value: string;
    label: string;
  }
</script>

<script lang="ts">
  // <select>/<option> render as native OS popups on Linux (WebKitGTK), which
  // ignore page CSS entirely and come out oversized/unstyled - a custom
  // button+listbox is the only way to get a themed, compact dropdown here,
  // not just a styling preference. Mirrors FlashPad's SettingsPanel.svelte.
  export let options: DropdownOption[];
  export let value: string;
  export let onChange: (value: string) => void;
  export let placeholder = '';

  let open = false;
  let rootEl: HTMLDivElement | undefined;

  $: current = options.find((o) => o.value === value);

  const toggle = () => (open = !open);

  const choose = (option: DropdownOption) => {
    onChange(option.value);
    open = false;
  };

  const onOutsideClick = (event: MouseEvent) => {
    if (open && rootEl && !rootEl.contains(event.target as Node)) open = false;
  };
</script>

<svelte:window on:mousedown={onOutsideClick} />

<div class="dropdown" bind:this={rootEl}>
  <button class="select" type="button" on:click={toggle} aria-haspopup="listbox" aria-expanded={open}>
    <span class="label">{current?.label ?? placeholder}</span>
    <svg
      class="caret"
      width="9"
      height="9"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M2.5 3.5L5 6.5L7.5 3.5" />
    </svg>
  </button>
  {#if open}
    <ul class="dropdown-menu" role="listbox">
      {#each options as option (option.value)}
        <li>
          <button
            class="dropdown-item"
            class:active={option.value === value}
            role="option"
            aria-selected={option.value === value}
            on:click={() => choose(option)}
          >
            {option.label}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .dropdown {
    position: relative;
    min-width: 0;
  }

  .select {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.4rem;
    width: 100%;
    border: 1px solid var(--border);
    border-radius: 0.35rem;
    background: var(--panel-2);
    color: var(--text);
    font-size: 0.78rem;
    padding: 0.35rem 0.55rem;
    cursor: pointer;
  }

  .select:hover {
    background: var(--accent-soft);
  }

  .select:focus-visible {
    outline: 2px solid var(--accent-soft);
    outline-offset: 0;
  }

  .label {
    flex: 1;
    min-width: 0;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .caret {
    color: var(--muted);
    flex-shrink: 0;
  }

  .dropdown-menu {
    position: absolute;
    top: calc(100% + 0.25rem);
    left: 0;
    right: 0;
    z-index: 10;
    max-height: 220px;
    overflow-y: auto;
    list-style: none;
    margin: 0;
    padding: 0.25rem;
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: 0.4rem;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .dropdown-item {
    display: block;
    width: 100%;
    border: 0;
    background: transparent;
    color: var(--text);
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    padding: 0.35rem 0.6rem;
    font-size: 0.78rem;
    border-radius: 0.3rem;
    cursor: pointer;
  }

  .dropdown-item:hover {
    background: var(--panel);
  }

  .dropdown-item.active {
    color: var(--accent);
    font-weight: 600;
  }
</style>
