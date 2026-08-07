import { invoke } from '@tauri-apps/api/core';
import type { PluginManifest, PluginModule } from './types';

const isTauriRuntime = () =>
  typeof window !== 'undefined' && Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);

export const listPluginManifests = async (): Promise<PluginManifest[]> => {
  if (!isTauriRuntime()) return [];
  return await invoke<PluginManifest[]>('list_plugins');
};

export const pluginsDirPath = async (): Promise<string> => {
  if (!isTauriRuntime()) return '';
  return await invoke<string>('plugins_dir_path');
};

export const openPluginsFolder = async (): Promise<void> => {
  if (!isTauriRuntime()) return;
  await invoke('open_plugins_folder');
};

// Prepended to every plugin module's source before it's loaded, so a plain
// `fetch(url, options)` call resolves to this instead of the webview's real
// fetch. The webview's fetch is subject to actual browser CORS enforcement
// against whatever third-party server a plugin targets - the TimePad API
// only allowed one specific dev-server origin and rejected Vut's, which is
// exactly the class of failure this exists to avoid entirely. Routing
// through the plugin_http_fetch Rust command (a native HTTP client) isn't
// subject to CORS at all, and needs no capability/scope wiring for the same
// "arbitrary user-configured target" reason open_target bypasses opener's
// JS binding (see launcher.rs). Plugin authors never see any of this - they
// just write normal fetch() calls, same as TimePad's index.js does.
//
// __TAURI_INTERNALS__.invoke is used directly (not an import) since this
// text is spliced into a Blob-loaded module with no bundler and no import
// map to resolve `@tauri-apps/api/core` from.
const FETCH_SHIM = `
const fetch = async (url, options = {}) => {
  const headers = {};
  if (options.headers) {
    if (typeof options.headers.entries === 'function') {
      for (const [k, v] of options.headers.entries()) headers[k] = v;
    } else {
      Object.assign(headers, options.headers);
    }
  }
  const res = await window.__TAURI_INTERNALS__.invoke('plugin_http_fetch', {
    url,
    method: options.method || 'GET',
    headers,
    body: typeof options.body === 'string' ? options.body : null,
  });
  const lowerHeaders = {};
  for (const k in res.headers) lowerHeaders[k.toLowerCase()] = res.headers[k];
  return {
    ok: res.status >= 200 && res.status < 300,
    status: res.status,
    statusText: '',
    headers: { get: (name) => lowerHeaders[name.toLowerCase()] ?? null },
    text: async () => res.body,
    json: async () => JSON.parse(res.body),
  };
};
`;

// A plugin's JS is fetched as text over IPC - consistent with config.json
// already being read/written entirely through Rust - then loaded as a real
// ES module via a Blob URL, so plugin code can use normal import/export
// like any other module. No sandboxing beyond that: a plugin is exactly as
// trusted as hand-edited config.json already is, code the user (or Vut
// itself, for bundled plugins) placed on disk themselves.
export const loadPluginModule = async (pluginId: string): Promise<PluginModule> => {
  const code = await invoke<string>('read_plugin_module', { pluginId });
  const blobUrl = URL.createObjectURL(new Blob([FETCH_SHIM + code], { type: 'text/javascript' }));
  try {
    const mod = await import(/* @vite-ignore */ blobUrl);
    if (typeof mod.default?.execute !== 'function') {
      throw new Error(`Plugin "${pluginId}" has no default export with an execute() function`);
    }
    return mod.default as PluginModule;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
};
