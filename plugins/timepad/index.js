// TimePad plugin - see manifest.json for the configSchema (baseUrl, token)
// that fills `config` below. Loaded at runtime as a real ES module (see
// src/lib/plugins/pluginService.ts) - top-level fetch() works here with no
// Tauri wiring since tauri.conf.json's csp is null.
//
// Endpoint shapes below are taken from the live server's own OpenAPI spec
// (GET /api/openapi.json) rather than guessed - notably /api/timer/start
// wants a `task_id` matching ^TASK\d{8}$, not a free-text title, so `start`
// resolves whatever name you typed against GET /api/projects +
// GET /api/projects/{id}/tasks first.

const trimBaseUrl = (url) => (url || 'http://localhost:8000').replace(/\/+$/, '');
const TASK_ID_PATTERN = /^TASK\d{8}$/;

async function request(baseUrl, token, path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers ?? {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}${body ? `: ${body}` : ''}`);
  }
  const contentType = res.headers.get('content-type') ?? '';
  return contentType.includes('application/json') ? res.json() : null;
}

// No flat "search tasks" endpoint exists - only per-project listing - so a
// name has to be resolved by walking every project's task list. Exact
// (case-insensitive) name match wins; falls back to a substring match so
// "standup" can find "Daily standup".
async function findTaskId(baseUrl, token, text) {
  if (TASK_ID_PATTERN.test(text)) return text;

  const needle = text.toLowerCase();
  const projects = await request(baseUrl, token, '/api/projects');
  let substringMatch = null;
  for (const project of projects) {
    const tasks = await request(baseUrl, token, `/api/projects/${project.project_id}/tasks`);
    const exact = tasks.find((t) => t.name.toLowerCase() === needle);
    if (exact) return exact.task_id;
    if (!substringMatch) substringMatch = tasks.find((t) => t.name.toLowerCase().includes(needle));
  }
  return substringMatch?.task_id ?? null;
}

// Only reachable from the Settings > Plugins login form (see the module's
// login() export below) - logging in via the search bar was deliberately
// removed, since the search bar has no way to mask what's typed and a
// password would sit in plain text in the query input.
async function authenticate(baseUrl, email, password) {
  if (!email || !password) return { ok: false, message: 'Email and password are required.' };
  try {
    const data = await request(baseUrl, null, '/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    return { ok: true, message: `Logged in as ${data.user.email}`, configPatch: { token: data.access_token } };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Login failed' };
  }
}

export default {
  async execute({ config, query }) {
    const baseUrl = trimBaseUrl(config.baseUrl);
    const token = config.token ?? '';
    const [subRaw, ...rest] = query.trim().split(/\s+/).filter(Boolean);
    const sub = (subRaw ?? '').toLowerCase();

    try {
      if (!token) {
        return { ok: false, message: 'Not logged in - go to Settings > Plugins > TimePad and log in.' };
      }

      switch (sub) {
        case 'start': {
          const text = rest.join(' ');
          if (!text) return { ok: false, message: 'Usage: tp start <task name or TASK########>' };
          const taskId = await findTaskId(baseUrl, token, text);
          if (!taskId) return { ok: false, message: `No task matching "${text}"` };
          const entry = await request(baseUrl, token, '/api/timer/start', {
            method: 'POST',
            body: JSON.stringify({ task_id: taskId }),
          });
          return { ok: true, message: `Timer started: ${entry.task_name} (${entry.project_name})`, keepOpen: true };
        }
        case 'stop': {
          const entry = await request(baseUrl, token, '/api/timer/stop', { method: 'POST' });
          return { ok: true, message: `Timer stopped: ${entry.task_name} (${entry.duration_minutes ?? 0}m)`, keepOpen: true };
        }
        case 'current': {
          const data = await request(baseUrl, token, '/api/timer/current');
          return {
            ok: true,
            message: data.entry ? `Current: ${data.entry.task_name} (${data.entry.project_name})` : 'No active timer',
            keepOpen: true,
          };
        }
        case 'dashboard': {
          const data = await request(baseUrl, token, '/api/dashboard');
          const running = data.active_timer ? ` · running: ${data.active_timer.task_name}` : '';
          return { ok: true, message: `Today: ${data.today_minutes}m · Week: ${data.week_minutes}m${running}`, keepOpen: true };
        }
        default:
          return { ok: false, message: 'Usage: tp <start|stop|current|dashboard> [args]' };
      }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'Request failed' };
    }
  },

  describe({ query }) {
    return query ? `TimePad: ${query}` : 'Control the TimePad timer';
  },

  // Called from Settings > Plugins' inline login form (see manifest.json's
  // loginSchema) - `config` is whichever command uses this plugin's
  // current fields, so login hits the same baseUrl that command is set to
  // rather than assuming the default.
  async login(fields, config) {
    return authenticate(trimBaseUrl(config.baseUrl), fields.email, fields.password);
  },

  // Polled by the search window (see checkActiveStatus/refreshActiveStatus
  // in App.svelte/pluginStore.ts) to show a ticking "time since" indicator
  // whenever a timer is running - independent of actually running a tp
  // command. Silent null on any failure (not logged in, server
  // unreachable, ...) rather than surfacing an error - this is a passive
  // glance, not something the user asked to run right now.
  async getStatus(config) {
    const token = config.token;
    if (!token) return null;
    try {
      const data = await request(trimBaseUrl(config.baseUrl), token, '/api/timer/current');
      if (!data.entry) return null;
      return { label: `${data.entry.task_name} (${data.entry.project_name})`, since: data.entry.start_time };
    } catch {
      return null;
    }
  },
};
