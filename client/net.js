// Transports: a WebSocket connection to a Hollow Stars server, or a local in-browser
// copy of the same authoritative game for solo play.

import { Game } from '../shared/sim/game.js';
import { TICK_DT } from '../shared/config.js';

export class WsTransport {
  constructor(url, onMessage, onClose) {
    this.ws = new WebSocket(url);
    this.ws.onmessage = (ev) => onMessage(ev.data);
    this.ws.onclose = () => onClose && onClose('Connection to the server closed.');
    this.ws.onerror = () => onClose && onClose('Could not reach the server. Check the address and that `npm start` is running.');
    this.ready = new Promise((res) => { this.ws.onopen = res; });
  }
  send(obj) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }
  close() { this.ws.onclose = null; this.ws.close(); }
}

const PROFILE_KEY = 'hollowstars.profiles';
function loadProfiles() { try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}'); } catch { return {}; } }
function saveProfiles(p) { try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch { /* storage unavailable */ } }

export class LocalTransport {
  constructor(name, onMessage, cls) {
    this.profiles = loadProfiles();
    // Deliver asynchronously, like a socket would
    this.queue = [];
    this.game = new Game({
      solo: true,
      room: 'solo',
      send: (cid, msg) => this.queue.push(msg),
      loadProfile: (n) => this.profiles[n.toLowerCase()] || null,
      saveProfile: (n, d) => { this.profiles[n.toLowerCase()] = d; clearTimeout(this.st); this.st = setTimeout(() => saveProfiles(this.profiles), 800); },
    });
    this.onMessage = onMessage;
    this.cid = 'local';
    this.ready = Promise.resolve();
    this.game.addPlayer(this.cid, { name, cls });
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
  send(obj) { try { this.game.handle(this.cid, JSON.parse(JSON.stringify(obj))); } catch (e) { console.error(e); } }
  close() { clearInterval(this.timer); this.game.removePlayer(this.cid); saveProfiles(this.profiles); }
}
