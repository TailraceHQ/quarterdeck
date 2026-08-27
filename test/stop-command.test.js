import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const stopIfJs = fileURLToPath(new URL('../skills/quarterdeck/stop-if.js', import.meta.url));
const skillMd = fileURLToPath(new URL('../skills/quarterdeck/SKILL.md', import.meta.url));

function runStopIf(args, env) {
  return spawnSync(process.execPath, [stopIfJs, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('stop-if.js is a no-op unless the first argument is stop', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qd-stop-'));
  const env = { QD_HOME: tmp };
  const skipped = runStopIf(['reconcile'], env);
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.equal(skipped.stdout, '');

  const stopped = runStopIf(['stop'], env);
  assert.equal(stopped.status, 0, stopped.stderr);
  assert.match(stopped.stdout, /not running/);
});

test('quarterdeck skill documents /quarterdeck stop and injects stop-if.js', () => {
  const text = fs.readFileSync(skillMd, 'utf8');
  assert.match(text, /argument-hint: "\[stop /);
  assert.match(text, /\/quarterdeck stop/);
  assert.match(text, /node \$\{CLAUDE_SKILL_DIR\}\/stop-if\.js \$ARGUMENTS/);
  assert.match(text, /There is no `\/quarterdeck-stop` command/);
});
