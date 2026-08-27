import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const stopJs = fileURLToPath(new URL('../skills/quarterdeck-stop/stop.js', import.meta.url));
const skillMd = fileURLToPath(new URL('../skills/quarterdeck-stop/SKILL.md', import.meta.url));

test('stop.js reports not running when no server is up', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qd-stop-'));
  const result = spawnSync(process.execPath, [stopJs], {
    encoding: 'utf8',
    env: { ...process.env, QD_HOME: tmp },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /not running/);
});

test('quarterdeck-stop skill is a user-only slash command that runs stop.js', () => {
  const text = fs.readFileSync(skillMd, 'utf8');
  assert.match(text, /^disable-model-invocation:\s*true$/m);
  assert.match(text, /\/quarterdeck-stop/);
  assert.match(text, /node \$\{CLAUDE_SKILL_DIR\}\/stop\.js/);
  assert.doesNotMatch(text, /\/quarterdeck stop/);
});
