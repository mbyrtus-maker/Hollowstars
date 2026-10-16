// Serverless peer-to-peer co-op (works on static hosting such as GitHub Pages).
// One player's browser hosts the authoritative game; up to three friends join with a
// crew code. Signaling goes through public BitTorrent trackers by default, or through a
// self-hosted relay (the Node server exposes one at /relay) when `relay` is given.
// After signaling, all game traffic flows directly between browsers over WebRTC.
import { joinRoom as joinTorrent } from '../vendor/trystero/torrent/index.ts';
import { joinRoom as joinRelay } from '../vendor/trystero/ws-relay/index.ts';
import { Game } from '../shared/sim/game.js';
import { TICK_DT, MAX_PLAYERS } from '../shared/config.js';

const APP_ID = 'hollow-stars-coop-v1';
const PROFILE_KEY = 'hollowstars.profiles';
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function makeCrewCode() {
  let s = '';
  const r = new Uint32Array(5);
  crypto.getRandomValues(r);
  for (const v of r) s += CODE_CHARS[v % CODE_CHARS.length];
  return s;
}
export const normalizeCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

export function loadProfiles() { try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}'); } catch { return {}; } }
export function saveProfile(name, data) {
  try { const p = loadProfiles(); p[name.toLowerCase()] = data; localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch { /* storage unavailable */ }
}

function openRoom(code, relay) {
  const cfg = relay
    ? { appId: APP_ID, relayConfig: { urls: [relay] } }
    : { appId: APP_ID };
  const join = relay ? joinRelay : joinTorrent;
  const room = join(cfg, 'crew-' + code);
  const [send, onMsg] = (() => { const a = room.makeAction('m'); return [a.send.bind(a), (fn) => { a.onMessage = fn; }]; })();
  return { room, send, onMsg };
}

// ------------------------------------------------------------------ host

export class P2PHost {
  constructor(name, code, onMessage, opts = {}) {
    this.code = code;
    this.onMessage = onMessage;
    this.onStatus = opts.onStatus || (() => {});
    this.queue = [];
    this.peers = new Map(); // peerId -> name
    this.localName = name;
    this.pendingProfile = null;
    this.game = new Game({
      room: code,
      seed: [...code].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7),
      send: (cid, msg) => {
        if (cid === 'local') this.queue.push(msg);
        else this.net.send(msg, { target: cid });
      },
      loadProfile: (n) => {
        if (this.pendingProfile) { const p = this.pendingProfile; this.pendingProfile = null; return p; }
        return loadProfiles()[n.toLowerCase()] || null;
      },
      saveProfile: (n, data) => {
        if (n === this.localName) { clearTimeout(this.st); this.st = setTimeout(() => saveProfile(n, data), 600); return; }
        for (const [pid, pn] of this.peers) if (pn === n) this.net.send(JSON.stringify({ t: 'prof', d: data }), { target: pid });
      },
    });
    const { room, send, onMsg } = openRoom(code, opts.relay);
    this.room = room;
    this.net = { send };
    room.onPeerJoin = (pid) => { send(JSON.stringify({ t: 'host', code }), { target: pid }); };
    room.onPeerLeave = (pid) => {
      if (this.peers.has(pid)) { this.peers.delete(pid); this.game.removePlayer(pid); this.onStatus(this.peers.size); }
    };
    onMsg((data, { peerId }) => {
      if (typeof data !== 'string' || data.length > 16384) return;
      let m;
      try { m = JSON.parse(data); } catch { return; }
      if (m.t === 'hello') {
        if (this.peers.has(peerId)) return;
        if (this.game.players().length >= MAX_PLAYERS) { send(JSON.stringify({ t: 'error', msg: 'That crew is full (4 players).' }), { target: peerId }); return; }
        const pname = String(m.name || 'Drifter').slice(0, 16);
        this.pendingProfile = m.profile && typeof m.profile === 'object' ? sanitizeProfile(m.profile) : null;
        const res = this.game.addPlayer(peerId, { name: pname, cls: String(m.cls || '') });
        this.pendingProfile = null;
        if (res.error) { send(JSON.stringify({ t: 'error', msg: res.error }), { target: peerId }); return; }
        this.peers.set(peerId, res.player.name);
        this.onStatus(this.peers.size);
        return;
      }
      if (!this.peers.has(peerId)) return;
      try { this.game.handle(peerId, m); } catch (e) { console.error(e); }
    });
    this.cid = 'local';
    this.ready = Promise.resolve();
    this.game.addPlayer('local', { name, cls: opts.cls });
    this.flush();
    let last = performance.now(), acc = 0;
    this.timer = setInterval(() => {
      const now = performance.now();
      acc = Math.min(0.5, acc + (now - last) / 1000);
      last = now;
      while (acc >= TICK_DT) { acc -= TICK_DT; this.game.tick(TICK_DT); }
      this.flush();
    }, 1000 / 60);
  }
  flush() { const q = this.queue; this.queue = []; for (const m of q) this.onMessage(m); }
  send(obj) { try { this.game.handle('local', JSON.parse(JSON.stringify(obj))); } catch (e) { console.error(e); } }
  close() {
    clearInterval(this.timer);
    try { this.net.send(JSON.stringify({ t: 'error', msg: 'The host ended the session.' })); } catch { /* ignore */ }
    this.game.removePlayer('local');
    setTimeout(() => { try { this.room.leave(); } catch { /* ignore */ } }, 200);
  }
}

function sanitizeProfile(p) {
  const n = (v, max) => Math.max(0, Math.min(max, Math.round(+v || 0)));
  const up = {};
  if (p.upgrades && typeof p.upgrades === 'object') for (const k of Object.keys(p.upgrades).slice(0, 16)) up[String(k).slice(0, 16)] = 1;
  return { credits: n(p.credits, 10_000_000), grenades: n(p.grenades, 8), medpacks: n(p.medpacks, 8), upgrades: up, cls: String(p.cls || '').slice(0, 16) };
}

// ------------------------------------------------------------------ joiner

export class P2PClient {
  constructor(name, code, onMessage, onClose, opts = {}) {
    this.host = null;
    this.onMessage = onMessage;
    this.onClose = onClose;
    const { room, send, onMsg } = openRoom(code, opts.relay);
    this.room = room;
    this.net = { send };
    const profile = loadProfiles()[name.toLowerCase()] || null;
    let resolveReady;
    this.ready = new Promise((r) => { resolveReady = r; });
    onMsg((data, { peerId }) => {
      if (typeof data !== 'string') return;
      if (!this.host) {
        if (data.startsWith('{"t":"host"')) {
          this.host = peerId;
          clearTimeout(this.timeout);
          send(JSON.stringify({ t: 'hello', name, profile, cls: opts.cls }), { target: peerId });
          resolveReady();
        }
        return;
      }
      if (peerId !== this.host) return;
      if (data.startsWith('{"t":"prof"')) { try { saveProfile(name, JSON.parse(data).d); } catch { /* ignore */ } return; }
      onMessage(data);
    });
    room.onPeerLeave = (pid) => { if (pid === this.host) this.fail('The host left. The crew has disbanded.'); };
    this.timeout = setTimeout(() => this.fail(`No crew answered code ${code}. Check the code, and make sure the host is in the game.`), opts.timeout || 25000);
  }
  fail(msg) {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timeout);
    try { this.room.leave(); } catch { /* ignore */ }
    this.onClose && this.onClose(msg);
  }
  send(obj) { if (this.host) this.net.send(JSON.stringify(obj), { target: this.host }); }
  close() { this.closed = true; clearTimeout(this.timeout); try { this.room.leave(); } catch { /* ignore */ } }
}
