// Exercises the economy end to end: workers producing, hunters hunting, trader ships,
// player gathering, trading, crafting and upgrades, plus street traffic.
// Run: node tools/economy-test.js
import { Game } from '../shared/sim/game.js';
import { K, TICK_DT } from '../shared/config.js';
import { groundAt } from '../shared/world.js';
import { TOWNS, GOOD_ORDER, buyPrice, packCount } from '../shared/economy.js';
import { levelOf } from '../shared/config.js';

let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };
const saved = {};
function setup(planet) {
  const g = new Game({ send: () => {}, solo: true, planet, saveProfile: (n, d) => { saved[n] = d; }, loadProfile: (n) => saved[n] || null });
  g.addPlayer('p1', { name: 'Trader' });
  const p = g.playerOf('p1');
  const dmg = g.damage.bind(g);
  g.damage = (e, a, s, i) => dmg(e, e.kind === K.PLAYER ? 0 : a, s, i);
  return { g, p };
}
const place = (g, p, x, z) => { p.tpSeq++; p.x = x; p.z = z; p.y = groundAt(g.world, x, z, 60) + 0.02; };
const face = (p, x, z) => { p.yaw = Math.atan2(-(x - p.x), -(z - p.z)); };
const run = (g, s) => { for (let i = 0; i < s / TICK_DT; i++) g.tick(TICK_DT); };
function use(g, p, hold = 0) {
  g.rebuildSpatial();
  const c = g.pickInteract(p);
  g.handle('p1', { t: 'use', id: c && c.id, down: true });
  if (hold) run(g, hold + 0.3);
  g.handle('p1', { t: 'use', down: false });
  return c;
}
const shopNpc = (g, id) => [...g.ents.values()].find((e) => e.kind === K.MERCHANT && e.merchant === id);
function standAt(g, p, npc) { const s = g.world.shops.find((q) => q.id === npc.merchant); place(g, p, s.front.x, s.front.z); face(p, npc.x, npc.z); g.rebuildSpatial(); }

for (const planet of ['duskvaro', 'thessaly', 'korrun']) {
  const { g } = setup(planet);
  const delivered = {};
  const orig = g.econDeliver.bind(g);
  g.econDeliver = (e, give) => { for (const k of Object.keys(give)) delivered[k] = (delivered[k] || 0) + give[k]; orig(e, give); };
  const traffic = [...g.ents.values()].filter((e) => e.kind === K.TRAFFIC);
  const s0 = traffic.map((t) => t.s);
  const critters0 = [...g.ents.values()].filter((e) => e.kind === K.CRITTER).length;
  run(g, 600);
  const T = TOWNS[planet], m = g.market();
  const moved = traffic.filter((t, i) => Math.abs(t.s - s0[i]) > 1 || t.dir < 0).length;
  check(moved === traffic.length, `${planet}: all ${traffic.length} traffic vehicles drive their routes`);
  check(Object.keys(delivered).length >= 2, `${planet}: workers delivered ${JSON.stringify(delivered)}`);
  check(delivered.meat > 0, `${planet}: hunters brought home meat and hides`);
  check(delivered.make > 0, `${planet}: makers worked the benches`);
  const bad = GOOD_ORDER.filter((k) => !(m.stock[k] >= 0 && m.stock[k] < (T.target[k] || 10) * 5));
  check(!bad.length, `${planet}: every stock stays in bounds after 10 minutes${bad.length ? ' — ' + bad.map((k) => `${k}=${m.stock[k].toFixed(0)}`).join(', ') : ''}`);
  check(m.lastShip > 0, `${planet}: trader ships landed and traded (last ${Math.round(g.time - m.lastShip)}s ago)`);
  const critters = [...g.ents.values()].filter((e) => e.kind === K.CRITTER && !e.dead).length;
  check(critters >= Math.min(critters0, g.herds.length * 3), `${planet}: herds survive the hunting (${critters0} -> ${critters})`);
  console.log('   prices', m.planet, GOOD_ORDER.map((k) => `${k} ${buyPrice(m, k)}`).join(' '));
}

