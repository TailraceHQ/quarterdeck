#!/usr/bin/env node
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import {
  addTask,
  updateTask,
  logTask,
  listTasks,
  toJSON,
  readInbox,
  archiveSweep,
  repoForCwd,
} from '../src/store.js';
import { refreshSessions, readAgents } from '../src/snapshot.js';
import { runHook } from '../src/hooks.js';
import { config, SERVER_PID, SERVER_LOG, TASKS_MD, QD_HOME, ensureDirs } from '../src/paths.js';

const argv = process.argv.slice(2);
const cmd = argv[0];

/** Minimal flag parser: --key value, --key=value, and bare positionals. */
function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else if (args[i + 1] && !args[i + 1].startsWith('--')) flags[a.slice(2)] = args[++i];
      else flags[a.slice(2)] = true;
    } else positional.push(a);
  }
  return { flags, positional };
}

const HELP = `quarterdeck — a live task board for the orchestrator

  qd add "<title>" [--prio P1|P2|P3|P4] [--repo <name>] [--next "..."]
                   [--blocks <id>] [--status <s>] [--session <id>] [--tags a,b]
      Open a task. Priority defaults to P2; pass --prio P3 for an investigation
      and --prio P4 for a one-off lookup. --blocks <open id> escalates to P1.
      --repo defaults to the current directory's project.

  qd set <id> [--status queued|active|blocked|review|done|cancelled]
              [--prio P1..P4] [--next "..."] [--blocked-on <what>]
              [--repo <name>] [--title "..."]
      Update a task. --status blocked requires --blocked-on; use "you" when it
      needs the user, which surfaces it in the board's "Needs you" section.

  qd log <id> "<message>"        Append one line to a task's log.
  qd list [--open] [--repo X] [--prio P1] [--json]
                                 List tasks (default: all, newest first).
  qd show <id> [--json]          One task in full.
  qd inbox [--json] [--peek]     Board actions you have not seen yet.
                                 Marks them read unless --peek.
  qd agents                      Subagents currently running.

  qd serve [--port N] [--foreground]   Start the board server (detached by default).
  qd open                              Ensure the server, then open a browser.
  qd stop                              Stop the server.
  qd status                            Where things stand.
  qd snapshot                          Refresh session/context telemetry.
  qd archive                           Sweep closed work into archive.md.
  qd hook <event>                      Internal: Claude Code hook handlers.

State: ${TASKS_MD}`;

function fail(msg) {
  process.stderr.write(`qd: ${msg}\n`);
  process.exit(1);
}

