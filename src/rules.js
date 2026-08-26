/**
 * Layer A of the instruction set: injected into every session by the
 * SessionStart hook. This is what makes board upkeep automatic rather than
 * something the user has to ask for. Keep it tight - it costs context on
 * every single session.
 */
export const RULESET = `# Quarterdeck board — standing instructions

A live task board tracks every task the user has given you, across every repo.
It is at http://localhost:{{PORT}} and its state is {{TASKS_MD}}.
Write to it with the \`qd\` CLI. Never hand-edit the markdown.

## When to write (these are triggers, not suggestions)

- **Accepting work** → \`qd add "<title>" --prio <P> --repo <repo>\` BEFORE you start. Report the id you get back.
- **Starting** → \`qd set <id> --status active\`
- **You need something only the user can give** (a credential, a decision, an
  answer, access) → \`qd set <id> --status blocked --blocked-on you --next "<what you need>"\`.
  This is what puts it in the board's "Needs you" section. Do this instead of
  silently stalling.
- **Blocked on something else** → \`qd set <id> --status blocked --blocked-on "<what>"\`
- **Finished** → \`qd set <id> --status review --next "<what the user should verify>"\`.
  Never set \`done\` yourself; closing a task is the user's call from the board.
- **Meaningful progress or a finding worth remembering** → \`qd log <id> "<one line>"\`.
  Not every tool call — only what a person would want in a status update.
- **Before you end a turn**, if \`next:\` no longer describes the true state of a
  task you touched, refresh it: \`qd set <id> --next "..."\`. That field is what
  lets the user (and a future you) resume cold, so write it in plain words.

## Priority

Assign at creation time:

- **P2** — default for any bug fix or feature.
- **P3** — investigate / diagnose / "why is X happening", with no fix requested yet.
- **P4** — a single question-answer lookup. Log it, answer it, \`qd set <id> --status review\`.
- **P1** — only when one of these is true: the user said so ("p1", "urgent",
  "drop everything"); the task blocks another open board task (pass \`--blocks <id>\`
  and it escalates on its own); or it is production-breaking — broken build,
  failed deploy, outage, data loss, or a security issue.

Never lower a priority the user set by hand. If you think it is wrong, say so and ask.

## Rules

- One task per thing the user asked for. Don't split your own implementation
  steps into board tasks — those belong in your todo list, not here.
- If the user's request obviously continues an existing open task, \`qd log\` it
  rather than opening a duplicate. \`qd list --open\` first if unsure.
- Titles are what the user would call it, not internal jargon.
- **Never** put secrets, credentials, tokens, or file contents on the board. It
  renders in a browser.
- The board is state, not conversation. Keep entries to one scannable line.
- If \`qd\` fails, mention it once and carry on — the board must never block work.`;

export function ruleset(port, tasksMd) {
  return RULESET.replace('{{PORT}}', String(port)).replace('{{TASKS_MD}}', tasksMd);
}
