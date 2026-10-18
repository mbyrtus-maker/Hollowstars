// Flies the crew between worlds and plays the two off-world missions end to end.
// Run: node tools/travel-test.js
import { Game } from '../shared/sim/game.js';
import { K, TICK_DT } from '../shared/config.js';
import { groundAt, navWalkable, findPath, createWorld, useWorld } from '../shared/world.js';
import { PLANETS } from '../shared/planets.js';
import { garrisonRoster } from '../shared/sim/ai.js';

let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };

// ---------------------------------------------------------------- every world is sound
for (const id of Object.keys(PLANETS)) {
  const W = createWorld(id);
  useWorld(W);
  const sp = W.pois.spawn;
  check(navWalkable(W, sp.x, sp.z), `${id}: spawn point is walkable`);
  check(W.pois.ship && W.pois.shipBody, `${id}: the Wayfarer is parked here`);
  const bad = [];
  for (const def of garrisonRoster(W)) {
    if (def.tower) continue; // tower guards stand on the platform
    const a = def.tasks[0];
    if (def.tasks.length === 1 && !findPath(W, a.x + 1.5, a.z, a.x, a.z)) bad.push(`${def.name}@${a.x},${a.z} unreachable`);
    // each leg of the patrol, as the guard walks it
    def.tasks.forEach((t, i) => {
      if (i === 0) return;
      const f = def.tasks[i - 1];
      if (!findPath(W, f.x, f.z, t.x, t.z)) bad.push(`${def.name}: no path ${f.x},${f.z} -> ${t.x},${t.z}`);
    });
  }
  check(bad.length === 0, `${id}: every guard waypoint is walkable and reachable${bad.length ? ' — ' + bad.slice(0, 6).join('; ') : ''}`);
    if (id !== 'duskvaro') {
    const p = findPath(W, sp.x, sp.z, W.pois.gate.x, W.pois.gate.z);
    check(!!p, `${id}: you can walk from the landing pad to the site's gate`);
  }
}

function setup() {
  const sent = [];
  const g = new Game({ send: (cid, m) => sent.push(typeof m === 'string' ? JSON.parse(m) : m), solo: true });
  g.addPlayer('p1', { name: 'Tester' });
  const p = g.playerOf('p1');
  const dmg = g.damage.bind(g);
  g.damage = (e, a, s, i) => dmg(e, e.kind === K.PLAYER ? 0 : a, s, i);
  return { g, p, sent };
}
function place(g, p, x, z, yaw = 0) { p.tpSeq++; p.x = x; p.z = z; p.y = groundAt(g.world, x, z, 60) + 0.02; p.yaw = yaw; }
function run(g, seconds) { for (let i = 0; i < seconds / TICK_DT; i++) g.tick(TICK_DT); }
function face(p, x, z) { p.yaw = Math.atan2(-(x - p.x), -(z - p.z)); }
function use(g, p, holdSeconds = 0) {
  g.rebuildSpatial();
  const c = g.pickInteract(p);
  g.handle('p1', { t: 'use', id: c && c.id, down: true });
  if (holdSeconds) run(g, holdSeconds + 0.3);
  g.handle('p1', { t: 'use', down: false });
  return c;
}
const contact = (g, id) => [...g.ents.values()].find((e) => e.kind === K.INFORMANT && e.contact === id);
function talk(g, p, id) { const e = contact(g, id); place(g, p, e.x, e.z + 1.5); face(p, e.x, e.z); const c = use(g, p); run(g, 0.2); return c; }
function fly(g, p, to) {
  const r = g.world.pois.ship;
  place(g, p, r.x, r.z + 0.6); face(p, r.x, r.z - 3);
  const c = use(g, p);
  g.handle('p1', { t: 'boardship' });
  run(g, 0.1);
  check(p.aboard, `boarded the Wayfarer via "${c && c.label}"`);
  g.handle('p1', { t: 'travel', to });
  check(!!g.travel, `launch for ${to} accepted`);
  run(g, 8);
  check(g.planet === to && p.aboard, `${PLANETS[to].name}: the crew stays aboard while the ship lands`);
  run(g, 4.5);
  check(g.planet === to && !p.aboard, `arrived on ${PLANETS[to].name} and walked down the ramp`);
}

