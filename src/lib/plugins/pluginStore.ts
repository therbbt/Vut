import { writable, derived } from 'svelte/store';
import type { PluginManifest, PluginModule, PluginStatus } from './types';
import { listPluginManifests, loadPluginModule } from './pluginService';
import { newCommandId, type VutCommand } from '../types';

export interface PluginEntry {
  manifest: PluginManifest;
  /** Set when the module failed to load - still listed (Settings > Plugins
   * shows something's wrong) rather than silently dropped. */
  error: string | null;
}

// Every discovered plugin, load errors included - what Settings > Plugins
// renders (see PluginsSection.svelte's FlashPad equivalent).
export const pluginEntries = writable<PluginEntry[]>([]);

// Successfully-loaded plugins only - what the Action dropdown/execution
// path uses, so a broken plugin can never be selected as an action that
// would then fail every single time it's run.
export const plugins = derived(pluginEntries, ($entries) => $entries.filter((e) => !e.error).map((e) => e.manifest));

// Loaded modules carry real functions, so they live in a plain Map rather
// than store state.
const loadedModules = new Map<string, PluginModule>();

// Plugins are discovered from disk, not part of config.json, so there's no
// cross-window live sync the way commands/settings have - each window
// loads them once from onMount (see App.svelte, Settings.svelte), and
// Settings > Plugins' "Reload plugins" button calls this again on demand.
export const loadPlugins = async (): Promise<void> => {
  const manifests = await listPluginManifests();
  loadedModules.clear();
  const entries: PluginEntry[] = [];
  for (const manifest of manifests) {
    try {
      loadedModules.set(manifest.id, await loadPluginModule(manifest.id));
      entries.push({ manifest, error: null });
    } catch (err) {
      console.error(`Vut: failed to load plugin "${manifest.id}"`, err);
      entries.push({ manifest, error: err instanceof Error ? err.message : 'Failed to load' });
    }
  }
  pluginEntries.set(entries);
};

export const getPluginModule = (id: string): PluginModule | undefined => loadedModules.get(id);

// Shared by App.svelte (after a plugin action's execute() returns a
// configPatch) and Settings.svelte (after a successful login form submit) -
// both are "a plugin derived some config at runtime, merge it into the
// command that's actually using this plugin" with no other difference.
export const applyConfigPatch = (command: VutCommand, patch: Record<string, string>): VutCommand => {
  if (command.action.type !== 'plugin') return command;
  return { ...command, action: { ...command.action, fields: { ...command.action.fields, ...patch } } };
};

export const findCommandForPlugin = (commands: VutCommand[], pluginId: string): VutCommand | undefined =>
  commands.find((c) => c.action.type === 'plugin' && c.action.pluginId === pluginId);

// Pure - callers (App.svelte, on boot) decide whether/how to persist the
// result via saveCommands/saveSettings. Seeding is tracked in
// settings.seededPluginIds rather than "does a command using this plugin
// currently exist", so deleting the auto-added command sticks instead of
// it reappearing on every launch.
export const ensureDefaultCommands = (
  commands: VutCommand[],
  seededPluginIds: string[],
  manifests: PluginManifest[],
): { commands: VutCommand[]; seededPluginIds: string[] } | null => {
  const nextCommands: VutCommand[] = [];
  const nextSeeded = [...seededPluginIds];
  let changed = false;

  for (const manifest of manifests) {
    if (seededPluginIds.includes(manifest.id) || manifest.defaultCommands.length === 0) continue;
    changed = true;
    nextSeeded.push(manifest.id);
    for (const def of manifest.defaultCommands) {
      nextCommands.push({
        id: newCommandId(),
        keyword: def.keyword,
        title: def.title,
        icon: def.icon ?? null,
        action: { type: 'plugin', pluginId: manifest.id, fields: def.fields ?? {} },
      });
    }
  }

  if (!changed) return null;
  return { commands: [...commands, ...nextCommands], seededPluginIds: nextSeeded };
};

// Checked on window focus and after any plugin action runs (see
// App.svelte) - the first non-null status wins, since the search bar only
// has room for one ticking indicator. A plugin with no getStatus, or one
// that errors (e.g. server unreachable), is treated as "nothing to show"
// rather than surfacing an error here - this is a passive glance, not
// something the user asked to run.
export const checkActiveStatus = async (commands: VutCommand[]): Promise<PluginStatus | null> => {
  for (const command of commands) {
    if (command.action.type !== 'plugin') continue;
    const mod = getPluginModule(command.action.pluginId);
    if (!mod?.getStatus) continue;
    try {
      const status = await mod.getStatus(command.action.fields);
      if (status) return status;
    } catch (err) {
      console.error(`Vut: getStatus failed for plugin "${command.action.pluginId}"`, err);
    }
  }
  return null;
};
