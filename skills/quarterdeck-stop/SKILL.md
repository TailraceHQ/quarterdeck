---
name: quarterdeck-stop
description: >-
  Stop the Quarterdeck board server (the process on localhost:7337). Invoke with
  /quarterdeck-stop. Closing the browser tab does not stop the server. This is
  not /quarterdeck — that skill is the task board.
disable-model-invocation: true
user-invocable: true
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/stop.js)
---

Stop the Quarterdeck HTTP server. Closing a browser tab on localhost:7337 does
not stop it. `/quarterdeck` (and `/board`) is the task-board skill; it does not
stop the process.

The server has already been stopped. Result:

!`node ${CLAUDE_SKILL_DIR}/stop.js`

Tell the user that result in one line. If it said `not running`, the server was
already down. If it said `stopped (pid …)`, the board is down until they run
`qd serve` or `qd open`.