// ---------------------------------------------------------------- ship basics
{
  const { g, p, sent } = setup();
  const r = g.world.pois.ship;
  place(g, p, r.x, r.z + 0.6); face(p, r.x, r.z - 3);
  const c = use(g, p); run(g, 0.1);
  check(c && c.id === 'ship' && sent.some((m) => m.t === 'ui' && m.ui === 'ship'), 'ship: the ramp opens the ship menu');
  g.handle('p1', { t: 'boardship' }); run(g, 0.1);
  check(p.aboard, 'ship: and the menu boards the ship');
  const guardsSee = [...g.ents.values()].filter((e) => e.kind === K.LANCER).length > 0;
  check(guardsSee, 'ship: Dusk garrison is populated');
  g.handle('p1', { t: 'travel', to: 'duskvaro' });
  check(!g.travel, "ship: can't fly to the world you're on");
  g.handle('p1', { t: 'disembark' }); run(g, 0.1);
  check(!p.aboard, 'ship: disembarking puts you back on the ramp');
  g.addPlayer('p2', { name: 'Second' });
  const q = g.playerOf('p2');
  use(g, p); g.handle('p1', { t: 'boardship' }); run(g, 0.1);
  g.handle('p1', { t: 'travel', to: 'thessaly' });
  check(!g.travel, 'ship: launch waits for the whole crew to be aboard');
  q.tpSeq++; q.x = r.x; q.z = r.z + 0.5; q.y = p.y; q.yaw = 0;
  g.rebuildSpatial();
  g.handle('p2', { t: 'use', id: 'ship', down: true }); g.handle('p2', { t: 'boardship' }); run(g, 0.1);
  g.handle('p1', { t: 'travel', to: 'thessaly' });
  check(!!g.travel, 'ship: launches once all four... er, both crew are aboard');
  run(g, 8);
  check(g.planet === 'thessaly' && sent.some((m) => m.t === 'planet' && m.id === 'thessaly'), 'ship: clients are told about the new world');
  check(p.aboard && q.aboard && g.pickInteract(p) === null, 'ship: nobody steps off or opens the nav console mid-landing');
  run(g, 4.5);
  const r2 = g.world.pois.ship;
  check(!p.aboard && !q.aboard && Math.hypot(p.x - r2.x, p.z - r2.z) < 4, 'ship: the crew comes down the ramp after touchdown');
  const lancers = [...g.ents.values()].filter((e) => e.kind === K.LANCER || e.kind === K.OFFICER);
  check(lancers.length >= 8, `ship: Harvester Station Kappa is garrisoned (${lancers.length})`);
  check(!!contact(g, 'vessa') && [...g.ents.values()].some((e) => e.kind === K.MERCHANT && e.merchant === 'grell'), 'ship: Lowmarsh has Vessa and Grell');
  run(g, 20);
  check(true, 'ship: Thessaly simulates for 20s without errors');
}

