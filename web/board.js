const $ = (sel) => document.querySelector(sel);
const board = $('#board');
let repoFilter = localStorage.getItem('qd.repo') || '';
let state = null;

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const STATUSES = ['queued', 'active', 'blocked', 'review', 'done', 'cancelled'];
const PRIOS = ['P1', 'P2', 'P3', 'P4'];

function toast(msg, isErr) {
  let el = $('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.append(el);
  }
  el.textContent = msg;
  el.classList.toggle('err', !!isErr);
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2200);
}

function ago(iso) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 172800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function fmtTokens(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}

function sessionCard(s) {
  const cls = s.contextPct >= 85 ? 'hot' : s.contextPct >= 65 ? 'warn' : '';
  return `<div class="session">
    <div class="row1"><span class="dot ${esc(s.status)}"></span><span class="name">${esc(s.name)}</span></div>
    <div class="cwd">${esc(s.cwd)}</div>
    <div class="bar ${cls}"><i style="width:${s.contextPct}%"></i></div>
    <div class="ctx"><span>${fmtTokens(s.contextUsed)} / ${fmtTokens(s.contextWindow)} context</span><span>${s.contextPct}%</span></div>
  </div>`;
}

function taskCard(t, opts = {}) {
  const needsYou = t.status === 'blocked' && t['blocked-on'] === 'you';
  const line = needsYou
    ? `<div class="next blocked"><b>Needs you:</b> ${esc(t.next || t['blocked-on'])}</div>`
    : t.status === 'blocked'
      ? `<div class="next blocked"><b>Blocked on ${esc(t['blocked-on'])}.</b> ${esc(t.next || '')}</div>`
      : t.next
        ? `<div class="next"><b>Next:</b> ${esc(t.next)}</div>`
        : '';
  const log = (t.log || []).length
    ? `<details class="log"><summary>${t.log.length} log ${t.log.length === 1 ? 'entry' : 'entries'}</summary><ul>${t.log
        .slice(-8)
        .map((l) => `<li>${esc(l.replace(/^-\s*/, ''))}</li>`)
        .join('')}</ul></details>`
    : '';
  return `<article class="task ${esc(t.prio)} ${needsYou ? 'needsyou' : ''}" data-id="${esc(t.id)}">
    <div class="thead">
      <span class="tid">${esc(t.id)}</span>
      <span class="title">${esc(t.title)}</span>
      ${t.repo ? `<span class="tag repo">${esc(t.repo)}</span>` : ''}
      <span class="tag">${ago(t.updated)}</span>
    </div>
    ${line}
    <div class="controls">
      <select data-act="prio" aria-label="priority">${PRIOS.map(
        (p) => `<option ${p === t.prio ? 'selected' : ''}>${p}</option>`,
      ).join('')}</select>
      <select data-act="status" aria-label="status">${STATUSES.map(
        (s) => `<option ${s === t.status ? 'selected' : ''}>${s}</option>`,
      ).join('')}</select>
      ${
        opts.compact
          ? ''
          : `<input class="reply" type="text" data-act="reply" placeholder="Reply to the model…" aria-label="reply">
             <button class="send" data-act="send">Send</button>`
      }
    </div>
    ${log}
  </article>`;
}

function section(title, items, opts = {}) {
  const head = `<h2 class="${opts.alert ? 'alert' : ''}">${esc(title)}<span class="count">${items.length}</span></h2>`;
  const body = items.length
    ? items.map((t) => taskCard(t, opts)).join('')
    : `<p class="empty">${esc(opts.empty || 'Nothing here.')}</p>`;
  return `<section>${head}${body}</section>`;
}