function readPid() {
  try {
    const pid = Number(fs.readFileSync(SERVER_PID, 'utf8').trim());
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

function line(t) {
  const j = toJSON(t);
  const tail =
    j.status === 'blocked' && j['blocked-on']
      ? `blocked on ${j['blocked-on']}`
      : j.next || '';
  return [
    j.id.padEnd(7),
    (j.prio || '--').padEnd(3),
    (j.status || '').padEnd(9),
    (j.repo || '—').padEnd(14),
    j.title,
    tail ? `\n${' '.repeat(36)}↳ ${tail}` : '',
  ].join(' ');
}

async function main() {
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  const { flags, positional } = parseFlags(argv.slice(1));

  switch (cmd) {
    case 'add': {
      const title = positional.join(' ');
      if (!title) fail('add needs a title');
      const t = addTask({
        title,
        prio: flags.prio,
        status: flags.status || 'queued',
        repo: flags.repo || repoForCwd(process.cwd()),
        session: flags.session || process.env.CLAUDE_SESSION_ID || '',
        next: flags.next === true ? '' : flags.next || '',
        blocks: flags.blocks === true ? '' : flags.blocks || '',
        tags: flags.tags === true ? '' : flags.tags || '',
      });
      process.stdout.write(`${t.id}  ${t.get('prio')}  ${title}\n`);
      break;
    }

    case 'set': {
      const id = positional[0];
      if (!id) fail('set needs a task id');
      const patch = {};
      for (const k of ['status', 'prio', 'next', 'blocked-on', 'repo', 'blocks', 'tags', 'title', 'session']) {
        if (flags[k] !== undefined) patch[k] = flags[k] === true ? '' : flags[k];
      }
      if (!Object.keys(patch).length) fail('set needs at least one field to change');
      const t = updateTask(id, patch, { who: flags.who || 'agent' });
      process.stdout.write(`${t.id}  ${t.get('prio')}  ${t.get('status')}  ${t.title}\n`);
      break;
    }

    case 'log': {
      const id = positional[0];
      const msg = positional.slice(1).join(' ');
      if (!id || !msg) fail('log needs a task id and a message');
      logTask(id, msg, flags.who || 'agent');
      process.stdout.write(`logged on ${id}\n`);
      break;
    }

    case 'list': {
      const tasks = listTasks({ open: !!flags.open, repo: flags.repo, prio: flags.prio });
      if (flags.json) {
        process.stdout.write(`${JSON.stringify(tasks.map(toJSON), null, 2)}\n`);
        break;
      }
      if (!tasks.length) {
        process.stdout.write('No tasks.\n');
        break;
      }
      process.stdout.write(`${tasks.map(line).join('\n')}\n`);
      break;
    }

    case 'show': {
      const t = listTasks().find((x) => x.id === positional[0]);
      if (!t) fail(`no such task ${positional[0]}`);
      if (flags.json) process.stdout.write(`${JSON.stringify(toJSON(t), null, 2)}\n`);
      else {
        const j = toJSON(t);
        process.stdout.write(`## ${j.id} · ${j.title}\n`);
        for (const [k, v] of Object.entries(j)) {
          if (['id', 'title', 'notes', 'log'].includes(k)) continue;
          process.stdout.write(`  ${k}: ${v}\n`);
        }
        if (j.notes) process.stdout.write(`\n${j.notes}\n`);
        if (j.log.length) process.stdout.write(`\nLog:\n${j.log.join('\n')}\n`);
      }
      break;
    }

    case 'inbox': {
      const rows = readInbox({ markRead: !flags.peek });
      if (flags.json) {
        process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
        break;
      }
      if (!rows.length) {
        process.stdout.write('Nothing new from the board.\n');
        break;
      }
      for (const r of rows) {
        process.stdout.write(`${r.ts}  ${r.task || '—'}  ${r.kind}: ${r.text || r.value}\n`);
      }
      break;
    }

    case 'agents': {
      const agents = readAgents();
      if (!agents.length) {
        process.stdout.write('No subagents running.\n');
        break;
      }
      for (const a of agents) {
        process.stdout.write(`${a.subagentType}  ${a.model}  ${a.description}\n`);
      }
      break;
    }

    case 'snapshot': {
      const s = refreshSessions();
      process.stdout.write(`${s.length} live session(s)\n`);
      for (const x of s) {
        process.stdout.write(`  ${x.name}  ${x.repo || x.cwd}  ${x.status}  ${x.contextPct}% context\n`);
      }
      break;
    }

    case 'archive': {
      const moved = archiveSweep();
      process.stdout.write(moved.length ? `archived ${moved.join(', ')}\n` : 'nothing to archive\n');
      break;
    }

    case 'serve': {
      const port = Number(flags.port) || config().port;
      if (flags.foreground) {
        const { start } = await import('../src/server.js');
        const { url } = await start({ port });
        process.stdout.write(`quarterdeck listening on ${url}\n`);
        return;
      }
      const existing = readPid();
      if (existing) {
        process.stdout.write(`already running (pid ${existing}) on http://localhost:${port}\n`);
        break;
      }
      ensureDirs();
      const out = fs.openSync(SERVER_LOG, 'a');
      const child = spawn(process.execPath, [new URL(import.meta.url).pathname, 'serve', '--foreground', '--port', String(port)], {
        detached: true,
        stdio: ['ignore', out, out],
        env: process.env,
      });
      child.unref();
      process.stdout.write(`quarterdeck starting on http://localhost:${port} (log: ${SERVER_LOG})\n`);
      break;
    }

    case 'open': {
      const port = Number(flags.port) || config().port;
      if (!readPid()) {
        spawn(process.execPath, [new URL(import.meta.url).pathname, 'serve', '--port', String(port)], {
          stdio: 'ignore',
        }).unref();
        await new Promise((r) => setTimeout(r, 600));
      }
      const url = `http://localhost:${port}`;
      const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
      spawn(opener, [url], { stdio: 'ignore', detached: true }).unref();
      process.stdout.write(`${url}\n`);
      break;
    }

    case 'stop': {
      const pid = readPid();
      if (!pid) {
        process.stdout.write('not running\n');
        break;
      }
      process.kill(pid);
      try {
        fs.unlinkSync(SERVER_PID);
      } catch {
        /* already gone */
      }
      process.stdout.write(`stopped (pid ${pid})\n`);
      break;
    }

    case 'status': {
      const pid = readPid();
      const open = listTasks({ open: true });
      const needsYou = open.filter((t) => t.get('status') === 'blocked' && t.get('blocked-on') === 'you');
      process.stdout.write(
        [
          `home     ${QD_HOME}`,
          `server   ${pid ? `running (pid ${pid}) http://localhost:${config().port}` : 'stopped'}`,
          `open     ${open.length} task(s), ${open.filter((t) => t.get('prio') === 'P1').length} P1`,
          `needs you ${needsYou.length}`,
          `sessions ${refreshSessions().length} live`,
          `agents   ${readAgents().length} running`,
        ].join('\n') + '\n',
      );
      break;
    }

    case 'hook': {
      try {
        await runHook(positional[0]);
      } catch {
        // A hook must never fail a turn.
      }
      process.exit(0);
      break;
    }

    default:
      fail(`unknown command "${cmd}" — try qd --help`);
  }
}

main().catch((err) => fail(err.message));
