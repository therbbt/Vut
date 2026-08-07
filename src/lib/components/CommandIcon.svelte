<script lang="ts">
  import { icons } from '@lucide/svelte';

  // `icon` is still just a plain string (unchanged in VutCommand/config.json)
  // - "lucide:IconName" is a convention on top of that, not a schema
  // change, so anything already in someone's config (a manually-typed
  // emoji, "⚙️"/"⏱️" from Settings/plugin-declared icons, ...) keeps
  // rendering exactly as literal text like it always has. Only values
  // written by IconPicker.svelte get the "lucide:" prefix.
  export let icon: string | null | undefined;
  export let fallback: string;
  export let size = 18;

  const LUCIDE_PREFIX = 'lucide:';
  type IconComponent = (typeof icons)[keyof typeof icons];

  let LucideIcon: IconComponent | null = null;
  $: lucideName = icon?.startsWith(LUCIDE_PREFIX) ? icon.slice(LUCIDE_PREFIX.length) : null;
  $: LucideIcon = lucideName && lucideName in icons ? icons[lucideName as keyof typeof icons] : null;
</script>

{#if LucideIcon}
  <svelte:component this={LucideIcon} {size} strokeWidth={2} />
{:else}
  <span class="text-icon">{icon?.trim() ? icon : fallback}</span>
{/if}

<style>
  .text-icon {
    line-height: 1;
  }
</style>
