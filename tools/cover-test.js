// Cover: half damage and wider shots behind something solid, guards that duck and pop up behind
// sandbags, and blasts that flush people out. Run: node tools/cover-test.js
import { Game } from '../shared/sim/game.js';
import { K, TICK_DT, COVER } from '../shared/config.js';
import { groundAt } from '../shared/world.js';
import { inCover, playerCoverState, findCoverSpot } from '../shared/sim/cover.js';
import { explode } from '../shared/sim/combat.js';
import { spawnGuard } from '../shared/sim/ai.js';

let failures = 0;
const check = (c, msg) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${msg}`); if (!c) failures++; };
const run = (g, s, each) => { for (let i = 0; i < s / TICK_DT; i++) { g.tick(TICK_DT); if (each) each(); } };
const place = (g, e, x, z) => { if (e.tpSeq != null) e.tpSeq++; e.x = x; e.z = z; e.y = groundAt(g.world, x, z, 60) + 0.02; e.vx = e.vz = 0; };

function setup() {
  const g = new Game({ send: () => {}, solo: true });
  g.addPlayer('p0', { name: 'T', cls: 'soldier' });
  const p = g.playerOf('p0');
  p.hp = p.maxHp = 1e6; // nothing in these tests should end in a respawn
  // the west-yard sandbag line: 0.9 m thick, 5 m long along z, 1.05 m high
  const bag = g.world.boxes.find((b) => Math.abs(b.maxY - b.minY - 1.05) < 0.01 && Math.abs(b.maxX - b.minX - 0.9) < 0.01 && Math.abs(b.maxZ - b.minZ - 5) < 0.01);
  // only one guard on the field, no cameras, no alarm
  for (const o of [...g.ents.values()]) if (o.kind === K.LANCER || o.kind === K.OFFICER || o.kind === K.CAMERA || o.kind === K.DROID || o.hostile) g.removeEnt(o);
  g.alarm.active = false;
  g.rebuildSpatial();
  return { g, p, bag };
}

{
  const { g, p, bag } = setup();
  check(!!bag, 'the west yard has a waist-high sandbag line');
  const cz = (bag.minZ + bag.maxZ) / 2;
  // a shooter 15 m east of the bags, the player tucked against their west face
  const shooter = { x: bag.maxX + 15, z: cz, y: p.y };
  place(g, p, bag.minX - 0.5, cz); p.crouch = true;
  check(inCover(g, p, shooter), 'crouched behind sandbags: in cover from a shooter on the far side');
  p.crouch = false;
  check(!inCover(g, p, shooter), 'standing behind waist-high sandbags: not in cover');
  p.crouch = true;
  const flank = { x: bag.minX - 0.5, z: cz + 15 };
  check(!inCover(g, p, flank), 'crouched behind sandbags: no cover from a shooter on the flank');
  place(g, p, bag.minX - 4, cz);
  check(!inCover(g, p, shooter), 'four metres back from the bags: out of cover');

  // half damage from a bolt in cover
  place(g, p, bag.minX - 0.5, cz); p.crouch = true;
  const src = { ...shooter, kind: K.LANCER, id: -1, hostile: true };
  let hp = p.hp; g.damage(p, 40, src, { kind: 'bolt' }); const covered = hp - p.hp;
  p.crouch = false;
  hp = p.hp; g.damage(p, 40, src, { kind: 'bolt' }); const open = hp - p.hp;
  check(covered > 0 && Math.abs(covered / open - COVER.damage) < 0.05, `bolts that reach you in cover hit for half (${covered.toFixed(1)} vs ${open.toFixed(1)})`);
}

// guards look for cover, duck and pop up
{
  const { g, p, bag } = setup();
  const cz = (bag.minZ + bag.maxZ) / 2;
  // the player out in the open well east of the bags; the guard just west of them, in the open
  place(g, p, bag.maxX + 14, cz + 1);
  const def = { tasks: [{ x: bag.minX - 6, z: cz + 3, wait: [60, 60] }], name: 'cover-test' };
  const e = spawnGuard(g, def);
  e.hp = e.maxHp = 1e6;
  g.rebuildSpatial();
  const spot = findCoverSpot(g, e, p);
  check(!!spot && spot.x < bag.minX && Math.abs(spot.z - cz) < 3, `guard picks a spot behind the sandbags (${spot && spot.x.toFixed(1)}, ${spot && spot.z.toFixed(1)})`);
  if (spot) g.coverClaims.delete(spot.key);
  e.ai.state = 'combat'; e.ai.alert = 2; e.ai.sus = 1; e.ai.target = p.id; e.ai.lkp = { x: p.x, y: p.y, z: p.z };
  e.ai.combatStart = g.time; e.ai.lastSeen = g.time;
  let ducked = 0, popped = 0, shots = 0, reached = false;
  const sb = g.spawnBolt.bind(g); g.spawnBolt = (o, ...a) => { if (o === e) shots++; return sb(o, ...a); };
  run(g, 12, () => {
    p.x = bag.maxX + 14; p.z = cz + 1; p.vx = p.vz = 0; p.hp = 1e6; // hold the player still
    if (e.ai.cover && Math.hypot(e.x - e.ai.cover.x, e.z - e.ai.cover.z) < 0.6) {
      reached = true;
      if (e.crouch) ducked++; else popped++;
    }
  });
  check(reached, 'guard runs to the sandbags');
  check(ducked > 20 && popped > 20, `guard ducks and pops up behind them (${(ducked * TICK_DT).toFixed(1)} s down, ${(popped * TICK_DT).toFixed(1)} s up)`);
  check(shots > 3, `guard shoots over the cover when up (${shots} bolts)`);
  check(e.crouch ? inCover(g, e, p) : true, 'a ducked guard is in cover from the player');
  // make sure we test him ducked
  run(g, 4, () => { p.x = bag.maxX + 14; p.z = cz + 1; p.hp = 1e6; if (e.crouch && !e._seen) e._seen = inCover(g, e, p); });
  check(!!e._seen, 'while ducked he is covered from the player');

  // grenade lobbed over the bags flushes him out
  const before = { x: e.x, z: e.z };
  explode(g, e.x + 0.6, e.y + 0.3, e.z + 0.4, 4.5, 30, p, 'grenade');
  check(!e.ai.cover && g.time < e.flushedUntil, 'a grenade at his feet knocks him out of cover');
  check(!inCover(g, e, p), 'a flushed guard gets nothing from cover');
  run(g, 1.2, () => { p.x = bag.maxX + 14; p.z = cz + 1; p.hp = 1e6; });
  const moved = Math.hypot(e.x - before.x, e.z - before.z);
  check(moved > 2, `the flushed guard scrambles clear of the blast (${moved.toFixed(1)} m)`);
  run(g, COVER.flush + 3, () => { p.x = bag.maxX + 14; p.z = cz + 1; p.hp = 1e6; });
  check(!!e.ai.cover || e.ai.coverRetry > 0, 'once the smoke clears he goes back to looking for cover');
}

// player: blasts flush you, and reach over low cover
{
  const { g, p, bag } = setup();
  const cz = (bag.minZ + bag.maxZ) / 2;
  place(g, p, bag.minX - 0.5, cz); p.crouch = true;
  const def = { tasks: [{ x: bag.maxX + 15, z: cz, wait: [60, 60] }], name: 'cover-test' };
  const e = spawnGuard(g, def);
  e.ai.state = 'combat'; e.ai.target = p.id; e.ai.alert = 2; g.rebuildSpatial();
  check(playerCoverState(g, p) === 2, 'the HUD shows "In cover" against the guard hunting you');
  // a grenade on the far side of the bags: they soak the blast, but not all of it comes round
  let hp = p.hp;
  explode(g, bag.maxX + 1.2, p.y + 0.3, cz, 4.5, 60, e, 'grenade');
  const hurt = hp - p.hp;
  check(hurt > 0, `a grenade over the sandbags still reaches you (${hurt.toFixed(1)} damage)`);
  check(playerCoverState(g, p) === 3, 'and flushes you: the HUD shows "Flushed!"');
  const src = { x: e.x, z: e.z, y: e.y, kind: K.LANCER, id: e.id, hostile: true };
  hp = p.hp; g.damage(p, 40, src, { kind: 'bolt' });
  check(Math.abs(hp - p.hp - 40) < 0.5 || hp - p.hp > 30, `while flushed, bolts hit full (${(hp - p.hp).toFixed(1)})`);
  run(g, COVER.flush + 0.2);
  check(playerCoverState(g, p) !== 3, 'cover comes back once the flush wears off');
}

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nAll cover tests passed.');
