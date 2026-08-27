# Contributing to Quarterdeck

Thanks for helping improve Quarterdeck.

## Development setup

Quarterdeck has no runtime dependencies. You need Node.js 22 or newer.

```sh
git clone https://github.com/TailraceHQ/quarterdeck.git
cd quarterdeck
npm test
```

Run a local board with:

```sh
npm start          # foreground; Ctrl-C stops it
qd serve && qd open
qd stop            # stops a detached `qd serve` (closing the browser does not)
```

In Claude Code, `/quarterdeck-stop` is the slash command for `qd stop`. `/quarterdeck` is the task-board skill, not a server control command.

Quarterdeck writes state beneath `~/.claude/quarterdeck` by default. Set
`QD_HOME` to a temporary directory when testing changes manually:

```sh
QD_HOME="$(mktemp -d)" npm start
```

## Making a change

1. Create a branch from `main`.
2. Keep the change focused and include tests for new or changed behavior.
3. Run `npm test`.
4. Open a pull request describing the reason for the change and how you tested it.

Pull requests must pass the test workflow before they can be merged. Please do
not include generated state, transcripts, credentials, or other private data.

## Reporting bugs

Open a GitHub issue with the behavior you expected, what happened instead, and
the smallest reproduction you can provide. Include your Node.js and operating
system versions when they may be relevant.
