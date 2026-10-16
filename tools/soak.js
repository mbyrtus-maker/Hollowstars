// Headless soak test: runs the authoritative sim with scripted bot players and checks
// for exceptions and tick cost.
import { Game } from '../shared/sim/game.js';
import { K } from '../shared/config.js';
import { TICK_DT } from '../shared/config.js';

const inbox = new Map();
const game = new Game({ send: (cid, s) => { inbox.set(cid, s); }, solo: false, planet: process.argv[3] });
const bots = [];
for (let i = 0; i < 4; i++) {
  const cid = 'bot' + i;
  game.addPlayer(cid, { name: 'Bot' + i });
  bots.push({ cid, tp: 1, x: 0, y: 0, z: 0, t: 0 });
}
for (const b of bots) { const p = game.playerOf(b.cid); b.x = p.x; b.y = p.y; b.z = p.z; }
let worst = 0, total = 0, ticks = 0;
const seconds = +process.argv[2] || 240;
const targets = [[-160, 40], [122, 0], [151, -10], [180, 18], [200, 10], [78, 66], [217, -20]];
const t0 = performance.now();
for (let n = 0; n < seconds / TICK_DT; n++) {
  // bots
  bots.forEach((b, i) => {
    const p = game.playerOf(b.cid);
    // read tp
    const s = inbox.get(b.cid);
    if (s && s.startsWith('{"t":"tp"')) { const m = JSON.parse(s); b.tp = m.s; [b.x, b.y, b.z] = m.p; }
    if (n === 40 && i === 0) { game.teleport(p, -164, 6.3, 33); }
    const tgt = targets[(Math.floor(n / 400) + i) % targets.length];
    const dx = tgt[0] - b.x, dz = tgt[1] - b.z, d = Math.hypot(dx, dz);
    if (d > 2) { b.x += dx / d * 8 * TICK_DT; b.z += dz / d * 8 * TICK_DT; }
    b.y = p.y;
    const yaw = Math.atan2(-dx, -dz);
    game.handle(b.cid, { t: 'in', tp: p.tpSeq, p: [b.x, b.y, b.z], v: [dx / d * 8, 0, dz / d * 8], yw: yaw, pt: 0, f: (n % 200 < 100 ? 1 : 0) | 8 | 16 | (i === 2 ? 4 : 0), w: i === 2 ? 1 : 0 });
    if (n % 7 === i) game.handle(b.cid, { t: 'fire', o: [b.x, b.y + 1.4, b.z], d: [dx / d, 0, dz / d] });
    if (n % 300 === 50 + i) game.handle(b.cid, { t: 'gren', o: [b.x, b.y + 1.5, b.z], d: [dx / d, 0.3, dz / d] });
    if (n % 90 === 10) game.handle(b.cid, { t: 'push', pitch: 0 });
    if (n % 97 === 20) game.handle(b.cid, { t: 'pull', yaw, pitch: 0 });
    if (i === 2 && n % 9 === 0) game.handle(b.cid, { t: 'mel', n: 1 });
    if (n % 60 === 30) game.handle(b.cid, { t: 'use', down: true });
    if (n === 45 && i === 0) game.handle(b.cid, { t: 'accept', id: 'rescue' });
    if (n === 2400 && i === 0) { game.handle(b.cid, { t: 'abandon' }); }
    if (n === 2410 && i === 0) { game.teleport(p, -164, 6.3, 33); }
    if (n === 2420 && i === 0) game.handle(b.cid, { t: 'accept', id: 'sabotage' });
  });
  const a = performance.now();
  game.tick(TICK_DT);
  const c = performance.now() - a;
  worst = Math.max(worst, c); total += c; ticks++;
}
const kinds = {};
for (const e of game.ents.values()) kinds[e.kind] = (kinds[e.kind] || 0) + (e.dead ? 0 : 1);
console.log(`simulated ${seconds}s in ${((performance.now() - t0) / 1000).toFixed(1)}s; avg tick ${(total / ticks).toFixed(2)}ms worst ${worst.toFixed(1)}ms`);
console.log('alive by kind', kinds, 'alarm', game.alarm.active, 'mission', game.mission && game.mission.id, game.mission && game.mission.done);
const last = inbox.get('bot0');
console.log('snapshot bytes', last.length);
console.log('players', game.players().map((p) => [p.name, Math.round(p.hp), p.downed, p.credits, p.kills, p.x.toFixed(0), p.z.toFixed(0)]));
