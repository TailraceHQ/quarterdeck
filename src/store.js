import fs from 'node:fs';
import path from 'node:path';
import { TASKS_MD, ARCHIVE_MD, INBOX_JSONL, COUNTER, LOCK, ensureDirs, config } from './paths.js';

export const PRIORITIES = ['P1', 'P2', 'P3', 'P4'];
export const STATUSES = ['queued', 'active', 'blocked', 'review', 'done', 'cancelled'];

/** Fields we understand. Unknown keys are preserved verbatim wherever they sit. */
export const KNOWN_FIELDS = [
  'prio',
  'status',
  'repo',
  'session',
  'opened',
  'updated',
  'next',
  'blocked-on',
  'blocks',
  'tags',
];

const HEADING = /^##\s+(T-\d+)(?:\s*·\s*(.*))?$/;
const FIELD = /^-\s+([a-z][a-z0-9-]*)\s*:\s*(.*)$/;

export function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// ---------------------------------------------------------------- locking

/**
 * Exclusive lock via O_EXCL create. Two sessions can allocate ids or rewrite
 * tasks.md concurrently, and a torn write there costs the user real state.
 */
export function withLock(fn) {
  ensureDirs();
  const deadline = Date.now() + 5000;
  let fd = null;
  for (;;) {
    try {
      fd = fs.openSync(LOCK, 'wx');
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      // Reap a lock left behind by a crashed process.
      try {
        if (Date.now() - fs.statSync(LOCK).mtimeMs > 10000) fs.unlinkSync(LOCK);
      } catch {
        /* raced with the holder; just retry */
      }
      if (Date.now() > deadline) throw new Error('quarterdeck: timed out waiting for state lock');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try {
    return fn();
  } finally {
    try {
      fs.closeSync(fd);
      fs.unlinkSync(LOCK);
    } catch {
      /* already gone */
    }
  }
}

function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

// ---------------------------------------------------------------- parsing

/**
 * Parse tasks.md into blocks. Each block retains its raw tail (`rest`) exactly
 * as written, so hand-authored prose survives every programmatic write.
 */
export function parse(text) {
  const lines = text.split('\n');
  const preamble = [];
  const tasks = [];
  let cur = null;

  for (const line of lines) {
    const h = HEADING.exec(line);
    if (h) {
      if (cur) tasks.push(cur);
      cur = { id: h[1], title: (h[2] || '').trim(), fields: [], rest: [], _inFields: true };
      continue;
    }
    if (!cur) {
      preamble.push(line);
      continue;
    }
    if (cur._inFields) {
      const f = FIELD.exec(line);
      if (f) {
        cur.fields.push({ key: f[1], value: f[2].trim() });
        continue;
      }
      // A blank line between fields is tolerated; anything else ends the block.
      if (line.trim() === '' && cur.fields.length === 0) continue;
      cur._inFields = false;
    }
    cur.rest.push(line);
  }
  if (cur) tasks.push(cur);

  for (const t of tasks) {
    delete t._inFields;
    // Trim blank lines bounding the tail; serialize re-inserts the single
    // separator blank. Interior spacing is the author's and is left alone.
    while (t.rest.length && t.rest[t.rest.length - 1].trim() === '') t.rest.pop();
    while (t.rest.length && t.rest[0].trim() === '') t.rest.shift();
    t.get = (k) => t.fields.find((f) => f.key === k)?.value ?? '';
  }
  return { preamble, tasks };
}

export function serialize(doc) {
  const out = [];
  const pre = [...doc.preamble];
  while (pre.length && pre[pre.length - 1].trim() === '') pre.pop();
  if (pre.length) out.push(pre.join('\n'), '');

  for (const t of doc.tasks) {
    out.push(`## ${t.id}${t.title ? ` · ${t.title}` : ''}`);
    for (const f of t.fields) out.push(`- ${f.key}: ${f.value}`);
    if (t.rest.length) {
      out.push('');
      out.push(t.rest.join('\n'));
    }
    out.push('');
  }
  return `${out.join('\n').replace(/\n{3,}$/, '\n\n').trimEnd()}\n`;
}

const HEADER = `<!-- Quarterdeck task board. Hand-edits are preserved: programmatic writes
     only touch the "- key: value" lines and append under "### Log". -->\n`;

export function readDoc(file = TASKS_MD) {
  ensureDirs();
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    text = HEADER;
  }
  return parse(text);
}

export function writeDoc(doc, file = TASKS_MD) {
  ensureDirs();
  writeAtomic(file, serialize(doc));
}

// ---------------------------------------------------------------- mutation

function setField(task, key, value) {
  const existing = task.fields.find((f) => f.key === key);
  if (value === null || value === undefined || value === '') {
    if (existing) task.fields = task.fields.filter((f) => f !== existing);
    return;
  }
  if (existing) existing.value = String(value);
  else task.fields.push({ key, value: String(value) });
}

export function appendLog(task, who, message) {
  const stamp = nowIso().slice(11, 16);
  const entry = `- ${stamp} · ${who} · ${message.replace(/\n+/g, ' ').trim()}`;
  const idx = task.rest.findIndex((l) => /^###\s+Log\s*$/i.test(l));
  if (idx === -1) {
    if (task.rest.length) task.rest.push('');
    task.rest.push('### Log', entry);
  } else {
    task.rest.push(entry);
  }
}

function nextId() {
  let n = 0;
  try {
    n = parseInt(fs.readFileSync(COUNTER, 'utf8').trim(), 10) || 0;
  } catch {
    // First task; also recover the high-water mark from the file itself so a
    // deleted counter cannot hand out an id that is already in use.
  }
  for (const t of readDoc().tasks) {
    const v = parseInt(t.id.slice(2), 10);
    if (v > n) n = v;
  }
  for (const t of readDoc(ARCHIVE_MD).tasks) {
    const v = parseInt(t.id.slice(2), 10);
    if (v > n) n = v;
  }
  const id = n + 1;
  writeAtomic(COUNTER, String(id));
  return `T-${String(id).padStart(4, '0')}`;
}

/** Infer the repo name from a cwd inside ~/dev (or any git-ish checkout). */
export function repoForCwd(cwd) {
  if (!cwd) return '';
  const parts = cwd.split(path.sep).filter(Boolean);
  const devIdx = parts.lastIndexOf('dev');
  if (devIdx !== -1 && parts[devIdx + 1]) return parts[devIdx + 1];
  return parts[parts.length - 1] || '';
}

export function addTask({ title, prio, status = 'queued', repo = '', session = '', next = '', blocks = '', tags = '' }) {
  if (!title || !title.trim()) throw new Error('a task needs a title');
  return withLock(() => {
    const doc = readDoc();
    const id = nextId();
    const task = { id, title: title.trim(), fields: [], rest: [] };

    let priority = prio;
    // P1 escalation rule: blocking another open board task earns P1 on its own.
    if (blocks && (!priority || priority === 'P2')) {
      const open = new Set(doc.tasks.filter((t) => isOpen(t)).map((t) => t.id));
      if (blocks.split(/[,\s]+/).filter(Boolean).some((b) => open.has(b))) priority = 'P1';
    }
    priority = priority || 'P2';
    if (!PRIORITIES.includes(priority)) throw new Error(`bad priority ${priority}`);
    if (!STATUSES.includes(status)) throw new Error(`bad status ${status}`);

    const stamp = nowIso();
    setField(task, 'prio', priority);
    setField(task, 'status', status);
    if (repo) setField(task, 'repo', repo);
    if (session) setField(task, 'session', session);
    setField(task, 'opened', stamp);
    setField(task, 'updated', stamp);
    if (next) setField(task, 'next', next);
    if (blocks) setField(task, 'blocks', blocks);
    if (tags) setField(task, 'tags', tags);

    doc.tasks.push(task);
    writeDoc(doc);
    return { ...task, get: (k) => task.fields.find((f) => f.key === k)?.value ?? '' };
  });
}

export function updateTask(id, patch, { who = 'agent', logMessage = '' } = {}) {
  return withLock(() => {
    const doc = readDoc();
    const task = doc.tasks.find((t) => t.id === id);
    if (!task) throw new Error(`no such task ${id}`);

    if (patch.prio && !PRIORITIES.includes(patch.prio)) throw new Error(`bad priority ${patch.prio}`);
    if (patch.status && !STATUSES.includes(patch.status)) throw new Error(`bad status ${patch.status}`);
    if (patch.status === 'blocked' && !patch['blocked-on'] && !task.get('blocked-on')) {
      throw new Error('status=blocked requires --blocked-on (use "you" if it needs the user)');
    }

    const changes = [];
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      const before = task.fields.find((f) => f.key === k)?.value ?? '';
      if (String(before) === String(v)) continue;
      setField(task, k, v);
      if (k !== 'updated') changes.push(`${k}: ${before || '—'} → ${v || '—'}`);
    }
    if (patch.title) task.title = patch.title.trim();
    // Leaving `blocked` should clear the stale reason rather than stranding it.
    if (patch.status && patch.status !== 'blocked') setField(task, 'blocked-on', null);
    setField(task, 'updated', nowIso());

    if (logMessage) appendLog(task, who, logMessage);
    else if (changes.length) appendLog(task, who, changes.join('; '));

    writeDoc(doc);
    return task;
  });
}

export function logTask(id, message, who = 'agent') {
  return withLock(() => {
    const doc = readDoc();
    const task = doc.tasks.find((t) => t.id === id);
    if (!task) throw new Error(`no such task ${id}`);
    appendLog(task, who, message);
    setField(task, 'updated', nowIso());
    writeDoc(doc);
    return task;
  });
}

export function isOpen(task) {
  const s = task.get ? task.get('status') : '';
  return s !== 'done' && s !== 'cancelled';
}

export function listTasks({ open = false, repo = '', prio = '' } = {}) {
  let tasks = readDoc().tasks;
  if (open) tasks = tasks.filter(isOpen);
  if (repo) tasks = tasks.filter((t) => t.get('repo').toLowerCase() === repo.toLowerCase());
  if (prio) tasks = tasks.filter((t) => t.get('prio') === prio);
  return tasks.sort(
    (a, b) => a.get('prio').localeCompare(b.get('prio')) || b.get('updated').localeCompare(a.get('updated')),
  );
}

export function toJSON(task) {
  const o = { id: task.id, title: task.title };
  for (const f of task.fields) o[f.key] = f.value;
  const idx = task.rest.findIndex((l) => /^###\s+Log\s*$/i.test(l));
  o.notes = (idx === -1 ? task.rest : task.rest.slice(0, idx)).join('\n').trim();
  o.log = idx === -1 ? [] : task.rest.slice(idx + 1).filter((l) => l.trim());
  return o;
}

// ---------------------------------------------------------------- archive

/**
 * Move closed tasks, and answered P4 lookups past their TTL, into archive.md so
 * the board stays scannable without losing the record.
 */
export function archiveSweep() {
  return withLock(() => {
    const cfg = config();
    const doc = readDoc();
    const archive = readDoc(ARCHIVE_MD);
    const cutoff = Date.now() - cfg.lookupTtlHours * 3600 * 1000;
    const keep = [];
    const moved = [];
    for (const t of doc.tasks) {
      const status = t.get('status');
      const closed = status === 'done' || status === 'cancelled';
      const updated = Date.parse(t.get('updated') || '') || Date.now();
      const staleLookup = t.get('prio') === 'P4' && closed;
      if (closed && (staleLookup || updated < cutoff)) moved.push(t);
      else keep.push(t);
    }
    if (!moved.length) return [];
    doc.tasks = keep;
    archive.tasks.push(...moved);
    writeDoc(archive, ARCHIVE_MD);
    writeDoc(doc);
    return moved.map((t) => t.id);
  });
}

// ---------------------------------------------------------------- inbox

export function pushInbox(event) {
  ensureDirs();
  const row = { ts: nowIso(), read: false, ...event };
  fs.appendFileSync(INBOX_JSONL, `${JSON.stringify(row)}\n`);
  return row;
}

export function readInbox({ unreadOnly = true, markRead = false } = {}) {
  ensureDirs();
  let rows = [];
  try {
    rows = fs
      .readFileSync(INBOX_JSONL, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
  const selected = unreadOnly ? rows.filter((r) => !r.read) : rows;
  if (markRead && selected.length) {
    withLock(() => {
      for (const r of rows) r.read = true;
      writeAtomic(INBOX_JSONL, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
    });
  }
  return selected;
}
