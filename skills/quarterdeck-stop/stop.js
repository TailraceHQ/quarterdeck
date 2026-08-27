#!/usr/bin/env node
/**
 * Resolves the repo's `qd` even when this skill is reached through the
 * ~/.claude/skills symlink, then runs `qd stop`.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const result = spawnSync(process.execPath, [path.join(repo, 'bin', 'qd.js'), 'stop'], {
  encoding: 'utf8',
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
