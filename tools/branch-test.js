// Class lock-in, the four-key ability loadout, branches and every branch ability, against the
// real simulation. Run: node tools/branch-test.js
import { Game } from '../shared/sim/game.js';
import { K, F, TICK_DT, levelOf, xpToNext, LEVELS, BRANCHES, BRANCH_RESET_COST, MISSIONS } from '../shared/config.js';
import { groundAt } from '../shared/world.js';
import { unlockedPool } from '../shared/sim/classes.js';

let failures = 0;
const check = (c, msg) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${msg}`); if (!c) failures++; };
const run = (g, s) => { for (let i = 0; i < s / TICK_DT; i++) g.tick(TICK_DT); };
const place = (g, p, x, z) => { p.tpSeq++; p.x = x; p.z = z; p.y = groundAt(g.world, x, z, 60) + 0.02; };
const faceAt = (p, e) => { p.yaw = Math.atan2(-(e.x - p.x), -(e.z - p.z)); p.pitch = Math.atan2(e.y + 1.1 - (p.y + 1.5), Math.hypot(e.x - p.x, e.z - p.z)); };
const aim = (p, e) => { const dx = e.x - p.x, dy = e.y + 1.1 - (p.y + 1.5), dz = e.z - p.z, l = Math.hypot(dx, dy, dz); return [dx / l, dy / l, dz / l]; };
const calm = (e) => { e.ai.state = 'routine'; e.ai.sus = 0; e.ai.wait = 60; e.vx = e.vz = 0; };
const xpFor = (lv) => { let t = 0; for (let l = 1; l < lv; l++) t += xpToNext(l); return t; };
const L10 = xpFor(10), L15 = xpFor(15), L18 = xpFor(18);
const guards = (g) => [...g.ents.values()].filter((e) => e.kind === K.LANCER && !e.dead);

const store = {};
function setup(cls, prof, name = 'B') {
  if (prof) store[name] = prof; else delete store[name];
  const sent = [];
  const g = new Game({ send: (c, m) => sent.push(JSON.parse(m)), solo: true, saveProfile: (n, d) => { store[n] = d; }, loadProfile: (n) => store[n] || null });
  g.addPlayer('p', { name, cls });
  g.rebuildSpatial();
  return { g, p: g.playerOf('p'), sent };
}
// a character at level 18 on a branch, with one ability put on Q
function brancher(branch, q, extra = {}) {
  const R = BRANCHES[branch];
  const cls = { guardian: 'warden', bounty: 'gunslinger', commando: 'soldier', surgeon: 'medic', agent: 'spy', phantom: 'sniper' }[R.adv];
  const s = setup(cls, { xp: L18, advs: { [cls]: R.adv }, locked: cls, branch, cls, ...extra });
  if (q) { s.g.handle('p', { t: 'slots', s: { ...s.p.slots, q, ...(Object.values(s.p.slots).includes(q) ? { [Object.keys(s.p.slots).find((k) => s.p.slots[k] === q)]: s.p.slots.q } : {}) } }); }
  return s;
}
const ab = (g, p, k = 'q', extra = {}) => g.handle('p', { t: 'ab', k, yaw: p.yaw, pitch: p.pitch, ...extra });
function lineUp(g, p, n = 2, dist = 30) {
  place(g, p, -180, -114); p.yaw = -Math.PI / 2; p.pitch = 0;
  const list = guards(g).slice(0, n);
  list.forEach((e, i) => { calm(e); e.x = p.x + dist + i * 3; e.z = p.z; e.y = groundAt(g.world, e.x, e.z, 60); e.hp = e.maxHp = 300; });
  g.rebuildSpatial();
  return list;
}

// ---------------------------------------------------------------- lock-in
{
  const { g, p, sent } = setup('soldier', { xp: L10 }, 'Lock');
  g.handle('p', { t: 'adv', id: 'commando' });
  check(p.adv === 'commando' && p.locked === 'soldier', 'lock: taking Commando locks the character in as a Soldier');
  check(sent.some((m) => m.t === 'cls' && m.locked === 'soldier'), 'lock: the client is told the character is locked');
  g.handle('p', { t: 'adv', id: null });
  check(p.adv === 'commando', "lock: there's no going back to plain Soldier");
  g.removePlayer('p');
  g.addPlayer('p', { name: 'Lock', cls: 'spy' });
  const q = g.playerOf('p');
  check(q.cls === 'soldier' && q.adv === 'commando', `lock: picking Spy at the start screen still loads a Commando (${q.cls}/${q.adv})`);
  const free = setup('soldier', { xp: L10 - 50 }, 'Free');
  free.g.removePlayer('p');
  free.g.addPlayer('p', { name: 'Free', cls: 'spy' });
  check(free.g.playerOf('p').cls === 'spy', 'lock: below the advanced class you can switch classes freely');
}

// ---------------------------------------------------------------- loadout
{
  const { g, p } = setup('soldier', { xp: L10, advs: { soldier: 'commando' } });
  check(p.slots.z === 'bulwark' && p.slots.f === 'jets' && p.slots.x === 'swarm', `loadout: Commando keeps Bulwark on the new Z key (${JSON.stringify(p.slots)})`);
  g.handle('p', { t: 'ab', k: 'z', yaw: 0, pitch: 0 });
  check((p.act.bulwark || 0) > g.time, 'loadout: Z fires the fourth ability');
  g.handle('p', { t: 'slots', s: { q: 'bulwark', f: 'jets', x: 'swarm', z: 'suppress' } });
  check(p.slots.q === 'bulwark' && p.slots.z === 'suppress', 'loadout: abilities can be moved between keys');
  ab(g, p, 'q');
  check((p.cdk.bulwark || 0) > g.time + 10, 'loadout: moving an ability keeps its cooldown');
  g.handle('p', { t: 'slots', s: { q: 'bulwark', f: 'bulwark', x: 'push', z: null } });
  check(p.slots.f === null && p.slots.x === null, "loadout: an ability can't sit on two keys, and other classes' abilities are refused");
  const base = setup('medic', { xp: 0 }, 'M');
  base.g.handle('p', { t: 'slots', s: { q: 'dart', f: 'burst', x: null, z: 'burst' } });
  check(base.p.slots.q === 'dart' && base.p.slots.z === null, 'loadout: no Z key before the advanced class');
}

// ---------------------------------------------------------------- branches
{
  const { g, p } = setup('soldier', { xp: L15 - 10, advs: { soldier: 'commando' } });
  g.handle('p', { t: 'branch', id: 'vanguard' });
  check(!p.branch, 'branch: closed below level 15');
  g.addXp(p, 20);
  g.handle('p', { t: 'branch', id: 'lifeline' });
  check(!p.branch, "branch: can't take another advanced class's path");
  g.handle('p', { t: 'branch', id: 'vanguard' });
  check(p.branch === 'vanguard', 'branch: a level 15 Commando becomes a Vanguard');
  check(unlockedPool(p).some((a) => a.id === 'slam') && !unlockedPool(p).some((a) => a.id === 'barrage'), 'branch: Jet slam unlocks at 15, Barrage waits for 18');
  g.handle('p', { t: 'branch', id: 'heavy' });
  check(p.branch === 'vanguard', 'branch: switching paths needs a reset');
  const avg = Object.values(MISSIONS).reduce((a, m) => a + m.reward, 0) / Object.keys(MISSIONS).length;
  check(BRANCH_RESET_COST === 3 * Math.round(avg), `branch: a reset costs three average jobs (${BRANCH_RESET_COST}cr)`);
  p.credits = BRANCH_RESET_COST - 1;
  g.handle('p', { t: 'branch', reset: 1 });
  check(p.branch === 'vanguard', "branch: no reset if you can't pay");
  p.credits = BRANCH_RESET_COST + 100;
  g.handle('p', { t: 'branch', reset: 1 });
  check(!p.branch && p.adv === 'commando' && p.credits === 100, 'branch: a reset takes you back to Commando and charges you');
  check(!Object.values(p.slots).includes('slam'), "branch: the old path's abilities come off your keys");
  g.handle('p', { t: 'branch', id: 'heavy' });
  check(p.branch === 'heavy', 'branch: then the other path can be taken');
  g.addXp(p, L18);
  check(unlockedPool(p).some((a) => a.id === 'turret'), 'branch: level 18 unlocks the second branch ability');
  g.removePlayer('p');
  g.addPlayer('p', { name: 'B', cls: 'soldier' });
  check(g.playerOf('p').branch === 'heavy', 'branch: saved with the callsign');
}

// ---------------------------------------------------------------- Shieldwall Sentinel
{
  const { g, p } = brancher('sentinel', 'aegis');
  place(g, p, -150, -40);
  ab(g, p);
  check(p.overshield >= 45, 'sentinel: Aegis shields the crew');
  run(g, 0.2);
  check(p.overshield >= 45, 'sentinel: and the shield holds while it lasts');
  const s2 = brancher('sentinel', 'taunt');
  place(s2.g, s2.p, -150, -40);
  ab(s2.g, s2.p);
  const hp = s2.p.hp;
  s2.g.damage(s2.p, 50, null, { kind: 'bolt' });
  check(hp - s2.p.hp < 30, `sentinel: Challenge and the aura cut a 50-point hit to ${(hp - s2.p.hp).toFixed(1)}`);
}
// ---------------------------------------------------------------- Bladedancer
{
  const { g, p } = brancher('duelist', 'riposte');
  const [e] = lineUp(g, p, 1, 15);
  p.drawn = true; p.weapon = 'blade';
  faceAt(p, e);
  ab(g, p);
  const b = g.spawnBolt(e, e.x - 1, p.y + 1.2, p.z, -1, 0, 0, 60, 12, 'enemy', 0);
  run(g, 0.5);
  check(b.team === 'player', 'bladedancer: Riposte sends a bolt back without blocking');
  const s2 = brancher('duelist', 'whirl');
  const two = lineUp(s2.g, s2.p, 2, 2);
  two[1].x = s2.p.x - 2; s2.g.rebuildSpatial();
  ab(s2.g, s2.p);
  check(two.every((q) => q.hp < 300 - 90), `bladedancer: Whirlwind cuts both guards (${two.map((q) => (300 - q.hp).toFixed(0))})`);
}
// ---------------------------------------------------------------- Manhunter
{
  const { g, p } = brancher('manhunter', 'net');
  const [e] = lineUp(g, p, 1, 20);
  faceAt(p, e);
  ab(g, p);
  check(e.stagger >= 3, 'manhunter: the snare net pins a guard');
  const s2 = brancher('manhunter', 'hunt');
  const list = lineUp(s2.g, s2.p, 3, 20);
  ab(s2.g, s2.p);
  check(list.every((q) => (q.bountyUntil || 0) > s2.g.time + 20), 'manhunter: Open Season puts a long bounty on everyone ahead');
}
// ---------------------------------------------------------------- Gunfighter
{
  const { g, p } = brancher('gunfighter', 'quickdraw');
  const [e] = lineUp(g, p, 1, 15);
  ab(g, p);
  g.damage(e, 10, p, { kind: 'bolt' });
  check(Math.abs(300 - e.hp - 10 * 1.6 * 1.2) < 0.01, `gunfighter: Quickdraw and the perk hit harder (${(300 - e.hp).toFixed(1)})`);
  p.drawn = true; p.heat = 0; p.lastShot = -9;
  g.handle('p', { t: 'fire', o: [p.x, p.y + 1.5, p.z], d: aim(p, e), c: 1 });
  check(p.heat === 0, 'gunfighter: Quickdraw shots run cold');
  const s2 = brancher('gunfighter', 'trickshot');
  const list = lineUp(s2.g, s2.p, 3, 12);
  list[1].z += 6; list[2].z -= 6; s2.g.rebuildSpatial();
  ab(s2.g, s2.p);
  run(s2.g, 1.5);
  check(list.filter((q) => q.hp < 300).length >= 2, `gunfighter: trick shot bolts curve into ${list.filter((q) => q.hp < 300).length} guards`);
}
// ---------------------------------------------------------------- Vanguard
{
  const { g, p, sent } = brancher('vanguard', 'slam');
  const [e] = lineUp(g, p, 1, 3);
  ab(g, p);
  check(sent.some((m) => m.t === 'imp'), 'vanguard: Jet slam launches you');
  run(g, 1.2);
  check(e.hp < 300 - 40, `vanguard: and lands like a charge (${(300 - e.hp).toFixed(0)} damage)`);
  const s2 = brancher('vanguard', 'barrage');
  const [t] = lineUp(s2.g, s2.p, 1, 25);
  s2.p.pitch = Math.atan2(-1.5, 25);
  ab(s2.g, s2.p);
  run(s2.g, 3.5);
  check(t.hp < 300, `vanguard: Barrage shells the marked ground (${(300 - t.hp).toFixed(0)} damage)`);
  const jets = brancher('vanguard', 'jets');
  ab(jets.g, jets.p);
  const left = jets.p.cdk.jets - jets.g.time;
  check(left < 7 * 0.65, `vanguard: jump jets recharge faster (${left.toFixed(1)}s)`);
}
// ---------------------------------------------------------------- Heavy Gunner
{
  const { g, p } = brancher('heavy', 'rail');
  const list = lineUp(g, p, 3, 20);
  ab(g, p, 'q', { d: aim(p, list[0]), o: [p.x, p.y + 1.5, p.z] });
  run(g, 0.5);
  check(list.every((q) => q.hp < 300 - 150), `heavy: the rail shot goes through all three (${list.map((q) => (300 - q.hp).toFixed(0))})`);
  const s2 = brancher('heavy', 'turret');
  const [e] = lineUp(s2.g, s2.p, 1, 16);
  s2.p.yaw = Math.PI / 2; // set it down behind you
  ab(s2.g, s2.p);
  const tur = [...s2.g.ents.values()].find((q) => q.kind === K.TURRET);
  check(!!tur, 'heavy: deploys a sentry turret');
  run(s2.g, 3);
  check(e.hp < 300, `heavy: the turret shoots the guard (${(300 - e.hp).toFixed(0)} damage)`);
  run(s2.g, 19);
  check(!s2.g.ents.has(tur.id), 'heavy: and runs down after 20 seconds');
}
// ---------------------------------------------------------------- Field Medic
{
  const { g, p } = brancher('lifeline', 'field');
  place(g, p, -150, -40);
  ab(g, p);
  p.hp = 50; p.lastHurt = g.time;
  run(g, 2);
  check(p.hp > 60, `field medic: the mending field heals (${p.hp.toFixed(0)})`);
  const s2 = brancher('lifeline', 'lifeline');
  place(s2.g, s2.p, -150, -40);
  ab(s2.g, s2.p);
  s2.g.damage(s2.p, 999, null, { kind: 'bolt' });
  check(!s2.p.downed && s2.p.hp >= 1, 'field medic: Lifeline keeps you up through a killing blow');
  // revives take half the time
  const two = setup('medic', { xp: L18, advs: { medic: 'surgeon' }, locked: 'medic', branch: 'lifeline', cls: 'medic' }, 'R1');
  two.g.addPlayer('q', { name: 'R2', cls: 'soldier' });
  const mate = two.g.playerOf('q');
  place(two.g, two.p, -150, -40); place(two.g, mate, -150, -41.2);
  two.g.downPlayer(mate); two.g.rebuildSpatial();
  two.p.yaw = Math.PI; // facing south toward the mate
  const c = two.g.pickInteract(two.p);
  check(c && c.hold === 0.5, `field medic: revives in ${c && c.hold}s`);
}
// ---------------------------------------------------------------- Toxicologist
{
  const { g, p } = brancher('toxin', 'cloud');
  const [e] = lineUp(g, p, 1, 12);
  faceAt(p, e); p.pitch = Math.atan2(-1.5, 12);
  ab(g, p);
  run(g, 3);
  check(e.hp < 300 - 20 && !g.alarm.active, `toxicologist: the cloud chokes a guard without a sound (${(300 - e.hp).toFixed(0)} damage)`);
  const s2 = brancher('toxin', 'sedate');
  const [t] = lineUp(s2.g, s2.p, 1, 30);
  faceAt(s2.p, t);
  ab(s2.g, s2.p);
  run(s2.g, 0.5);
  check(t.dead && !s2.g.alarm.active, 'toxicologist: a sedative dart drops a guard silently');
  const s3 = brancher('toxin');
  const [u] = lineUp(s3.g, s3.p, 1, 10);
  s3.g.damage(u, 10, s3.p, { kind: 'bolt' });
  const h0 = u.hp;
  run(s3.g, 2);
  check(u.hp < h0 - 8, `toxicologist: bolts leave poison behind (${(h0 - u.hp).toFixed(1)} more)`);
}
// ---------------------------------------------------------------- Infiltrator
{
  const { g, p } = brancher('infiltrator', 'disguise');
  const [e] = lineUp(g, p, 1, 12);
  ab(g, p);
  run(g, 0.2);
  check(p.visibility < 0.1, `infiltrator: disguised, guards barely register you (${p.visibility.toFixed(2)})`);
  e.x = p.x + 2.5; g.rebuildSpatial(); run(g, 0.2);
  check(p.visibility > 0.3, `infiltrator: up close they look twice (${p.visibility.toFixed(2)})`);
  p.drawn = true; p.lastShot = -9;
  g.handle('p', { t: 'fire', o: [p.x, p.y + 1.5, p.z], d: aim(p, e), c: 1 });
  check(!((p.act.disguise || 0) > g.time), 'infiltrator: shooting blows the disguise');
  const s2 = brancher('infiltrator', 'blackout');
  const cam = [...s2.g.ents.values()].find((q) => q.kind === K.CAMERA);
  place(s2.g, s2.p, cam.x + 6, cam.z + 6);
  ab(s2.g, s2.p);
  run(s2.g, 0.2);
  check((cam.blindUntil || 0) > s2.g.time && (cam.flags & F.OFF), 'infiltrator: Blackout blinds the cameras');
}
// ---------------------------------------------------------------- Saboteur
{
  const { g, p } = brancher('saboteur', 'emp');
  const [e] = lineUp(g, p, 1, 6);
  ab(g, p);
  check(e.stagger >= 2, 'saboteur: the EMP stuns nearby guards');
  const s2 = brancher('saboteur', 'overload');
  const [t] = lineUp(s2.g, s2.p, 1, 25);
  faceAt(s2.p, t);
  ab(s2.g, s2.p);
  run(s2.g, 1);
  check(t.hp < 300 - 80, `saboteur: Overload blows a trooper's power pack (${(300 - t.hp).toFixed(0)} damage)`);
  const sec = s2.g.world.terminals.find((q) => q.kind === 'security');
  place(s2.g, s2.p, sec.x - 1, sec.z); s2.p.yaw = Math.atan2(-(sec.x - s2.p.x), -(sec.z - s2.p.z));
  const c = s2.g.pickInteract(s2.p);
  check(c && Math.abs(c.hold - 4 / 3) < 0.01, `saboteur: slices security three times as fast (${c && c.hold.toFixed(2)}s)`);
}
// ---------------------------------------------------------------- Wraith
{
  const { g, p } = brancher('wraith', 'blink');
  place(g, p, -180, -114); p.yaw = -Math.PI / 2;
  const x0 = p.x;
  ab(g, p);
  check(p.x - x0 > 6, `wraith: Shadow blink jumps ${(p.x - x0).toFixed(1)} m ahead`);
  const s2 = brancher('wraith', 'veil');
  place(s2.g, s2.p, -150, -40);
  ab(s2.g, s2.p);
  check((s2.p.act.cloak || 0) > s2.g.time, 'wraith: Veil cloaks the crew');
  const s3 = brancher('wraith', 'phase');
  place(s3.g, s3.p, -150, -40);
  ab(s3.g, s3.p);
  check(s3.p.act.cloak - s3.g.time > 11, `wraith: phase cloak lasts longer (${(s3.p.act.cloak - s3.g.time).toFixed(1)}s)`);
}
// ---------------------------------------------------------------- Longshot
{
  const { g, p } = brancher('longshot', 'ricochet');
  const list = lineUp(g, p, 3, 30);
  list[1].x = list[0].x + 4; list[1].z = list[0].z + 4; list[2].x = list[0].x + 4; list[2].z = list[0].z - 4;
  g.rebuildSpatial();
  ab(g, p);
  g.damage(list[0], 50, p, { kind: 'bolt' });
  run(g, 0.3);
  check(list[1].hp < 300 && list[2].hp < 300, 'longshot: the ricochet round jumps to two more guards');
  const s2 = brancher('longshot', 'execmark');
  const [t] = lineUp(s2.g, s2.p, 1, 30);
  ab(s2.g, s2.p);
  t.markedUntil = s2.g.time + 5;
  s2.g.damage(t, 10, s2.p, { kind: 'bolt' });
  check(Math.abs(300 - t.hp - 10 * 2 * 1.25) < 0.01, `longshot: the Executioner's mark doubles damage on marked targets (${(300 - t.hp).toFixed(1)})`);
}

console.log(failures ? `\n${failures} branch check(s) FAILED` : '\nAll branch checks passed');
process.exit(failures ? 1 : 0);
