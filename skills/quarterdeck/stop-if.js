#!/usr/bin/env node
/**
 * Used by the `/quarterdeck` skill. No-ops unless the first argument is
 * `stop`, so reconcile/add invocations do not kill the server. Resolves
 * the repo `qd` even when the skill is reached through ~/.claude/skills.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2).map((a) => a.trim()).filter(Boolean);
if (args[0] !== 'stop') process.exit(0);

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const result = spawnSync(process.execPath, [path.join(repo, 'bin', 'qd.js'), 'stop'], {
  encoding: 'utf8',
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
