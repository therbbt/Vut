export interface CommandSpec {
  command: string;
  args: string[];
}

export type CommandAction =
  | { type: 'open_url'; url: string; browser: string | null }
  | { type: 'search'; urlTemplate: string; browser: string | null }
  | { type: 'launch_app'; kind: 'uri'; uri: string }
  | {
      type: 'launch_app';
      kind: 'command';
      default: CommandSpec;
      windows: CommandSpec | null;
      macos: CommandSpec | null;
      linux: CommandSpec | null;
    }
  | { type: 'open_settings' };

export interface VutCommand {
  id: string;
  keyword: string;
  title: string;
  icon: string | null;
  action: CommandAction;
}

export interface VutSettings {
  hotkey: string;
  theme: 'light' | 'dark';
  lightPaletteId: string;
  darkPaletteId: string;
  autostart: boolean;
  defaultSearchCommandId: string | null;
}

export interface VutConfig {
  commands: VutCommand[];
  settings: VutSettings;
}

export const emptyCommandSpec = (): CommandSpec => ({ command: '', args: [] });

export const newCommandId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`;
