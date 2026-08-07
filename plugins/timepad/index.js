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

// Exact (case-insensitive) name match wins; falls back to a substring
// match so "market" can find "Marketing Site".
async function findProject(baseUrl, token, text) {
  const needle = text.toLowerCase();
  const projects = await request(baseUrl, token, '/api/projects');
  return projects.find((p) => p.name.toLowerCase() === needle) ?? projects.find((p) => p.name.toLowerCase().includes(needle)) ?? null;
}

// Looks a name up within one already-known project (used both by the
// explicit "<project>: <task>" form and by the active-project shortcut
// below) - exact match first, substring fallback.
async function findTaskInProject(baseUrl, token, projectId, text) {
  const tasks = await request(baseUrl, token, `/api/projects/${projectId}/tasks`);
  const needle = text.toLowerCase();
  return tasks.find((t) => t.name.toLowerCase() === needle) ?? tasks.find((t) => t.name.toLowerCase().includes(needle)) ?? null;
}

// Resolves a task name to a task_id within a *known* project - either an
// explicit "<project>: <task>" prefix (same syntax the `task` create
// subcommand uses), or the active project set via "tp use <project>" (see
// the `use` subcommand and describe() below). There is deliberately no
// fallback to searching every project: two projects can easily share a
// task name ("Daily standup" in both Marketing and Engineering), and
// guessing which one you meant would risk starting a timer against the
// wrong one with no indication anything was ambiguous - always resolving
// within one specific, known project sidesteps that entirely rather than
// trying to detect it after the fact.
//
// Returns `{ taskId, usedProject }` when the project came from an explicit
// "<project>: <task>" prefix - `usedProject` tells the caller to remember
// it as the new active project too (see the `remember` configPatch on
// `start`/`task`), so an explicit override becomes the new default the
// same way `tp use` does, not just a one-off.
async function resolveTask(baseUrl, token, text, activeProjectId, activeProjectName) {
  if (TASK_ID_PATTERN.test(text)) return { taskId: text };

  const colonIndex = text.indexOf(':');
  if (colonIndex !== -1) {
    const projectText = text.slice(0, colonIndex).trim();
    const taskText = text.slice(colonIndex + 1).trim();
    if (!projectText || !taskText) return { error: 'Usage: tp start <project>: <task name>' };
    const project = await findProject(baseUrl, token, projectText);
    if (!project) return { error: `No project matching "${projectText}"` };
    const match = await findTaskInProject(baseUrl, token, project.project_id, taskText);
    return match ? { taskId: match.task_id, usedProject: project } : { error: `No task matching "${taskText}" in "${project.name}"` };
  }

  if (!activeProjectId) {
    return { error: 'No project selected - run "tp use <project>" first.' };
  }
  const match = await findTaskInProject(baseUrl, token, activeProjectId, text);
  return match ? { taskId: match.task_id } : { error: `No task matching "${text}" in "${activeProjectName || 'the selected project'}"` };
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
          if (!text) return { ok: false, message: 'Usage: tp start <task name> (needs a project selected - "tp use <project>")' };
          const resolved = await resolveTask(baseUrl, token, text, config.activeProjectId, config.activeProjectName);
          if (resolved.error) return { ok: false, message: resolved.error };
          const entry = await request(baseUrl, token, '/api/timer/start', {
            method: 'POST',
            body: JSON.stringify({ task_id: resolved.taskId }),
          });
          const result = { ok: true, message: `Timer started: ${entry.task_name} (${entry.project_name})`, keepOpen: true };
          // An explicit "<project>: <task>" override becomes the new
          // remembered project too - see resolveTask.
          if (resolved.usedProject) {
            result.configPatch = { activeProjectId: resolved.usedProject.project_id, activeProjectName: resolved.usedProject.name };
          }
          return result;
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
        case 'project': {
          const name = rest.join(' ');
          if (!name) return { ok: false, message: 'Usage: tp project <name>' };
          const project = await request(baseUrl, token, '/api/projects', {
            method: 'POST',
            body: JSON.stringify({ name }),
          });
          // A freshly created project becomes the remembered one - you
          // just made it to work in it.
          return {
            ok: true,
            message: `Project created: ${project.name} (now selected)`,
            keepOpen: true,
            configPatch: { activeProjectId: project.project_id, activeProjectName: project.name },
          };
        }
        case 'task': {
          // "<project>: <task name>" picks the project explicitly, same
          // syntax as `start` - a plain space can't separate them since
          // both are free-form, possibly multi-word text. Without a colon,
          // requires whatever project is active (see `use` below) - same
          // "always resolve within one known project" reasoning as start's
          // resolveTask.
          const text = rest.join(' ');
          const colonIndex = text.indexOf(':');
          let project;
          let taskName;
          let remember = false;
          if (colonIndex !== -1) {
            const projectText = text.slice(0, colonIndex).trim();
            taskName = text.slice(colonIndex + 1).trim();
            if (!projectText || !taskName) return { ok: false, message: 'Usage: tp task <project>: <task name>' };
            project = await findProject(baseUrl, token, projectText);
            if (!project) return { ok: false, message: `No project matching "${projectText}"` };
            remember = true;
          } else {
            taskName = text.trim();
            if (!taskName) return { ok: false, message: 'Usage: tp task <project>: <task name>' };
            if (!config.activeProjectId) {
              return { ok: false, message: 'No project selected - run "tp use <project>" first.' };
            }
            project = { project_id: config.activeProjectId, name: config.activeProjectName || 'the selected project' };
          }
          const task = await request(baseUrl, token, `/api/projects/${project.project_id}/tasks`, {
            method: 'POST',
            body: JSON.stringify({ name: taskName }),
          });
          const result = { ok: true, message: `Task created: ${task.name} (${project.name})`, keepOpen: true };
          if (remember) result.configPatch = { activeProjectId: project.project_id, activeProjectName: project.name };
          return result;
        }
        case 'use': {
          const name = rest.join(' ');
          if (!name || name.toLowerCase() === 'none') {
            return { ok: true, message: 'No project selected.', keepOpen: true, configPatch: { activeProjectId: '', activeProjectName: '' } };
          }
          const project = await findProject(baseUrl, token, name);
          if (!project) return { ok: false, message: `No project matching "${name}"` };
          return {
            ok: true,
            message: `Using project: ${project.name}`,
            keepOpen: true,
            configPatch: { activeProjectId: project.project_id, activeProjectName: project.name },
          };
        }
        default:
          return { ok: false, message: 'Usage: tp <start|stop|current|dashboard|project|task|use> [args]' };
      }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'Request failed' };
    }
  },

  describe({ config, query }) {
    if (query) return `TimePad: ${query}`;
    return config.activeProjectName ? `Control the TimePad timer · using ${config.activeProjectName}` : 'Control the TimePad timer';
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
