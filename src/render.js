import { listTasks, toJSON } from './store.js';
import { readSessions, readAgents } from './snapshot.js';
import { config } from './paths.js';

export function boardState() {
  const tasks = listTasks().map(toJSON);
  const open = tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
  const closed = tasks.filter((t) => t.status === 'done' || t.status === 'cancelled');

  const needsYou = open.filter((t) => t.status === 'blocked' && (t['blocked-on'] || '') === 'you');
  const review = open.filter((t) => t.status === 'review');
  const rest = open.filter((t) => !needsYou.includes(t) && !review.includes(t));

  // P4 lookups are recorded but collapsed, so a day of quick questions cannot
  // bury the real work.
  const lookups = rest.filter((t) => t.prio === 'P4').concat(closed.filter((t) => t.prio === 'P4'));
  const main = rest.filter((t) => t.prio !== 'P4');

  const byPrio = (a, b) => (a.prio || 'P9').localeCompare(b.prio || 'P9') || (b.updated || '').localeCompare(a.updated || '');

  return {
    generatedAt: new Date().toISOString(),
    port: config().port,
    sessions: readSessions(),
    agents: readAgents(),
    needsYou: needsYou.sort(byPrio),
    review: review.sort(byPrio),
    active: main.filter((t) => t.status === 'active').sort(byPrio),
    queued: main.filter((t) => t.status !== 'active').sort(byPrio),
    lookups: lookups.sort((a, b) => (b.updated || '').localeCompare(a.updated || '')),
    repos: [...new Set(open.map((t) => t.repo).filter(Boolean))].sort(),
    counts: {
      open: open.length,
      needsYou: needsYou.length,
      p1: open.filter((t) => t.prio === 'P1').length,
    },
  };
}

export function page(css, js) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Quarterdeck</title>
<style>${css}</style>
</head>
<body>
<header class="topbar">
  <div class="brand"><span class="mark" aria-hidden="true"></span> Quarterdeck</div>
  <div class="filters" id="repo-filters"></div>
  <div class="meta"><span id="conn" class="conn" title="live connection"></span> <span id="stamp"></span></div>
</header>
<main id="board" aria-busy="true">
  <p class="empty">Loading the board…</p>
</main>
<script type="module">${js}</script>
</body>
</html>`;
}
