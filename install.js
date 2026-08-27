#!/usr/bin/env node
/**
 * Wires quarterdeck into Claude Code: symlinks the skills, registers the hooks,
 * and puts `qd` on PATH. Idempotent - safe to re-run after a git pull.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { CLAUDE_HOME, ensureDirs, config } from './src/paths.js';

const REPO = path.dirname(fileURLToPath(import.meta.url));
const QD = path.join(REPO, 'bin', 'qd.js');
const SETTINGS = path.join(CLAUDE_HOME, 'settings.json');
const uninstall = process.argv.includes('--uninstall');

const HOOK_EVENTS = [
  ['SessionStart', undefined, 'session-start'],
  ['UserPromptSubmit', undefined, 'prompt'],
  ['PreToolUse', 'Task', 'subagent-start'],
  ['SubagentStop', undefined, 'subagent-stop'],
  ['Stop', undefined, 'turn-end'],
  ['SessionEnd', undefined, 'session-end'],
];

const command = (event) => `"${process.execPath}" "${QD}" hook ${event}`;
const isOurs = (h) => typeof h?.command === 'string' && h.command.includes('qd.js') && h.command.includes(' hook ');

function backup(file) {
  if (!fs.existsSync(file)) return;
  const dir = path.join(CLAUDE_HOME, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `settings.json.qd-${Date.now()}`);
  fs.copyFileSync(file, dest);
  console.log(`  backed up settings.json → ${dest}`);
}

function patchSettings() {
  let settings = {};
  if (fs.existsSync(SETTINGS)) {
    try {
      settings = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
    } catch (err) {
      console.error(`  ! settings.json is not valid JSON (${err.message}); leaving it untouched.`);
      return false;
    }
    backup(SETTINGS);
  }
  settings.hooks ||= {};

  for (const [event, matcher, name] of HOOK_EVENTS) {
    const groups = (settings.hooks[event] ||= []);
    // Drop any previous quarterdeck entry so re-running cannot duplicate hooks.
    for (const g of groups) if (Array.isArray(g.hooks)) g.hooks = g.hooks.filter((h) => !isOurs(h));
    settings.hooks[event] = groups.filter((g) => (g.hooks || []).length);
    if (uninstall) continue;

    const entry = { type: 'command', command: command(name) };
    const existing = settings.hooks[event].find((g) => (g.matcher ?? '') === (matcher ?? ''));
    if (existing) existing.hooks.push(entry);
    else settings.hooks[event].push(matcher ? { matcher, hooks: [entry] } : { hooks: [entry] });
  }

  for (const [event] of HOOK_EVENTS) if (!settings.hooks[event]?.length) delete settings.hooks[event];
  if (!Object.keys(settings.hooks).length) delete settings.hooks;

  fs.writeFileSync(SETTINGS, `${JSON.stringify(settings, null, 2)}\n`);
  return true;
}

const SKILLS = ['quarterdeck'];
const RETIRED_SKILLS = ['quarterdeck-stop'];

function unlinkRetired() {
  for (const name of RETIRED_SKILLS) {
    const dest = path.join(CLAUDE_HOME, 'skills', name);
    try {
      fs.lstatSync(dest);
      fs.rmSync(dest, { recursive: true, force: true });
      console.log(`  skill    ${name.padEnd(18)} removed`);
    } catch {
      /* nothing there */
    }
  }
}

function linkSkill(name) {
  const dir = path.join(CLAUDE_HOME, 'skills');
  const dest = path.join(dir, name);
  fs.mkdirSync(dir, { recursive: true });
  try {
    if (fs.lstatSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
  } catch {
    /* nothing there yet */
  }
  if (uninstall) return null;
  fs.symlinkSync(path.join(REPO, 'skills', name), dest, 'dir');
  return dest;
}

function linkBin() {
  const dir = path.join(os.homedir(), '.local', 'bin');
  const dest = path.join(dir, 'qd');
  try {
    fs.mkdirSync(dir, { recursive: true });
    try {
      fs.unlinkSync(dest);
    } catch {
      /* nothing there yet */
    }
    if (uninstall) return null;
    fs.symlinkSync(QD, dest);
    return dest;
  } catch {
    return null;
  }
}

ensureDirs();
console.log(uninstall ? 'Removing quarterdeck…' : 'Installing quarterdeck…');
unlinkRetired();
for (const name of SKILLS) {
  const skill = linkSkill(name);
  console.log(`  skill    ${name.padEnd(18)} ${skill || 'removed'}`);
}
const bin = linkBin();
console.log(`  cli      ${bin || 'removed'}`);
const ok = patchSettings();
console.log(`  hooks    ${ok ? (uninstall ? 'removed from' : 'registered in') + ' ' + SETTINGS : 'SKIPPED'}`);

if (!uninstall) {
  const onPath = (process.env.PATH || '').split(':').includes(path.join(os.homedir(), '.local', 'bin'));
  console.log(`\nDone. Board: http://localhost:${config().port}`);
  console.log('Start it with:  qd serve   (then `qd open`)');
  console.log('Stop it with:   qd stop    (or /quarterdeck stop in Claude Code)');
  if (!onPath) console.log('\nNote: ~/.local/bin is not on your PATH. Add it, or call bin/qd.js directly.');
  console.log('Restart Claude Code so the new hooks and slash commands load.');
}
