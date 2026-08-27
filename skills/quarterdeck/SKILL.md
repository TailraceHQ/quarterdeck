---
name: quarterdeck
description: >-
  The live task board that tracks every task the user has given you, across every repo, with
  priorities, statuses, and a reply channel from the dashboard. Use when the user invokes /board,
  asks where something stands, asks what is in flight or what needs them, says to add/reopen/close
  or re-prioritise a task, or when you need to reconcile the board after doing work outside it.
  The board's write triggers are already injected at session start; load this for the full contract.
user-invocable: true
metadata:
  argument-hint: "[reconcile | add <title> | <question about board state>]"
---

# quarterdeck

The board is the user's memory across sessions. They run many projects at once and lose the thread
between them; the board is what makes a cold resume possible. Treat every entry as something they
will read days later with no other context.

State lives in `~/.claude/quarterdeck/state/tasks.md` and is served at `http://localhost:7337`.
**Always write through the `qd` CLI, never by editing the markdown.** The CLI locks, validates,
allocates ids, and preserves the user's own hand-edits; a direct write does none of that.

Run `qd --help` for the current flag surface — it is the source of truth over this file.

## Invocation modes

- **`/board`** with no argument — reconcile and report. Read the board, compare it against what has
  actually happened in this session, fix anything stale, then give the report contract below.
- **`/board add <title>`** — open a task from the user's words, applying the priority table.
- **`/board <question>`** — answer from board state (`qd list --json`). Read-only; change nothing.
- **No invocation** — the standing triggers injected at session start still apply. You do not need
  this skill to do ordinary upkeep.

This skill does **not** start or stop the board server. There is no `/quarterdeck stop`
subcommand. Stop the process with `/quarterdeck-stop` or `qd stop`. Closing the browser
tab does not stop it. Start it with `qd serve` or `qd open`.

## Priority

Assign once, at creation. The user's hand-set priority always wins — never lower one silently.

| | Assign when | Typical phrasing |
|---|---|---|
| **P1** | The user said so; **or** it blocks another open task; **or** it is production-breaking — broken build, failed deploy, outage, data loss, security | "urgent", "drop everything", "prod is down" |
| **P2** | **Default.** Any bug fix or feature | "fix the…", "add a…", "make it…" |
| **P3** | Investigate or diagnose, no fix requested yet | "why is…", "look into…", "figure out…" |
| **P4** | A single question-answer lookup | "what port…", "does X support…" |

Pass `--blocks <id>` rather than reasoning about P1 yourself: the CLI escalates when the blocked
task is genuinely open, and leaves it alone when it is not. An explicit `--prio` is never overridden.

A request that arrives as P3 ("why is login failing?") and turns into a fix is **still one task** —
`qd set <id> --prio P2` when the work changes shape, and log why. Do not open a second task.

## Status

`queued → active → {blocked, review} → done`, plus `cancelled`.

- `blocked` requires `--blocked-on`. When the blocker is the user, `--blocked-on you` puts the task
  in the board's **Needs you** section. This is the mechanism for asking — use it whenever you would
  otherwise stall silently or bury a question at the end of a long message.
- `review` means you believe the work is finished and the user should verify. Set `--next` to what
  they should check, in one line.
- **Never set `done` yourself.** Closing is the user's call, from the board. If they say "that's
  done" in chat, that is their call and you may close it — attribute it with `--who you`.

## The `next:` field

This is the single most valuable field on the board. It is what the user reads when they come back
cold. Write it as a sentence a person would say, not a status token:

- Good — `next: waiting on the staging DB password before I can reproduce`
- Good — `next: fix is in, verify the redirect on mobile Safari`
- Bad — `next: T-0041 blocked pending creds`
- Bad — `next: in progress`

Refresh it before ending a turn whenever it no longer describes reality.

## Reconcile (`/board` with no argument)

1. `qd list --open --json` and `qd agents`.
2. For each open task, ask: does its status still match reality? Is `next:` still true? Did work
   happen this session that never got logged?
3. Apply the corrections with `qd set` / `qd log`. Say what you changed.
4. Only then report.

Reconciling is the one mode that writes without the user naming a task. Everywhere else, do not
mutate tasks the user did not raise.

## Report contract

When reporting board state, use exactly these sections, in this order, each always present with its
empty-state line. This mirrors firstmate's `bearings` digest, which the user already reads.

1. **Needs you** — tasks blocked on the user, any priority. Empty: "Nothing is waiting on you."
2. **Ready for review** — finished, awaiting their sign-off. Empty: "Nothing is awaiting your sign-off."
3. **Active** — being worked on now. Empty: "Nothing is being worked on."
4. **Queued** — not started, with what each is waiting for. Empty: "Nothing is queued."

One scannable line per task: id, repo, title, and the `next:` or blocker. P4 lookups stay out of the
report unless asked for — they are on the board's collapsed strip. Link the board URL once at the end.

## Rules

- One board task per thing the **user** asked for. Your own implementation steps belong in your todo
  list. A five-step refactor is one task.
- Check `qd list --open` before adding, so a continued request logs rather than duplicates.
- Titles in the user's words, not internal jargon.
- **Never** write secrets, credentials, tokens, or file contents to the board — it renders in a browser
  and `tasks.md` is plain text on disk.
- If `qd` errors, report it once in one line and keep working. The board must never block real work.
