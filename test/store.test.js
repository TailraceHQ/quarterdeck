import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qd-test-'));
process.env.QD_HOME = tmp;

const { parse, serialize, addTask, updateTask, logTask, listTasks, toJSON, archiveSweep, pushInbox, readInbox } =
  await import('../src/store.js');
const { TASKS_MD } = await import('../src/paths.js');

const HANDWRITTEN = `## T-0001 · Hand written task
- status: active
- prio: P3
- repo: Ciciro
- customfield: something the tool never heard of
- next: keep this

Free prose the user wrote themselves.
It has *markdown* and a [link](https://example.com) and blank lines:

    an indented block

### Log
- 09:00 · you · original note
`;

test('parse/serialize round-trips a hand-written block byte-identically', () => {
  const doc = parse(HANDWRITTEN);
  assert.equal(doc.tasks.length, 1);
  assert.equal(doc.tasks[0].id, 'T-0001');
  assert.equal(doc.tasks[0].title, 'Hand written task');
  assert.equal(serialize(doc), HANDWRITTEN);
});

test('updateTask preserves prose, unknown fields, and field order', () => {
  fs.mkdirSync(path.join(tmp, 'state'), { recursive: true });
  fs.writeFileSync(TASKS_MD, HANDWRITTEN);

  updateTask('T-0001', { status: 'blocked', 'blocked-on': 'you' });
  const after = fs.readFileSync(TASKS_MD, 'utf8');

  assert.match(after, /Free prose the user wrote themselves\./);
  assert.match(after, /    an indented block/);
  assert.match(after, /- customfield: something the tool never heard of/);
  assert.match(after, /- 09:00 · you · original note/);
  // status was first and must stay first; new fields append.
  assert.match(after, /## T-0001 · Hand written task\n- status: blocked\n- prio: P3/);
  assert.match(after, /- blocked-on: you/);
  assert.match(after, /- next: keep this/);
});

test('blocked requires a blocked-on reason', () => {
  fs.writeFileSync(TASKS_MD, HANDWRITTEN);
  assert.throws(() => updateTask('T-0001', { status: 'blocked' }), /requires --blocked-on/);
});

test('leaving blocked clears the stale reason', () => {
  fs.writeFileSync(TASKS_MD, HANDWRITTEN);
  updateTask('T-0001', { status: 'blocked', 'blocked-on': 'you' });
  updateTask('T-0001', { status: 'active' });
  // The field is gone; the audit line in the log legitimately still names it.
  assert.doesNotMatch(fs.readFileSync(TASKS_MD, 'utf8'), /^- blocked-on:/m);
});

test('defaults: a bug fix lands P2, an explicit lookup lands P4', () => {
  fs.writeFileSync(TASKS_MD, '');
  const a = addTask({ title: 'fix login crash', repo: 'corki' });
  assert.equal(a.get('prio'), 'P2');
  assert.equal(a.get('status'), 'queued');
  const b = addTask({ title: 'what port does the server use', prio: 'P4' });
  assert.equal(b.get('prio'), 'P4');
  assert.notEqual(a.id, b.id);
});

test('blocking an open task auto-escalates to P1', () => {
  fs.writeFileSync(TASKS_MD, '');
  const base = addTask({ title: 'ship the release' });
  const blocker = addTask({ title: 'fix the failing build', blocks: base.id });
  assert.equal(blocker.get('prio'), 'P1');
  // Blocking a task that is already closed does not escalate.
  updateTask(base.id, { status: 'done' });
  const late = addTask({ title: 'unrelated', blocks: base.id });
  assert.equal(late.get('prio'), 'P2');
});

test('an explicit priority is never overridden by the blocks rule', () => {
  fs.writeFileSync(TASKS_MD, '');
  const base = addTask({ title: 'ship it' });
  const t = addTask({ title: 'minor', prio: 'P3', blocks: base.id });
  assert.equal(t.get('prio'), 'P3');
});

test('ids never collide after the counter is lost', () => {
  fs.writeFileSync(TASKS_MD, '');
  const a = addTask({ title: 'one' });
  fs.rmSync(path.join(tmp, 'state', '.counter'), { force: true });
  const b = addTask({ title: 'two' });
  assert.notEqual(a.id, b.id);
});

test('logTask appends under an existing Log heading', () => {
  fs.writeFileSync(TASKS_MD, HANDWRITTEN);
  logTask('T-0001', 'reproduced on staging');
  const out = fs.readFileSync(TASKS_MD, 'utf8');
  const idx = out.indexOf('### Log');
  assert.ok(idx > 0);
  assert.ok(out.indexOf('reproduced on staging') > idx);
  assert.equal(out.match(/### Log/g).length, 1);
});

test('logTask creates a Log section when there is none', () => {
  fs.writeFileSync(TASKS_MD, '## T-0002 · bare\n- prio: P2\n- status: queued\n');
  logTask('T-0002', 'first note');
  assert.match(fs.readFileSync(TASKS_MD, 'utf8'), /### Log\n- \d\d:\d\d · agent · first note/);
});

test('archiveSweep moves closed work out and keeps open work', () => {
  fs.writeFileSync(TASKS_MD, '');
  const open = addTask({ title: 'still going' });
  const shut = addTask({ title: 'a lookup', prio: 'P4' });
  updateTask(shut.id, { status: 'done' });
  const moved = archiveSweep();
  assert.deepEqual(moved, [shut.id]);
  const ids = listTasks().map((t) => t.id);
  assert.deepEqual(ids, [open.id]);
  assert.match(fs.readFileSync(path.join(tmp, 'state', 'archive.md'), 'utf8'), /a lookup/);
});

test('inbox marks read only when asked', () => {
  pushInbox({ kind: 'reply', task: 'T-0001', text: 'check mobile too' });
  assert.equal(readInbox().length, 1);
  assert.equal(readInbox().length, 1);
  assert.equal(readInbox({ markRead: true }).length, 1);
  assert.equal(readInbox().length, 0);
});

test('toJSON separates notes from log', () => {
  fs.writeFileSync(TASKS_MD, HANDWRITTEN);
  const j = toJSON(listTasks()[0]);
  assert.equal(j.repo, 'Ciciro');
  assert.match(j.notes, /Free prose/);
  assert.doesNotMatch(j.notes, /### Log/);
  assert.equal(j.log.length, 1);
});