// ---------------------------------------------------------------- Roots of Rebellion
{
  const { g, p } = setup();
  const W = g.world;
  place(g, p, W.pois.board.x, W.pois.board.z + 1.2); face(p, W.pois.board.x, W.pois.board.z);
  g.handle('p1', { t: 'accept', id: 'mire' });
  check(g.mission && g.mission.id === 'mire', 'mire: accepted on Dusk Varo');
  const v = g.globalState().m;
  check(v.away === 'thessaly' && /Fly to Thessaly/.test(v.steps[0][0]) && Math.abs(v.wp[0] - W.pois.ship.x) < 1, 'mire: tracker points at the Wayfarer');
  fly(g, p, 'thessaly');
  const c = talk(g, p, 'vessa');
  check(g.party.items.vessa && g.mission.step === 1, `mire: Vessa briefs the crew (${c && c.label})`);
  for (const k of ['gen0', 'gen1', 'gen2']) {
    const d = g.world.destructibles[k];
    g.damageDestructible ? g.damageDestructible(d, 999, p) : null;
  }
  run(g, 0.3);
  const destroyedAll = ['gen0', 'gen1', 'gen2'].every((k) => g.world.destructibles[k].destroyed);
  check(destroyedAll && g.mission.step === 2, `mire: power cells destroyed (step ${g.mission.step})`);
  const pen = g.world.doors.pen;
  place(g, p, pen.x, pen.z - 1.3); face(p, pen.x, pen.z);
  const pc = use(g, p, 2.8); run(g, 0.3);
  check(pen.open && g.mission.step === 3, `mire: the pen is cut open (${pc && pc.label})`);
  run(g, 6);
  const freed = [...g.ents.values()].filter((e) => e.captive === false && e.kind === K.CIVILIAN || (e.ai && e.ai.freedAt)).length;
  check(freed >= 1, `mire: captives start fleeing home (${freed})`);
  check(g.globalState().m.away === 'duskvaro', 'mire: tracker sends the crew home');
  fly(g, p, 'duskvaro');
  talk(g, p, 'oru');
  check(g.mission && g.mission.status === 'complete', 'mire: reporting to Oru completes the job');
}

// ---------------------------------------------------------------- Cold Storage
{
  const { g, p } = setup();
  const W = g.world;
  place(g, p, W.pois.board.x, W.pois.board.z + 1.2); face(p, W.pois.board.x, W.pois.board.z);
  g.handle('p1', { t: 'accept', id: 'cold' });
  fly(g, p, 'korrun');
  talk(g, p, 'tobin');
  check(g.party.items.vaultcode, 'cold: Tobin hands over the vault code');
  const r = g.world.regions.garrison;
  place(g, p, (r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2 + 6); run(g, 0.3);
  check(g.mission.step === 2, `cold: inside Cryo-Vault Sigma (step ${g.mission.step})`);
  const vd = g.world.doors.vault;
  const side = vd.axis === 'x' ? [vd.x, vd.z + 1.3] : [vd.x + 1.3, vd.z];
  let vc = null;
  for (const [ox, oz] of [[0, 1.3], [0, -1.3], [1.3, 0], [-1.3, 0]]) {
    place(g, p, vd.x + ox, vd.z + oz); face(p, vd.x, vd.z);
    vc = use(g, p); run(g, 0.2);
    if (vd.open) break;
  }
  check(vd.open && g.mission.step === 3, `cold: the code opens the vault (${vc && vc.label})`);
  const t = g.world.terminals.find((t) => t.id === 'cryo');
  let tc = null;
  for (const [ox, oz] of [[0, 1.2], [0, -1.2], [1.2, 0], [-1.2, 0]]) {
    place(g, p, t.x + ox, t.z + oz); face(p, t.x, t.z);
    g.rebuildSpatial();
    const c = g.pickInteract(p);
    if (c && c.id === 'term:cryo') { tc = use(g, p, 6.2); break; }
  }
  run(g, 0.3);
  check(g.party.items.codex && g.mission.step === 4, `cold: codex sliced from the archive (${tc && tc.label})`);
  fly(g, p, 'duskvaro');
  talk(g, p, 'oru');
  check(g.mission && g.mission.status === 'complete', `cold: delivering the codex completes the job (reward ${g.mission && g.mission.reward})`);
}

// ---------------------------------------------------------------- leaving mid-job
{
  const { g, p } = setup();
  const W = g.world;
  place(g, p, W.pois.board.x, W.pois.board.z + 1.2); face(p, W.pois.board.x, W.pois.board.z);
  g.handle('p1', { t: 'accept', id: 'sabotage' });
  fly(g, p, 'korrun');
  check(!g.mission, 'leaving Dusk Varo mid-sabotage abandons the job');
}

console.log(failures ? `\n${failures} travel check(s) FAILED` : '\nAll travel checks passed');
process.exit(failures ? 1 : 0);
