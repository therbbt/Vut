import { invoke } from '@tauri-apps/api/core';
import type { CommandAction } from '../types';
import { buildSearchUrl } from '../parser';

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
export const runAction = async (action: CommandAction, query: string): Promise<void> => {
  if (!isTauriRuntime()) {
    console.warn('runAction: not in a Tauri runtime, skipping', action);
    return;
  }

  switch (action.type) {
    case 'open_url':
      await invoke('open_target', { target: action.url });
      return;
    case 'search':
      await invoke('open_target', { target: buildSearchUrl(action.urlTemplate, query) });
      return;
    case 'launch_app':
      if (action.kind === 'uri') {
        await invoke('open_target', { target: action.uri });
      } else {
        await invoke('launch_app_command', {
          default: action.default,
          windows: action.windows,
          macos: action.macos,
          linux: action.linux,
        });
      }
      return;
  }
};
