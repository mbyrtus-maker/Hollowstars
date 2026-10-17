// Exercises every class ability against the authoritative simulation.
// Run: node tools/classes-test.js
import { Game } from '../shared/sim/game.js';
import { K, TICK_DT } from '../shared/config.js';
import { groundAt, DUSK_SHIFT as S } from '../shared/world.js';

let failures = 0;
const check = (c, msg) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${msg}`); if (!c) failures++; };
const run = (g, s) => { for (let i = 0; i < s / TICK_DT; i++) g.tick(TICK_DT); };
const place = (g, p, x, z) => { p.tpSeq++; p.x = x; p.z = z; p.y = groundAt(g.world, x, z, 60) + 0.02; };
const faceAt = (p, e) => { p.yaw = Math.atan2(-(e.x - p.x), -(e.z - p.z)); p.pitch = Math.atan2(e.y + 1 - (p.y + 1.5), Math.hypot(e.x - p.x, e.z - p.z)); };
const guard = (g, name) => [...g.ents.values()].find((e) => e.ai && e.ai.name === name);
function setup(cls, n = 1) {
  const g = new Game({ send: () => {}, solo: n === 1 });
  const ps = [];
  for (let i = 0; i < n; i++) { g.addPlayer('p' + i, { name: 'T' + i, cls: Array.isArray(cls) ? cls[i] : cls }); ps.push(g.playerOf('p' + i)); }
  g.rebuildSpatial();
  return { g, ps };
}
// Freeze a guard in a calm routine so tests are deterministic
const calm = (e) => { e.ai.state = 'routine'; e.ai.sus = 0; e.ai.wait = 60; e.vx = e.vz = 0; };

// ---- loadouts
for (const [cls, weapon] of [['warden', 'blade'], ['gunslinger', 'pistols'], ['soldier', 'blaster'], ['medic', 'pistol'], ['spy', 'knives']]) {
  const { ps: [p] } = setup(cls);
  check(p.cls === cls && p.weapon === weapon, `${cls}: starts with ${weapon} (grenades ${p.grenades}, medpacks ${p.medpacks})`);
}

// ---- Warden: no blaster, suggest, wanted
{
  const { g, ps: [p] } = setup('warden');
  g.handle('p0', { t: 'fire', o: [p.x, p.y + 1.4, p.z], d: [1, 0, 0] });
  check(g.bolts.length === 0, 'warden: cannot fire a blaster');
  for (const o of [...g.ents.values()]) if ((o.kind === K.LANCER || o.kind === K.OFFICER || o.kind === K.CAMERA) && o.ai.name !== 'court') g.removeEnt(o);
  const e = guard(g, 'court'); calm(e);
  place(g, p, e.x + 8, e.z); faceAt(p, e); g.rebuildSpatial();
  e.ai.state = 'combat'; e.ai.alert = 2; e.ai.sus = 1; e.ai.target = p.id; e.ai.lkp = { x: p.x, y: p.y, z: p.z };
  g.handle('p0', { t: 'ab', k: 'x', yaw: p.yaw, pitch: p.pitch });
  check(e.ai.state === 'search' && e.ai.ignore && e.ai.ignore.id === p.id, 'warden: Suggest makes a guard in combat lose you');
  e.ai.state = 'routine'; e.ai.wait = 60;
  run(g, 2);
  check(e.ai.sus < 0.2, `warden: suggested guard ignores you while you stand in front of him (sus ${e.ai.sus.toFixed(2)})`);
  // hunters
  place(g, p, -20, -60); g.hunterT = 0; run(g, 0.2);
  const hunters = [...g.ents.values()].filter((x) => x.hunter);
  check(hunters.length === 3 && hunters.every((h) => h.ai.state === 'combat'), `warden: a hunter squad spawns in the open desert (${hunters.length})`);
}

// ---- Gunslinger
{
  const { g, ps: [p] } = setup('gunslinger');
  place(g, p, -150, 40);
  let bolts = 0; const sb = g.spawnBolt.bind(g); g.spawnBolt = (...a) => { bolts++; return sb(...a); };
  g.handle('p0', { t: 'ab', k: 'q', yaw: 0, pitch: 0, d: [0, 0, -1] });
  run(g, 0.6);
  check(bolts === 6, `gunslinger: Fan fire empties a 6-bolt burst (${bolts})`);
  g.handle('p0', { t: 'ab', k: 'f' });
  const hp = p.hp; g.damage(p, 30, null, {});
  check(p.hp === hp, 'gunslinger: Dodge roll grants a moment of invulnerability');
  g.handle('p0', { t: 'ab', k: 'x' });
  check(p.act.deadeye > g.time, 'gunslinger: Deadeye activates');
}

// ---- Soldier
{
  const { g, ps: [p] } = setup('soldier');
  g.handle('p0', { t: 'ab', k: 'f' });
  const hp = p.hp; g.damage(p, 50, null, {});
  check(p.hp === hp && p.overshield === 20, `soldier: Bulwark absorbs damage (overshield left ${p.overshield})`);
  g.handle('p0', { t: 'ab', k: 'q' });
  for (let i = 0; i < 20; i++) { g.time += 0.12; g.handle('p0', { t: 'fire', o: [p.x, p.y + 1.4, p.z], d: [1, 0, 0] }); }
  check(p.heat === 0 && !p.overheated, 'soldier: Suppressive fire never overheats');
}

// ---- Medic
{
  const { g, ps: [m, a] } = setup(['medic', 'soldier'], 2);
  place(g, m, -150, 40); place(g, a, -150, 25); g.rebuildSpatial();
  g.downPlayer(a);
  faceAt(m, a); m.pitch = -0.05;
  g.handle('p0', { t: 'ab', k: 'f', yaw: m.yaw, pitch: m.pitch });
  check(!a.downed && a.hp > 40, `medic: Stim dart revives a downed teammate at range (hp ${Math.round(a.hp)})`);
  a.hp = 30; place(g, a, -151, 41); g.rebuildSpatial();
  g.handle('p0', { t: 'ab', k: 'q' });
  check(a.hp === 70, 'medic: Med burst heals nearby crew');
  g.downPlayer(a); place(g, m, a.x + 1.2, a.z); faceAt(m, a); g.rebuildSpatial();
  const c = g.pickInteract(m);
  check(c && c.id.startsWith('revive') && c.hold === 1, 'medic: revives take one second');
}

// ---- Spy
{
  const { g, ps: [p] } = setup('spy');
  g.camerasOn = false; g.camOffUntil = 1e9;
  const e = guard(g, 'depot'); calm(e);
  place(g, p, e.x + 5, e.z); faceAt(p, e); p.crouch = true; g.rebuildSpatial();
  const before = g.alarm.active;
  g.handle('p0', { t: 'ab', k: 'q', yaw: p.yaw, pitch: p.pitch });
  check(e.dead, 'spy: Execute kills an unaware guard');
  check(Math.hypot(p.x - e.x, p.z - e.z) < 2, `spy: Execute blinks you in behind the target (${Math.hypot(p.x - e.x, p.z - e.z).toFixed(1)}m)`);
  run(g, 1);
  check(!g.alarm.active && !before, 'spy: the execution is silent — no alarm');
  // Execute on an alert, healthy guard staggers instead of killing
  const e2 = guard(g, 'sec'); calm(e2); e2.ai.state = 'combat'; e2.ai.sus = 1;
  e2.x = 138 + S; e2.z = 13; e2.y = groundAt(g.world, 138 + S, 13, 30);
  place(g, p, 142 + S, 13); faceAt(p, e2); g.rebuildSpatial(); p.cdk.q = 0;
  g.handle('p0', { t: 'ab', k: 'q', yaw: p.yaw, pitch: p.pitch });
  check(!e2.dead && e2.stagger > 0, 'spy: Execute on a healthy, alert guard is a heavy staggering hit');
  // Throwing knife
  const e3 = guard(g, 'courier'); calm(e3);
  e3.x = 133 + S; e3.z = -2; e3.y = groundAt(g.world, 133 + S, -2, 30);
  place(g, p, 133 + S, 8); faceAt(p, e3); g.rebuildSpatial();
  const dir = [e3.x - p.x, e3.y + 1.2 - (p.y + 1.4), e3.z - p.z]; const l = Math.hypot(...dir);
  g.handle('p0', { t: 'ab', k: 'f', o: [p.x, p.y + 1.4, p.z], d: dir.map((v) => v / l) });
  run(g, 0.5);
  check(e3.dead && p.knives === 2, 'spy: a thrown knife silently kills an unaware guard');
  // Cloak
  place(g, p, 140 + S, 0); p.crouch = false;
  g.handle('p0', { t: 'ab', k: 'x' });
  run(g, 0.2);
  check(p.visibility < 0.1, `spy: Cloak makes you nearly invisible (${p.visibility.toFixed(2)})`);
  // Noisemaker
  const e4 = guard(g, 'mess-b'); calm(e4); e4.ai.wait = 0;
  place(g, p, e4.x + 18, e4.z + 4);
  g.handle('p0', { t: 'gren', o: [e4.x + 6, e4.y + 1.5, e4.z], d: [0, -0.2, 0.0001] });
  run(g, 2.2);
  check(e4.ai.state === 'investigate', `spy: a noisemaker draws a guard to investigate (${e4.ai.state})`);
}

// ---- Cloak breaks sight, even during an alarm
{
  const { g, ps: [p] } = setup('spy');
  for (const o of [...g.ents.values()]) if ((o.kind === K.LANCER || o.kind === K.OFFICER || o.kind === K.CAMERA) && o.ai.name !== 'court') g.removeEnt(o);
  const e = guard(g, 'court'); calm(e);
  place(g, p, e.x + 7, e.z); p.crouch = false; g.rebuildSpatial();
  e.yaw = Math.atan2(-(p.x - e.x), -(p.z - e.z));
  run(g, 1.5);
  check(e.ai.state === 'combat' && g.time - e.ai.lastSeen < 0.3, 'cloak: guard has spotted the spy standing in front of him');
  g.triggerAlarm('test');
  g.handle('p0', { t: 'ab', k: 'x' });
  let shots = 0; const sb = g.spawnBolt.bind(g); g.spawnBolt = (o, ...a) => { if (o === e) shots++; return sb(o, ...a); };
  run(g, 3);
  check(g.time - e.ai.lastSeen > 2.5, 'cloak: activating it breaks the guard\'s sight immediately, alarm or not');
  check(shots === 0, `cloak: the guard stops shooting at you (${shots} shots)`);
}

// ---- Alarm resets after 30 seconds without a sighting
{
  const { g, ps: [p] } = setup('soldier');
  g.camerasOn = false; g.camOffUntil = 1e9;
  place(g, p, 140 + S, 0); p.crouch = false;
  for (let i = 0; i < 300 && !g.alarm.active; i++) g.tick(0.05);
  check(g.alarm.active, 'alarm: raised after being spotted in the courtyard');
  run(g, 0.5);
  place(g, p, -40, -60); // vanish into the desert
  run(g, 20);
  check(g.alarm.active, 'alarm: still active 20 seconds after the last sighting');
  run(g, 13);
  check(!g.alarm.active, 'alarm: stands down once 30 seconds pass with no sighting');
}

// ---------------------------------------------------------------- arc blade deflection
{
  const { g, ps: [p] } = setup('warden');
  place(g, p, -150, 40);
  p.drawn = true; p.blocking = false; p.yaw = 0; p.pitch = 0.05; p.focus = 100;
  g.rebuildSpatial();
  const shooter = { id: 9999, x: p.x, y: p.y, z: p.z - 20, kind: K.LANCER };
  const fire = (fromX, fromZ) => {
    const ox = fromX, oz = fromZ, oy = p.y + 1.3;
    const dx = p.x - ox, dz = p.z - oz, l = Math.hypot(dx, dz);
    return g.spawnBolt(shooter, ox, oy, oz, dx / l, 0, dz / l, 60, 12, 'enemy', 0);
  };
  const hp0 = p.hp;
  const b = fire(p.x + 3, p.z - 18);
  for (let i = 0; i < 12; i++) g.tick(TICK_DT);
  const sp = Math.hypot(b.vx, b.vy, b.vz);
  const aim = { x: -Math.sin(p.yaw) * Math.cos(p.pitch), y: Math.sin(p.pitch), z: -Math.cos(p.yaw) * Math.cos(p.pitch) };
  const dot = (b.vx * aim.x + b.vy * aim.y + b.vz * aim.z) / sp;
  check(b.team === 'player' && p.hp === hp0, 'blade: a bolt from the front is caught without holding block');
  check(dot > 0.99, `blade: the deflection flies where the Warden is facing (cos ${dot.toFixed(3)})`);
  p.yaw = Math.PI / 2; // now face away from the next shot's line... it comes from the back-right
  const b2 = fire(p.x + 18, p.z + 3);
  for (let i = 0; i < 12; i++) g.tick(TICK_DT);
  check(b2.team === 'enemy' || !g.bolts.includes(b2), 'blade: a bolt from behind still gets through');
  p.drawn = false; p.yaw = 0;
  const b3 = fire(p.x + 3, p.z - 18);
  for (let i = 0; i < 12; i++) g.tick(TICK_DT);
  check(b3.team === 'enemy', 'blade: holstered, nothing is deflected');
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll class checks passed');
process.exit(failures ? 1 : 0);
