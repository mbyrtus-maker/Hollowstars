// Hollow Stars multiplayer server: serves the client and hosts co-op rooms of up to 4.
// Usage: node server/server.js   (PORT env var, default 8080)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Game } from '../shared/sim/game.js';
import { TICK_DT, MAX_PLAYERS } from '../shared/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const DATA = path.join(ROOT, 'data');
const PORT = +process.env.PORT || 8080;

fs.mkdirSync(DATA, { recursive: true });
const PROFILE_FILE = path.join(DATA, 'profiles.json');
let profiles = {};
try { profiles = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8')); } catch { profiles = {}; }
let saveTimer = null;
function saveProfiles() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(PROFILE_FILE, JSON.stringify(profiles, null, 1), () => {}), 1000);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.md': 'text/markdown' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/rooms') {
    const list = [...rooms.values()].map((r) => ({ name: r.name, players: r.game.players().map((p) => p.name), full: r.game.players().length >= MAX_PLAYERS }));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(list));
    return;
  }
  let file = path.normalize(path.join(DIST, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('Not found. Did you run `npm run build`?'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(buf);
  });
});

// ------------------------------------------------------------------ rooms

const rooms = new Map();
let nextClient = 1;

function getRoom(name) {
  name = String(name || 'public').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24) || 'public';
  let r = rooms.get(name);
  if (!r) {
    const sockets = new Map();
    const game = new Game({
      room: name,
      seed: hash(name),
      send: (cid, msg) => { const ws = sockets.get(cid); if (ws && ws.readyState === 1) ws.send(msg); },
      loadProfile: (n) => profiles[n.toLowerCase()] || null,
      saveProfile: (n, data) => { profiles[n.toLowerCase()] = { ...data, savedAt: Date.now() }; saveProfiles(); },
    });
    r = { name, game, sockets, emptySince: 0 };
    rooms.set(name, r);
    console.log(`[room] created ${name}`);
  }
  return r;
}

function hash(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }

const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
const relayWss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, 'http://x');
  const target = pathname === '/relay' ? relayWss : wss;
  target.handleUpgrade(req, socket, head, (ws) => target.emit('connection', ws, req));
});

// ------------------------------------------------------------------ signaling relay
// A tiny pub/sub relay compatible with Trystero's ws-relay strategy. Browsers use it only
// to find each other for peer-to-peer crews (game traffic then goes browser-to-browser).
const topics = new Map();
relayWss.on('connection', (ws) => {
  const mine = new Set();
  let budget = 60;
  const refill = setInterval(() => { budget = 60; }, 1000);
  ws.on('message', (data) => {
    if (--budget < 0) return;
    let m;
    try { m = JSON.parse(data.toString()); } catch { return; }
    if (!m || typeof m.topic !== 'string' || m.topic.length > 256) return;
    if (m.type === 'subscribe' && mine.size < 64) {
      let set = topics.get(m.topic);
      if (!set) topics.set(m.topic, (set = new Set()));
      set.add(ws); mine.add(m.topic);
    } else if (m.type === 'unsubscribe') {
      topics.get(m.topic)?.delete(ws); mine.delete(m.topic);
    } else if (m.type === 'publish') {
      const out = JSON.stringify({ topic: m.topic, payload: m.payload });
      for (const sub of topics.get(m.topic) || []) if (sub.readyState === 1) sub.send(out);
    }
  });
  ws.on('close', () => {
    clearInterval(refill);
    for (const t of mine) { const set = topics.get(t); if (set) { set.delete(ws); if (!set.size) topics.delete(t); } }
  });
});
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://x');
  const room = getRoom(url.searchParams.get('room'));
  const cid = 'c' + nextClient++;
  const name = url.searchParams.get('name') || 'Drifter';
  const cls = url.searchParams.get('cls') || '';
  room.sockets.set(cid, ws);
  const res = room.game.addPlayer(cid, { name, cls });
  if (res.error) {
    ws.send(JSON.stringify({ t: 'error', msg: res.error }));
    room.sockets.delete(cid);
    ws.close();
    return;
  }
  console.log(`[room ${room.name}] ${res.player.name} joined (${room.game.players().length}/${MAX_PLAYERS})`);
  let budget = 120; // simple flood protection: messages per second
  const refill = setInterval(() => { budget = 120; }, 1000);
  ws.on('message', (data) => {
    if (--budget < 0) return;
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    try { room.game.handle(cid, msg); } catch (e) { console.error('handle error', e); }
  });
  ws.on('close', () => {
    clearInterval(refill);
    room.game.removePlayer(cid);
    room.sockets.delete(cid);
    console.log(`[room ${room.name}] client left (${room.game.players().length}/${MAX_PLAYERS})`);
  });
});

// ------------------------------------------------------------------ main loop

let last = performance.now(), acc = 0;
setInterval(() => {
  const now = performance.now();
  acc += (now - last) / 1000;
  last = now;
  if (acc > 0.5) acc = 0.5;
  while (acc >= TICK_DT) {
    acc -= TICK_DT;
    for (const r of rooms.values()) {
      if (r.game.players().length === 0) {
        if (!r.emptySince) r.emptySince = Date.now();
        if (Date.now() - r.emptySince > 5 * 60 * 1000) { rooms.delete(r.name); console.log(`[room] closed ${r.name}`); }
        continue; // rooms sleep while empty
      }
      r.emptySince = 0;
      try { r.game.tick(TICK_DT); } catch (e) { console.error(`[room ${r.name}] tick error`, e); }
    }
  }
}, 1000 / 60);

server.listen(PORT, () => {
  console.log(`Hollow Stars server listening on http://localhost:${PORT}`);
  console.log('Share your LAN address (or a tunnel) with up to 3 friends. Rooms: add ?room=name to the URL.');
});
