import { listTasks, readInbox, toJSON, archiveSweep, updateTask } from './store.js';
import { recordAgent, clearAgent, clearSessionAgents, refreshSessions } from './snapshot.js';
import { config, TASKS_MD } from './paths.js';
import { ruleset } from './rules.js';

function readStdin() {
  return new Promise((resolve) => {
    let buf = '';
    if (process.stdin.isTTY) return resolve({});
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (buf += c));
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(buf || '{}'));
      } catch {
        resolve({});
      }
    });
    process.stdin.on('error', () => resolve({}));
  });
}

function emit(eventName, additionalContext) {
  if (!additionalContext) return;
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: eventName, additionalContext } }),
  );
}

/** One scannable line per task, cheap enough to inject on every session. */
function digest(tasks) {
  if (!tasks.length) return '_Board is empty._';
  const rows = tasks.map((t) => {
    const j = toJSON(t);
    const bits = [`${j.id} [${j.prio}/${j.status}]`];
    if (j.repo) bits.push(`(${j.repo})`);
    bits.push(j.title);
    if (j.status === 'blocked' && j['blocked-on']) bits.push(`— blocked on ${j['blocked-on']}`);
    else if (j.next) bits.push(`— next: ${j.next}`);
    return `- ${bits.join(' ')}`;
  });
  return rows.join('\n');
}

function inboxBlock(rows) {
  if (!rows.length) return '';
  const lines = rows.map((r) => {
    const who = r.task ? `on ${r.task}` : 'on the board';
    if (r.kind === 'reply') return `- ${who}: "${r.text}"`;
    if (r.kind === 'status') return `- ${who}: the user set status to \`${r.value}\``;
    if (r.kind === 'prio') return `- ${who}: the user set priority to \`${r.value}\``;
    if (r.kind === 'new') return `- the user added ${r.task}: "${r.text}"`;
    return `- ${who}: ${r.text || r.value || ''}`;
  });
  return [
    '',
    '## From the board — the user acted on these since your last turn',
    '',
    ...lines,
    '',
    'Treat these as the user speaking to you directly. Act on them, or say why you are not.',
  ].join('\n');
}

export async function runHook(event) {
  const input = await readStdin();
  const sessionId = input.session_id || '';
  const cfg = config();

  switch (event) {
    case 'session-start': {
      archiveSweep();
      refreshSessions();
      const open = listTasks({ open: true });
      const pending = readInbox({ markRead: true });
      emit(
        'SessionStart',
        [
          ruleset(cfg.port, TASKS_MD),
          '',
          `## Board right now (${open.length} open)`,
          '',
          digest(open),
          inboxBlock(pending),
        ].join('\n'),
      );
      break;
    }

    case 'prompt': {
      refreshSessions();
      const pending = readInbox({ markRead: true });
      const block = inboxBlock(pending);
      // Only speak up when there is something new; a per-turn reminder would
      // be pure context tax.
      emit('UserPromptSubmit', block ? block.trim() : '');
      break;
    }

    case 'subagent-start': {
      if (input.tool_name === 'Task') {
        recordAgent({
          sessionId,
          subagentType: input.tool_input?.subagent_type,
          model: input.tool_input?.model,
          description: input.tool_input?.description,
        });
      }
      break;
    }

    case 'subagent-stop':
      clearAgent(sessionId);
      break;

    case 'turn-end':
      refreshSessions();
      break;

    case 'session-end': {
      clearSessionAgents(sessionId);
      refreshSessions();
      // An `active` task whose session is gone is no longer being worked on.
      for (const t of listTasks({ open: true })) {
        if (t.get('session') === sessionId && t.get('status') === 'active') {
          try {
            updateTask(t.id, { status: 'queued' }, { logMessage: 'session ended; back to queued' });
          } catch {
            /* board must never block a shutdown */
          }
        }
      }
      break;
    }

    default:
      break;
  }
}

export { digest };
