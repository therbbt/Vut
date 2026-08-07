// Mirrors src-tauri/src/plugins.rs's PluginFieldSchema/PluginManifest -
// see that file for why fields are optional/defaulted the way they are.
export interface PluginFieldSchema {
  key: string;
  label: string;
  type: 'text' | 'password' | 'url';
  placeholder?: string;
  required?: boolean;
}

/** A command Vut creates automatically the first time this plugin is
 * discovered (see ensureDefaultCommands below) - installing a plugin gets
 * you a working command immediately instead of a manual trip through
 * Settings. `fields` seeds that command's plugin config, same shape as
 * configSchema would produce. */
export interface PluginDefaultCommand {
  keyword: string;
  title: string;
  icon?: string;
  fields?: Record<string, string>;
}

export interface PluginManifest {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  configSchema: PluginFieldSchema[];
  /** Fields for an optional login form Settings > Plugins renders inline
   * (see PluginModule.login below) - empty means no interactive login step. */
  loginSchema: PluginFieldSchema[];
  defaultCommands: PluginDefaultCommand[];
}

export interface PluginExecuteContext {
  /** This command's per-field values, keyed by the manifest's configSchema. */
  config: Record<string, string>;
  /** Everything typed after the keyword - same value describeAction sees. */
  query: string;
}

export interface PluginExecuteResult {
  ok: boolean;
  /** Shown as a banner in the search window; kept the window open on failure. */
  message?: string;
  /**
   * Merged into this command's stored `fields` and persisted (see
   * runSelected in App.svelte) when present and `ok`. Lets a plugin action
   * derive config it couldn't have known up front - e.g. a "login"
   * subcommand exchanging a password for a token and saving that token,
   * without Vut's core needing any plugin-specific concept of "logging in".
   */
  configPatch?: Record<string, string>;
  /**
   * When true (and ok), the window stays open instead of closing after the
   * brief success flash - for actions that are more "check on/steer an
   * ongoing thing" than "fire and forget" (e.g. a timer dashboard you want
   * to keep glancing at). The user still closes it themselves (Escape or
   * the summon hotkey again).
   */
  keepOpen?: boolean;
}

/** A plugin's live status, if it has one right now - e.g. "a timer is
 * running, and has been since this timestamp". Polled on window focus and
 * shown as a small ticking indicator in the search bar; has nothing to do
 * with any particular command's query/execute flow. */
export interface PluginStatus {
  label: string;
  /** ISO 8601 timestamp - the displayed duration ticks up from this. */
  since: string;
}

/** The shape a plugin's index.js must default-export. */
export interface PluginModule {
  execute(ctx: PluginExecuteContext): Promise<PluginExecuteResult>;
  describe?(ctx: PluginExecuteContext): string;
  /** Only plugins with a non-empty manifest.loginSchema need this. `fields`
   * are that schema's values from the Settings > Plugins login form;
   * `config` is the current configSchema fields (e.g. baseUrl) of whichever
   * command uses this plugin, so login can reach the same server that
   * command is configured for. A successful configPatch (e.g. a fresh
   * token) is applied back onto that command. */
  login?(fields: Record<string, string>, config: Record<string, string>): Promise<PluginExecuteResult>;
  /** Optional live status check, called with this plugin's associated
   * command's config fields - return null when there's nothing ongoing. */
  getStatus?(config: Record<string, string>): Promise<PluginStatus | null>;
}
