import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export const CLAUDE_HOME = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
export const QD_HOME = process.env.QD_HOME || path.join(CLAUDE_HOME, 'quarterdeck');

export const STATE_DIR = path.join(QD_HOME, 'state');
export const RUNTIME_DIR = path.join(QD_HOME, 'runtime');

export const TASKS_MD = path.join(STATE_DIR, 'tasks.md');
export const ARCHIVE_MD = path.join(STATE_DIR, 'archive.md');
export const INBOX_JSONL = path.join(STATE_DIR, 'inbox.jsonl');
export const COUNTER = path.join(STATE_DIR, '.counter');
export const LOCK = path.join(STATE_DIR, '.lock');

export const SESSIONS_JSON = path.join(RUNTIME_DIR, 'sessions.json');
export const AGENTS_JSON = path.join(RUNTIME_DIR, 'agents.json');
export const SERVER_PID = path.join(RUNTIME_DIR, 'server.pid');
export const SERVER_LOG = path.join(RUNTIME_DIR, 'server.log');
export const CONFIG_JSON = path.join(QD_HOME, 'config.json');

/** Claude Code's own live-session registry and per-project transcript dirs. */
export const CC_SESSIONS_DIR = path.join(CLAUDE_HOME, 'sessions');
export const CC_PROJECTS_DIR = path.join(CLAUDE_HOME, 'projects');

export const DEFAULTS = {
  port: 7337,
  // Context-window sizes are not present in the transcript, so they are configured.
  contextWindow: 200000,
  windowByModel: {
    'claude-opus-5': 200000,
    'claude-sonnet-5': 200000,
    'claude-fable-5': 200000,
    'claude-haiku-4-5-20251001': 200000,
  },
  // How long an answered P4 lookup stays on the board before auto-archiving.
  lookupTtlHours: 24,
};

export function ensureDirs() {
  for (const d of [QD_HOME, STATE_DIR, RUNTIME_DIR]) fs.mkdirSync(d, { recursive: true });
}

let cachedConfig = null;
export function config() {
  if (cachedConfig) return cachedConfig;
  let user = {};
  try {
    user = JSON.parse(fs.readFileSync(CONFIG_JSON, 'utf8'));
  } catch {
    // No config file is the normal case; defaults apply.
  }
  cachedConfig = {
    ...DEFAULTS,
    ...user,
    windowByModel: { ...DEFAULTS.windowByModel, ...(user.windowByModel || {}) },
  };
  if (process.env.QD_PORT) cachedConfig.port = Number(process.env.QD_PORT);
  return cachedConfig;
}

/** Claude Code slugs a cwd by replacing every non-alphanumeric run with a dash. */
export function slugForCwd(cwd) {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}
