import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardState, page } from './render.js';
import { updateTask, pushInbox, logTask, addTask } from './store.js';
import { config, TASKS_MD, SERVER_PID, STATE_DIR, ensureDirs } from './paths.js';

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');

function body(req) {
  return new Promise((resolve) => {
    let buf = '';
    req.on('data', (c) => {
      buf += c;
      if (buf.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(buf || '{}'));
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

function json(res, code, value) {
  const text = JSON.stringify(value);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

export function createServer() {
  const clients = new Set();

  const broadcast = () => {
    if (!clients.size) return;
    let payload;
    try {
      payload = `data: ${JSON.stringify(boardState())}\n\n`;
    } catch {
      return; // A half-written tasks.md; the next event will carry the truth.
    }
    for (const res of clients) {
      try {
        res.write(payload);
      } catch {
        clients.delete(res);
      }
    }
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;

    try {
      if (p === '/' || p === '/index.html') {
        const html = page(
          fs.readFileSync(path.join(WEB, 'board.css'), 'utf8'),
          [
            fs.readFileSync(path.join(WEB, 'reply-drafts.js'), 'utf8'),
            fs.readFileSync(path.join(WEB, 'board.js'), 'utf8'),
          ].join('\n'),
        );
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(html);
      }

      if (p === '/api/state') return json(res, 200, boardState());

      if (p === '/api/stream') {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        res.write(`data: ${JSON.stringify(boardState())}\n\n`);
        clients.add(res);
        const ping = setInterval(() => {
          try {
            res.write(': ping\n\n');
          } catch {
            /* cleaned up on close */
          }
        }, 25000);
        req.on('close', () => {
          clearInterval(ping);
          clients.delete(res);
        });
        return undefined;
      }

      const m = /^\/api\/task\/([^/]+)\/(status|prio|reply)$/.exec(p);
      if (m && req.method === 'POST') {
        const [, id, act] = m;
        const { value } = await body(req);
        if (act === 'reply') {
          const text = String(value || '').trim();
          if (!text) return json(res, 400, { error: 'empty reply' });
          logTask(id, text, 'you');
          pushInbox({ kind: 'reply', task: id, text });
        } else if (act === 'status') {
          // A human moving a task to `blocked` from the board means it is
          // waiting on them until the model learns otherwise.
          const patch = { status: value };
          if (value === 'blocked') patch['blocked-on'] = 'you';
          updateTask(id, patch, { who: 'you', logMessage: `you set status to ${value}` });
          pushInbox({ kind: 'status', task: id, value });
        } else {
          updateTask(id, { prio: value }, { who: 'you', logMessage: `you set priority to ${value}` });
          pushInbox({ kind: 'prio', task: id, value });
        }
        broadcast();
        return json(res, 200, { ok: true });
      }

      if (p === '/api/task' && req.method === 'POST') {
        const { title, prio, repo, next } = await body(req);
        const task = addTask({ title, prio, repo, next });
        pushInbox({ kind: 'new', task: task.id, text: title });
        broadcast();
        return json(res, 200, { ok: true, id: task.id });
      }

      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('not found');
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  });

  // Watch tasks.md so hand-edits and `qd` writes from any session push live.
  ensureDirs();
  let debounce = null;
  try {
    fs.watch(STATE_DIR, (_e, name) => {
      if (name && !name.startsWith(path.basename(TASKS_MD))) return;
      clearTimeout(debounce);
      debounce = setTimeout(broadcast, 120);
    });
  } catch {
    // Watching is an optimisation; the client's 5s poll still keeps it fresh.
  }

  return { server, broadcast };
}

export function start({ port = config().port } = {}) {
  const { server } = createServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      ensureDirs();
      fs.writeFileSync(SERVER_PID, String(process.pid));
      resolve({ server, port, url: `http://localhost:${port}` });
    });
  });
}
