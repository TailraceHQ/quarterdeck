import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qd-render-test-'));
process.env.CLAUDE_CONFIG_DIR = tmp;
process.env.QD_HOME = path.join(tmp, 'quarterdeck');

const { addTask, listTasks, updateTask } = await import('../src/store.js');
const { boardState, page } = await import('../src/render.js');
const { digest } = await import('../src/hooks.js');
const { ruleset } = await import('../src/rules.js');

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('ruleset substitutes the configured board location', () => {
  const text = ruleset(8123, '/tmp/quarterdeck/tasks.md');

  assert.match(text, /http:\/\/localhost:8123/);
  assert.match(text, /\/tmp\/quarterdeck\/tasks\.md/);
  assert.doesNotMatch(text, /\{\{(?:PORT|TASKS_MD)\}\}/);
});

test('digest summarizes next actions and blockers', () => {
  const next = addTask({ title: 'Document setup', prio: 'P3', repo: 'quarterdeck', next: 'write examples' });
  const blocked = addTask({ title: 'Publish release', repo: 'quarterdeck' });
  updateTask(blocked.id, { status: 'blocked', 'blocked-on': 'you' });

  const text = digest(listTasks());
  assert.match(text, new RegExp(`${next.id} \\[P3/queued\\].*— next: write examples`));
  assert.match(text, new RegExp(`${blocked.id} \\[P2/blocked\\].*— blocked on you`));
});

test('boardState groups tasks into dashboard sections', () => {
  const state = boardState();

  assert.equal(state.needsYou.length, 1);
  assert.equal(state.queued.length, 1);
  assert.equal(state.counts.open, 2);
  assert.equal(state.counts.needsYou, 1);
  assert.deepEqual(state.repos, ['quarterdeck']);
});

test('page embeds the supplied assets without external hosting', () => {
  const html = page('body { color: navy; }', 'window.ready = true;');

  assert.match(html, /<title>Quarterdeck<\/title>/);
  assert.match(html, /<style>body \{ color: navy; \}<\/style>/);
  assert.match(html, /<script type="module">window\.ready = true;<\/script>/);
});

test('dashboard script inlines reply-draft helpers before the board renderer', () => {
  const js = [
    fs.readFileSync(new URL('../web/reply-drafts.js', import.meta.url), 'utf8'),
    fs.readFileSync(new URL('../web/board.js', import.meta.url), 'utf8'),
  ].join('\n');
  const html = page('', js);

  const script = html.match(/<script type="module">([\s\S]*)<\/script>/)[1];
  assert.ok(script.indexOf('export function captureReplyDrafts') < script.indexOf('function render()'));
  assert.match(script, /const drafts = captureReplyDrafts\(board, document\.activeElement\)/);
  assert.match(script, /restoreReplyDrafts\(board, drafts\)/);
});
