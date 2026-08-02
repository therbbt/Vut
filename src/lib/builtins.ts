import type { VutCommand } from './types';

// Built-in results that are always searchable but aren't part of the
// user's editable command list - never persisted to config.json, never
// shown in the Commands manager. Matched through the exact same
// matchCommands()/keyboard-nav path as user commands, just merged in at the
// call site (see App.svelte) - a real command with this id can never occur
// since newCommandId() draws from crypto.randomUUID(), never this literal.
export const SETTINGS_COMMAND_ID = '__builtin_settings__';

export const BUILTIN_COMMANDS: VutCommand[] = [
  {
    id: SETTINGS_COMMAND_ID,
    keyword: 'settings',
    title: 'Vut Settings',
    icon: '⚙️',
    // Placeholder - never actually run. Handled specially wherever a
    // command is about to be executed (see runSelected in App.svelte) and
    // described specially in parser.ts's describeAction, both keyed off
    // SETTINGS_COMMAND_ID rather than this action.
    action: { type: 'open_url', url: '' },
  },
];
