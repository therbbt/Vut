import { invoke } from '@tauri-apps/api/core';
import type { CommandAction } from '../types';
import { buildSearchUrl } from '../parser';
import { getPluginModule } from '../plugins/pluginStore';
import type { PluginExecuteResult } from '../plugins/types';

const isTauriRuntime = () =>
  typeof window !== 'undefined' && Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);

// Every action is user-authored config, not untrusted remote content, so
// there's no per-URL/per-scheme allowlist here the way a note-taking app
// would restrict links pasted from the web - the whole point of a keyword
// launcher is that the user can point a command at anything (a custom URI
// scheme, an arbitrary executable path). Both `open_target` and
// `launch_app_command` are implemented in Rust (see launcher.rs) using the
// opener/shell plugins' native APIs directly, rather than the plugins' JS
// bindings, since the JS-facing `shell:allow-execute`/`opener:allow-open-url`
// capability scopes require a static allowlist that can't express "whatever
// command the user typed into their own config."
//
// Every case but 'plugin' resolves to a plain `{ ok: true }` with no
// message - App.svelte only flashes a banner when a message is present, so
// existing action types are unaffected by plugins being able to report
// success/failure with one.
const OK: PluginExecuteResult = { ok: true };

export const runAction = async (action: CommandAction, query: string): Promise<PluginExecuteResult> => {
  if (!isTauriRuntime()) {
    console.warn('runAction: not in a Tauri runtime, skipping', action);
    return OK;
  }

  switch (action.type) {
    case 'open_url':
      await invoke('open_target', { target: action.url, browser: action.browser });
      return OK;
    case 'search':
      await invoke('open_target', { target: buildSearchUrl(action.urlTemplate, query), browser: action.browser });
      return OK;
    case 'launch_app':
      if (action.kind === 'uri') {
        await invoke('open_target', { target: action.uri, browser: null });
      } else {
        await invoke('launch_app_command', {
          default: action.default,
          windows: action.windows,
          macos: action.macos,
          linux: action.linux,
        });
      }
      return OK;
    case 'open_settings':
      await invoke('show_settings');
      return OK;
    case 'plugin': {
      const mod = getPluginModule(action.pluginId);
      if (!mod) return { ok: false, message: `Plugin "${action.pluginId}" isn't loaded.` };
      return await mod.execute({ config: action.fields, query });
    }
  }
};