// ---------------------------------------------------------------- the crew's side
{
  const { g, p } = setup('duskvaro');
  const W = g.world;
  // gather ore
  const ore = W.nodes.find((n) => n.kind === 'ore');
  place(g, p, ore.x - 1.5, ore.z); face(p, ore.x, ore.z);
  const c = use(g, p, 2.4);
  check((p.pack.ore || 0) === 2, `gather: "${c && c.label}" puts 2 ore in the pack`);
  g.rebuildSpatial();
  const again = g.pickInteract(p);
  check(!again || again.id !== c.id, 'gather: the seam is spent for a while');
  // trade at the exchange
  const ex = shopNpc(g, 'khetExchange');
  standAt(g, p, ex);
  const ic = g.pickInteract(p);
  check(ic && ic.label.includes('Trade goods'), `exchange: broker prompt (${ic && ic.label})`);
  const cr0 = p.credits, st0 = g.market().stock.ore;
  g.handle('p1', { t: 'trade', g: 'ore', n: -2 });
  check(!p.pack.ore && p.credits > cr0 && g.market().stock.ore === st0 + 2, `exchange: sold 2 ore for ${p.credits - cr0}cr`);
  p.credits = 5000;
  g.handle('p1', { t: 'trade', g: 'ore', n: 9 });
  check(p.pack.ore === 9, 'exchange: bought 9 ore');
  g.handle('p1', { t: 'trade', g: 'ice', n: 4 });
  check(p.pack.ice === 4, 'exchange: bought imported coolant ice');
  // craft at the workshop
  const ws = shopNpc(g, 'voskWorks');
  standAt(g, p, ws);
  g.handle('p1', { t: 'craft', r: 'alloy', n: 2 });
  g.handle('p1', { t: 'craft', r: 'cell', n: 1 });
  check(p.pack.alloy === 2 && p.pack.cell === 1 && p.pack.ore === 2, `workshop: made 2 alloy and a power cell (${JSON.stringify(p.pack)})`);
  // upgrade the weapon and check the damage bonus
  g.handle('p1', { t: 'upg', k: 'weapon' });
  check(p.gear.weapon === 1, 'workshop: weapon upgraded to tier 1');
  const guard = [...g.ents.values()].find((e) => e.kind === K.LANCER);
  const hp0 = guard.hp;
  g.damage(guard, 10, p, { kind: 'bolt' });
  check(Math.abs(hp0 - guard.hp - 11.2) < 0.01, `upgrade: tier-1 weapon hits 12% harder (${(hp0 - guard.hp).toFixed(1)})`);
  // armor raises max health
  p.pack.weave = 2; p.pack.alloy = 1;
  g.handle('p1', { t: 'upg', k: 'armor' });
  check(p.gear.armor === 1 && p.maxHp === 115 + 3 * (levelOf(p.xp).lv - 1), `upgrade: armor tier 1 gives ${p.maxHp} max health`);
  // ship berth raises cargo space
  p.pack = {}; p.pack.alloy = 3; p.pack.cell = 2;
  g.handle('p1', { t: 'upg', k: 'ship' });
  check(p.gear.ship === 1 && g.cargoCap(p) === 50, `upgrade: berth tier 1 carries ${g.cargoCap(p)}`);
  // pack capacity is enforced
  standAt(g, p, ex);
  p.pack = { grain: 48 };
  g.handle('p1', { t: 'trade', g: 'grain', n: 10 });
  check(packCount(p.pack) === 50, 'exchange: you cannot buy past your cargo space');
  // hunting by hand
  const critter = [...g.ents.values()].find((e) => e.kind === K.CRITTER && !e.dead);
  p.pack = {};
  g.damage(critter, 999, p, { kind: 'bolt' });
  check(p.pack.meat === 1 && p.pack.hide === 1, 'hunting: a kill gives meat and a hide');
  // salvage from the Concordance
  const officer = g.ents.get(g.officerId);
  g.damage(officer, 999, p, { kind: 'bolt' });
  check(p.pack.scrap === 3, 'salvage: the officer drops 3 salvage');
  // persistence
  const mhp = p.maxHp, xp0 = p.xp;
  g.removePlayer('p1');
  check(saved.Trader && saved.Trader.gear.weapon === 1 && saved.Trader.pack.meat === 1, 'profile: gear and pack are saved');
  g.addPlayer('p1', { name: 'Trader' });
  const p2 = g.playerOf('p1');
  check(p2.gear.armor === 1 && p2.maxHp === mhp && p2.pack.scrap === 3 && p2.xp === xp0, `profile: gear, pack and xp come back on rejoin (${p2.maxHp} hp, ${p2.xp} xp)`);
  // traffic brakes for people
  const car = [...g.ents.values()].find((e) => e.kind === K.TRAFFIC && e.wait <= 0 && e.vk !== 'hauler');
  run(g, 3);
  const fx = -Math.sin(car.yaw), fz = -Math.cos(car.yaw);
  place(g, p2, car.x + fx * 6, car.z + fz * 6);
  g.rebuildSpatial();
  run(g, 2);
  check(car.v < 0.6, `traffic: a ${car.vk} brakes for someone in the road (speed ${car.v.toFixed(2)})`);
  place(g, p2, -160, 40);
  run(g, 4);
  check(car.v > 2, `traffic: and drives on when the road clears (speed ${car.v.toFixed(1)})`);
  // shooting up traffic
  const cr = p2.credits;
  g.damage(car, 999, p2, { kind: 'bolt' });
  check(!g.ents.has(car.id) && p2.credits < cr, 'traffic: destroying a civilian ride costs you');
}

console.log(failures ? `\n${failures} economy check(s) FAILED` : '\nAll economy checks passed');
process.exit(failures ? 1 : 0);