function render() {
  if (!state) return;
  const keep = (t) => !repoFilter || t.repo === repoFilter;

  $('#repo-filters').innerHTML = [
    `<button data-repo="" aria-pressed="${!repoFilter}">All</button>`,
    ...state.repos.map((r) => `<button data-repo="${esc(r)}" aria-pressed="${repoFilter === r}">${esc(r)}</button>`),
  ].join('');

  const parts = [];
  parts.push(
    state.sessions.length
      ? `<section><h2>Sessions<span class="count">${state.sessions.length}</span></h2>
         <div class="sessions">${state.sessions.map(sessionCard).join('')}</div></section>`
      : `<section><h2>Sessions<span class="count">0</span></h2><p class="empty">No Claude Code sessions are running.</p></section>`,
  );

  parts.push(
    section('Needs you', state.needsYou.filter(keep), {
      alert: state.needsYou.length > 0,
      empty: 'Nothing is waiting on you.',
    }),
  );
  parts.push(section('Ready for review', state.review.filter(keep), { empty: 'Nothing is awaiting your sign-off.' }));
  parts.push(section('Active', state.active.filter(keep), { empty: 'Nothing is being worked on.' }));
  parts.push(section('Queued', state.queued.filter(keep), { empty: 'Nothing is queued.' }));

  if (state.agents.length) {
    parts.push(`<section><h2>Subagents<span class="count">${state.agents.length}</span></h2>
      <div class="agents">${state.agents
        .map(
          (a) => `<div class="agent"><span class="spin"></span>
            <span class="who">${esc(a.subagentType)}</span>
            <span class="model">${esc(a.model)}</span>
            <span class="desc">${esc(a.description)}</span></div>`,
        )
        .join('')}</div></section>`);
  }

  const looks = state.lookups.filter(keep);
  if (looks.length) {
    parts.push(`<section><details class="lookups"><summary>Answered lookups (${looks.length})</summary>
      ${looks.map((t) => taskCard(t, { compact: true })).join('')}</details></section>`);
  }

  board.innerHTML = parts.join('');
  board.setAttribute('aria-busy', 'false');
  $('#stamp').textContent = `${state.counts.open} open · ${state.counts.p1} P1`;
}

async function post(id, act, value) {
  try {
    const res = await fetch(`/api/task/${encodeURIComponent(id)}/${act}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    toast(act === 'reply' ? 'Sent — the model sees it on its next turn.' : `${id} updated.`);
  } catch (err) {
    toast(`Failed: ${err.message}`, true);
    load();
  }
}

board.addEventListener('change', (e) => {
  const act = e.target.dataset.act;
  const id = e.target.closest('.task')?.dataset.id;
  if (!id || (act !== 'status' && act !== 'prio')) return;
  post(id, act, e.target.value);
});

function sendReply(input) {
  const id = input.closest('.task')?.dataset.id;
  const text = input.value.trim();
  if (!id || !text) return;
  input.value = '';
  post(id, 'reply', text);
}

board.addEventListener('click', (e) => {
  if (e.target.dataset.act === 'send') {
    const input = e.target.closest('.controls')?.querySelector('[data-act="reply"]');
    if (input) sendReply(input);
  }
});
board.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.dataset.act === 'reply') sendReply(e.target);
});

$('#repo-filters').addEventListener('click', (e) => {
  if (!e.target.dataset || e.target.dataset.repo === undefined) return;
  repoFilter = e.target.dataset.repo;
  localStorage.setItem('qd.repo', repoFilter);
  render();
});

async function load() {
  try {
    state = await (await fetch('/api/state')).json();
    render();
  } catch {
    $('#conn').classList.add('down');
  }
}

// Live updates over SSE, with a poll fallback if the stream drops.
function connect() {
  const es = new EventSource('/api/stream');
  es.onmessage = (e) => {
    state = JSON.parse(e.data);
    $('#conn').classList.remove('down');
    render();
  };
  es.onerror = () => {
    $('#conn').classList.add('down');
    es.close();
    setTimeout(connect, 3000);
  };
}

load();
connect();
// Sessions and context % move without tasks.md changing, so refresh on a timer too.
setInterval(load, 5000);
