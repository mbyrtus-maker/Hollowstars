// XP, levels, the Sniper and every advanced class, against the real simulation.
// Run: node tools/career-test.js
import { Game } from '../shared/sim/game.js';
import { K, F, TICK_DT, levelOf, xpToNext, LEVELS, effectiveClass } from '../shared/config.js';
import { groundAt, DUSK_SHIFT as S } from '../shared/world.js';

let failures = 0;
const check = (c, msg) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${msg}`); if (!c) failures++; };
const run = (g, s) => { for (let i = 0; i < s / TICK_DT; i++) g.tick(TICK_DT); };
const place = (g, p, x, z) => { p.tpSeq++; p.x = x; p.z = z; p.y = groundAt(g.world, x, z, 60) + 0.02; };
const faceAt = (p, e) => { p.yaw = Math.atan2(-(e.x - p.x), -(e.z - p.z)); p.pitch = Math.atan2(e.y + 1.1 - (p.y + 1.5), Math.hypot(e.x - p.x, e.z - p.z)); };
const aim = (p, e) => { const dx = e.x - p.x, dy = e.y + 1.1 - (p.y + 1.5), dz = e.z - p.z, l = Math.hypot(dx, dy, dz); return [dx / l, dy / l, dz / l]; };
const calm = (e) => { e.ai.state = 'routine'; e.ai.sus = 0; e.ai.wait = 60; e.vx = e.vz = 0; };
const saved = {};
function setup(cls, xp = 0, adv) {
  if (xp) saved.T = { xp, advs: adv ? { [cls]: adv } : {} }; else delete saved.T;
  const g = new Game({ send: () => {}, solo: true, saveProfile: (n, d) => { saved[n] = d; }, loadProfile: (n) => saved[n] || null });
  g.addPlayer('p', { name: 'T', cls });
  const p = g.playerOf('p');
  delete saved.T;
  g.rebuildSpatial();
  return { g, p };
}
const guards = (g) => [...g.ents.values()].filter((e) => e.kind === K.LANCER && !e.dead);
const ab = (g, p, k, extra = {}) => g.handle('p', { t: 'ab', k, yaw: p.yaw, pitch: p.pitch, ...extra });
const fire = (g, p, d) => { p.drawn = true; p.lastShot = -9; g.handle('p', { t: 'fire', o: [p.x, p.y + 1.5, p.z], d, c: 1 }); };
// guards standing in a line down the open lane between Khet's farm plots
function lineUp(g, p, n = 2, dist = 30) {
  place(g, p, -180, -114); p.yaw = -Math.PI / 2;
  const list = guards(g).slice(0, n);
  list.forEach((e, i) => { calm(e); e.x = p.x + dist + i * 3; e.z = p.z; e.y = groundAt(g.world, e.x, e.z, 60); });
  g.rebuildSpatial();
  return list;
}

// ---------------------------------------------------------------- levels
{
  check(levelOf(0).lv === 1 && levelOf(99).lv === 1 && levelOf(100).lv === 2, 'xp: level 2 at 100 xp');
  let total = 0; for (let l = 1; l < LEVELS.advancedAt; l++) total += xpToNext(l);
  check(levelOf(total).lv === LEVELS.advancedAt, `xp: level ${LEVELS.advancedAt} takes ${total} xp`);
  const { g, p } = setup('soldier');
  const hp0 = p.maxHp;
  const e = guards(g)[0];
  g.damage(e, 999, p, { kind: 'bolt' });
  check(p.xp === 25, `xp: a Lancer kill is worth 25 (${p.xp})`);
  g.addXp(p, 80);
  check(levelOf(p.xp).lv === 2 && p.maxHp === hp0 + LEVELS.hpPer, `xp: level 2 adds health (${hp0} -> ${p.maxHp})`);
  g.handle('p', { t: 'adv', id: 'commando' });
  check(!p.adv, 'career: advanced classes stay locked below level 10');
  g.addXp(p, total);
  g.handle('p', { t: 'adv', id: 'phantom' });
  check(!p.adv, "career: you can't take another class's advanced class");
  g.handle('p', { t: 'adv', id: 'commando' });
  check(p.adv === 'commando' && p.maxHp >= 100 + 30, `career: a level ${levelOf(p.xp).lv} Soldier becomes a Commando (${p.maxHp} hp)`);
  g.removePlayer('p');
  g.addPlayer('p', { name: 'T', cls: 'soldier' });
  check(g.playerOf('p').adv === 'commando', 'career: the advanced class is saved with your callsign');
}

// ---------------------------------------------------------------- Sniper
{
  const { g, p } = setup('sniper');
  check(p.weapon === 'longlas', 'sniper: carries the long-las');
  place(g, p, 140 + S, 45); p.yaw = 0;
  const [a] = lineUp(g, p, 1, 55);
  faceAt(p, a);
  fire(g, p, aim(p, a));
  run(g, 0.6);
  check(a.dead, 'sniper: one body shot drops a Lancer at 55 m');
  // overcharge pierces two in a line
  const { g: g2, p: q } = setup('sniper');
  place(g2, q, 140 + S, 45); q.yaw = 0;
  const two = lineUp(g2, q, 3, 30);
  two.forEach((e) => { e.hp = e.maxHp = 200; });
  faceAt(q, two[0]);
  ab(g2, q, 'q');
  fire(g2, q, aim(q, two[0]));
  run(g2, 0.6);
  const hurt = two.filter((e) => e.hp < 200).length;
  check(hurt === 3, `sniper: an overcharged shot punches through ${hurt} guards in a line`);
  // proximity mine
  const { g: g3, p: r } = setup('sniper');
  place(g3, r, -150, -40); r.yaw = 0;
  ab(g3, r, 'f');
  const mine = [...g3.ents.values()].find((e) => e.kind === K.MINE);
  check(!!mine && r.mines === 1, 'sniper: plants a proximity mine');
  run(g3, 2);
  const e = guards(g3)[0]; calm(e);
  e.x = mine.x + 1; e.z = mine.z; e.y = mine.y;
  g3.rebuildSpatial();
  run(g3, 0.3);
  check(e.dead && !g3.ents.has(mine.id), 'sniper: the mine goes off under a guard');
  // recon
  const { g: g4, p: s } = setup('sniper');
  place(g4, s, 110 + S, 0); s.yaw = -Math.PI / 2; // facing east into the garrison
  ab(g4, s, 'x');
  g4.rebuildSpatial(); g4.tick(TICK_DT);
  const marked = guards(g4).filter((e) => g4.encodeEnt(e)[6] & F.MARKED).length;
  check(marked >= 4, `sniper: recon sweep marks ${marked} guards for the crew`);
  // camouflage
  s.crouch = true; s.vx = s.vz = 0;
  place(g4, s, -150, -40);
  run(g4, 0.2); const v0 = s.visibility;
  run(g4, 1.5);
  check(s.visibility < v0 * 0.7, `sniper: staying low and still melts into cover (${v0.toFixed(2)} -> ${s.visibility.toFixed(2)})`);
}

// ---------------------------------------------------------------- advanced classes
const L10 = 2800;
{
  // Guardian: Bastion swallows enemy bolts
  const { g, p } = setup('warden', L10, 'guardian');
  check(p.adv === 'guardian' && effectiveClass('warden', 'guardian').abilities.x.id === 'bastion', 'guardian: Bastion replaces Suggest');
  place(g, p, -150, -40); p.focus = 100;
  ab(g, p, 'x');
  const shooter = { id: 99999, kind: K.LANCER, x: p.x + 20, y: p.y, z: p.z };
  const b = g.spawnBolt(shooter, p.x - 20, p.y + 1.2, p.z, 1, 0, 0, 60, 12, 'enemy', 0);
  const hp = p.hp;
  run(g, 0.8);
  check(!g.bolts.includes(b) && p.hp === hp, 'guardian: the Bastion dome stops a bolt fired at the crew');
}
{
  // Bounty Hunter: mark takes +50%, wrist rocket explodes
  const { g, p } = setup('gunslinger', L10, 'bounty');
  place(g, p, 140 + S, 45); p.yaw = 0;
  const [a, b] = lineUp(g, p, 2, 20);
  a.hp = a.maxHp = 500;
  faceAt(p, a);
  ab(g, p, 'x');
  check((a.bountyUntil || 0) > g.time, 'bounty hunter: marks a target');
  g.damage(a, 10, p, { kind: 'bolt' });
  check(Math.abs(500 - a.hp - 15) < 0.01, `bounty hunter: the mark takes half again the damage (${(500 - a.hp).toFixed(1)})`);
  b.hp = b.maxHp = 60;
  faceAt(p, b);
  const d = aim(p, b);
  ab(g, p, 'f', { d, o: [p.x, p.y + 1.5, p.z] });
  run(g, 1.2);
  check(b.hp < 60, `bounty hunter: the wrist rocket explodes on target (${b.hp.toFixed(0)} hp left)`);
}
{
  // Commando: jump jets and swarm rockets
  const sent = [];
  const g = new Game({ send: (c, m) => sent.push(JSON.parse(m)), solo: true, loadProfile: () => ({ xp: L10, advs: { soldier: 'commando' } }) });
  g.addPlayer('p', { name: 'C', cls: 'soldier' });
  const p = g.playerOf('p');
  place(g, p, 140 + S, 45); p.yaw = 0;
  g.rebuildSpatial();
  ab(g, p, 'f');
  check(sent.some((m) => m.t === 'imp' && m.v[1] > 10), 'commando: jump jets throw you into the air');
  const targets = lineUp(g, p, 3, 25);
  targets.forEach((e, i) => { e.z += (i - 1) * 2.5; });
  g.rebuildSpatial();
  p.cdk = {};
  ab(g, p, 'x');
  run(g, 3);
  const dead = targets.filter((e) => e.dead || e.hp < e.maxHp).length;
  check(dead >= 2, `commando: swarm rockets home in on ${dead} targets`);
}
{
  // Combat Surgeon: adrenaline
  const { g, p } = setup('medic', L10, 'surgeon');
  place(g, p, -150, -40);
  ab(g, p, 'x');
  check((p.act.adrenal || 0) > g.time && p.overshield >= 30, 'combat surgeon: adrenaline gives an overshield');
  const e = guards(g)[0]; e.hp = e.maxHp = 200;
  g.damage(e, 10, p, { kind: 'bolt' });
  check(Math.abs(200 - e.hp - 12.5) < 0.01, 'combat surgeon: and a quarter more damage');
}
{
  // Agent: suppressed pistol, decoy, quick slicing
  const { g, p } = setup('spy', L10, 'agent');
  check(p.weapon === 'silenced', 'agent: carries a suppressed pistol');
  place(g, p, 100 + S, 0); p.yaw = -Math.PI / 2; p.pitch = 0;
  const e = guards(g).find((q) => q.ai.name === 'court'); calm(e); e.ai.wait = 0;
  g.rebuildSpatial();
  ab(g, p, 'f');
  const decoy = [...g.ents.values()].find((q) => q.kind === K.DECOY);
  check(!!decoy, 'agent: projects a holo-decoy');
  e.x = decoy.x + 10; e.z = decoy.z; e.y = groundAt(g.world, e.x, e.z, 60);
  g.rebuildSpatial();
  run(g, 2);
  check(e.ai.state === 'investigate' || e.ai.state === 'search', `agent: a guard goes to check out the decoy (${e.ai.state})`);
  g.rebuildSpatial();
  const sec = g.world.terminals.find((t) => t.kind === 'security');
  place(g, p, sec.x - 1, sec.z); p.yaw = Math.atan2(-(sec.x - p.x), -(sec.z - p.z));
  const c = g.pickInteract(p);
  check(c && c.hold === 2, `agent: slices security in ${c && c.hold}s instead of 4`);
}
{
  // Phantom: a shot from phase cloak stays hidden
  const { g, p } = setup('sniper', L10, 'phantom');
  place(g, p, 140 + S, 45); p.yaw = 0;
  const [a] = lineUp(g, p, 1, 40);
  faceAt(p, a);
  ab(g, p, 'x');
  check((p.act.cloak || 0) > g.time, 'phantom: phase cloak engages');
  fire(g, p, aim(p, a));
  check((p.act.cloak || 0) > g.time + 1, 'phantom: the first shot from phase cloak keeps you cloaked');
  run(g, 1.2);
  fire(g, p, aim(p, a));
  check((p.act.cloak || 0) < g.time + 0.5, 'phantom: the second shot gives you away');
}

console.log(failures ? `\n${failures} career check(s) FAILED` : '\nAll career checks passed');
process.exit(failures ? 1 : 0);
