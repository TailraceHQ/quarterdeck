# Quarterdeck

[![Tests](https://github.com/TailraceHQ/quarterdeck/actions/workflows/tests.yml/badge.svg)](https://github.com/TailraceHQ/quarterdeck/actions/workflows/tests.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Host: Claude Code](https://img.shields.io/badge/host-Claude%20Code-D97757.svg)](https://www.anthropic.com/claude-code)

A live task board for the orchestrator. One dashboard for every task you gave Claude Code, across
every repo — with priorities, statuses you can change yourself, a reply box that reaches the model,
per-session context %, and a strip showing what subagents are doing.

Built alongside [`firstmate`](https://github.com/kunchenguid/firstmate) (whose `bearings` fleet board
inspired the section taxonomy) and [`lavish-axi`](https://github.com/kunchenguid/lavish-axi) (whose
serve-and-reply-from-the-page loop this mirrors). It depends on neither — zero npm dependencies,
Node ≥22 only.

## Install

```sh
node install.js      # symlinks the skills, registers hooks, puts `qd` on PATH
qd serve && qd open
```

Then restart Claude Code so the hooks and slash commands load. `node install.js --uninstall` reverses it.

## Start and stop

The board is a Node process. Closing the browser tab does **not** stop it.

```sh
qd serve && qd open   # start (detached) and open the dashboard
qd stop               # stop the server
qd status             # whether it is running
```

In Claude Code, `/quarterdeck-stop` runs `qd stop`. That is a separate slash command from `/quarterdeck` (and `/board`), which is the task-board skill — there is no `/quarterdeck stop` subcommand.

## How it works

```
you type in the browser ──▶ tasks.md ──▶ inbox.jsonl
                                │              │
        qd add/set/log ─────────┘              ▼
        (the model)                   UserPromptSubmit hook
                                      injects it next turn
```

- **State is one markdown file** — `~/.claude/quarterdeck/state/tasks.md`. Hand-editable; programmatic
  writes only touch `- key: value` lines and append under `### Log`, so your own prose survives.
- **The model writes through `qd`**, never by editing the file. The CLI locks, validates, and allocates ids.
- **Your edits persist with no agent running.** The server writes to disk immediately.
- **Nothing blocks.** Replies reach the model via hook injection on its next turn — no long polling.

## Priority

| | Assigned when |
|---|---|
| **P1** | You say so; or it blocks another open task (`--blocks <id>` escalates automatically); or it is production-breaking |
| **P2** | Default — any bug fix or feature |
| **P3** | Investigate / diagnose, no fix requested yet |
| **P4** | Single question-answer lookup (logged, but collapsed and auto-archived after 24h) |

A priority you set by hand is never lowered by the model.

## Status

`queued → active → {blocked, review} → done`, plus `cancelled`.

`blocked` requires a reason; `--blocked-on you` surfaces the task in the board's **Needs you**
section. Only you set `done` — the model proposes `review` and waits.

## CLI

Run `qd --help` for the full surface. The common ones:

```sh
qd add "fix the auth redirect" --repo Ciciro   # P2 by default
qd set T-0004 --status blocked --blocked-on you --next "need the staging password"
qd log T-0004 "reproduced on staging"
qd list --open
qd serve && qd open
qd stop
qd status
```

## Configuration

`~/.claude/quarterdeck/config.json`, all optional:

```json
{ "port": 7337, "contextWindow": 200000, "lookupTtlHours": 24 }
```

Context-window sizes are configured rather than detected — the transcript records tokens used, not
the window. Override per model with `windowByModel`.

## Privacy

The board renders in a browser and `tasks.md` is plaintext on disk. Subagent tracking stores only
agent type, model, and the short description — never the prompt body or tool output. The ruleset
tells the model never to write secrets or file contents to the board.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and pull
request guidelines. Quarterdeck is available under the [MIT License](LICENSE).
