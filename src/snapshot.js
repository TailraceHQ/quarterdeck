import fs from 'node:fs';
import path from 'node:path';
import {
  CC_SESSIONS_DIR,
  CC_PROJECTS_DIR,
  SESSIONS_JSON,
  AGENTS_JSON,
  ensureDirs,
  config,
  slugForCwd,
} from './paths.js';
import { repoForCwd } from './store.js';

/** Read the tail of a file without loading a multi-megabyte transcript. */
function tailLines(file, bytes = 262144) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf8').split('\n');
  } catch {
    return [];
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* already closed */ }
  }
}

export function transcriptPath(sessionId, cwd) {
  return path.join(CC_PROJECTS_DIR, slugForCwd(cwd), `${sessionId}.jsonl`);
}

/**
 * Context occupancy for a session: the token count of the most recent request,
 * which is what actually sits in the model's window right now.
 */
export function contextForTranscript(file) {
  const lines = tailLines(file);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || !line.includes('"usage"')) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue; // A truncated first line from the tail window, or a partial write.
    }
    if (d.type !== 'assistant') continue;
    const u = d.message?.usage;
    if (!u) continue;
    const used =
      (u.input_tokens || 0) +
      (u.cache_creation_input_tokens || 0) +
      (u.cache_read_input_tokens || 0) +
      (u.output_tokens || 0);
    return { used, model: d.message?.model || '', at: d.timestamp || '' };
  }
  return null;
}

/** Live Claude Code sessions, from Claude Code's own per-pid registry. */
export function readSessions() {
  const cfg = config();
  let files = [];
  try {
    files = fs.readdirSync(CC_SESSIONS_DIR).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    let s;
    try {
      s = JSON.parse(fs.readFileSync(path.join(CC_SESSIONS_DIR, f), 'utf8'));
    } catch {
      continue;
    }
    if (!s.sessionId) continue;
    // The registry keeps files for dead processes; only report live ones.
    if (s.pid && !isAlive(s.pid)) continue;

    const ctx = contextForTranscript(transcriptPath(s.sessionId, s.cwd || ''));
    const window = cfg.windowByModel[ctx?.model] || cfg.contextWindow;
    out.push({
      sessionId: s.sessionId,
      short: s.sessionId.slice(0, 8),
      pid: s.pid,
      name: s.name || s.sessionId.slice(0, 8),
      cwd: s.cwd || '',
      repo: repoForCwd(s.cwd || ''),
      status: s.status || 'idle',
      version: s.version || '',
      startedAt: s.startedAt || 0,
      updatedAt: s.updatedAt || 0,
      model: ctx?.model || '',
      contextUsed: ctx?.used || 0,
      contextWindow: window,
      contextPct: ctx ? Math.min(100, Math.round((ctx.used / window) * 100)) : 0,
    });
  }
  return out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

// ------------------------------------------------------- subagent registry

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  ensureDirs();
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

/**
 * Record a running subagent. Deliberately stores only agent type, model, and
 * the short description — never the prompt body or any tool output.
 */
export function recordAgent({ sessionId, subagentType, model, description }) {
  const agents = readJson(AGENTS_JSON, []);
  agents.push({
    id: `${sessionId}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
    sessionId,
    subagentType: subagentType || 'general-purpose',
    model: model || 'inherit',
    description: (description || '').slice(0, 120),
    startedAt: Date.now(),
  });
  writeJson(AGENTS_JSON, agents);
}

/** Clear the oldest live agent for a session (SubagentStop carries no id). */
export function clearAgent(sessionId) {
  const agents = readJson(AGENTS_JSON, []);
  const idx = agents.findIndex((a) => a.sessionId === sessionId);
  if (idx !== -1) agents.splice(idx, 1);
  writeJson(AGENTS_JSON, agents);
}

export function clearSessionAgents(sessionId) {
  writeJson(AGENTS_JSON, readJson(AGENTS_JSON, []).filter((a) => a.sessionId !== sessionId));
}

export function readAgents() {
  const live = new Set(readSessions().map((s) => s.sessionId));
  const cutoff = Date.now() - 3600 * 1000;
  const agents = readJson(AGENTS_JSON, []).filter(
    // Drop agents whose session died and any that outlived a plausible run,
    // so a missed SubagentStop cannot leave a ghost on the board forever.
    (a) => live.has(a.sessionId) && a.startedAt > cutoff,
  );
  return agents;
}

export function refreshSessions() {
  const sessions = readSessions();
  writeJson(SESSIONS_JSON, { at: Date.now(), sessions });
  return sessions;
}
