// The Wayfarer's ramp menu, the crew's own speeders, and speeder theft with town heat.
// Run: node tools/theft-test.js
import { Game } from '../shared/sim/game.js';
import { K, F, TICK_DT, MISSIONS } from '../shared/config.js';
import { groundAt } from '../shared/world.js';
import { HEAT, heatOf, REFILL_FEE } from '../shared/sim/theft.js';

let failures = 0;
const check = (c, msg) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${msg}`); if (!c) failures++; };
const run = (g, s) => { for (let i = 0; i < s / TICK_DT; i++) g.tick(TICK_DT); };
const place = (g, p, x, z) => { p.tpSeq++; p.x = x; p.z = z; p.y = groundAt(g.world, x, z, 60) + 0.02; g.rebuildSpatial(); };
const face = (p, x, z) => { p.yaw = Math.atan2(-(x - p.x), -(z - p.z)); };
function setup(prof) {
  const sent = [];
  const store = {};
  if (prof) store.T = prof;
  const g = new Game({ send: (c, m) => sent.push(JSON.parse(m)), solo: true, saveProfile: (n, d) => { store[n] = d; }, loadProfile: (n) => store[n] || null });
  g.addPlayer('p', { name: 'T', cls: 'soldier' });
  g.rebuildSpatial();
  return { g, p: g.playerOf('p'), sent, store };
}
function use(g, p, hold = 0) {
  g.rebuildSpatial();
  const c = g.pickInteract(p);
  g.handle('p', { t: 'use', id: c && c.id, down: true });
  if (hold) run(g, hold + 0.3);
  g.handle('p', { t: 'use', down: false });
  return c;
}
const atRamp = (g, p) => { const r = g.world.pois.ship; place(g, p, r.x, r.z + 0.6); face(p, r.x, r.z - 3); };
const mine = (g, p) => [...g.ents.values()].find((e) => e.kind === K.SPEEDER && e.personal === p.id);
// keep everyone in town calm and out of the way unless a test wants witnesses
const hush = (g) => { for (const e of g.ents.values()) if ([K.CIVILIAN, K.MERCHANT, K.BARTENDER, K.INFORMANT].includes(e.kind) && e.merchant !== 'khetExchange') { e.x += 400; e.z += 400; } g.rebuildSpatial(); };

// ---------------------------------------------------------------- the ramp menu
{
  const { g, p, sent } = setup();
  check(![...g.ents.values()].some((e) => e.kind === K.SPEEDER && !e.owned && !e.personal), 'town: no free speeders left in town');
  check([...g.ents.values()].some((e) => e.kind === K.SPEEDER && e.owned), 'town: parked speeders belong to townsfolk');
  check(/call your speeder/.test(MISSIONS.rescue.brief), 'hint: the first job says to call a speeder at the ship');
  atRamp(g, p);
  const c = use(g, p);
  check(c && c.id === 'ship' && sent.some((m) => m.t === 'ui' && m.ui === 'ship'), `ship: E at the ramp opens the ship menu ("${c && c.label}")`);
  run(g, 0.1);
  const pv = sent.filter((m) => m.t === 's').pop().pv;
  check(pv.fs === 1 && pv.sp === 0 && Array.isArray(pv.rq), 'ship: the menu highlights the speeder until it has been used');
  g.handle('p', { t: 'callspeeder' });
  const v = mine(g, p);
  check(!!v && Math.hypot(v.x - p.x, v.z - p.z) < 12, 'ship: calling a speeder rolls your own bike down the ramp');
  check(((v.a2 >> 7) >> 2) === 8 + p.color, 'ship: it is painted in your colour');
  run(g, 0.1);
  check(sent.filter((m) => m.t === 's').pop().pv.fs === 0, "ship: the highlight goes once you've used it");
  g.handle('p', { t: 'callspeeder' });
  check([...g.ents.values()].filter((e) => e.kind === K.SPEEDER && e.personal === p.id).length === 1, 'ship: calling again brings back the same one, never two');
  // ride it, then wreck it
  place(g, p, v.x + 1.5, v.z); face(p, v.x, v.z);
  const r = use(g, p);
  check(p.vehicle === v.id && /your speeder/i.test(r.label), `ship: ride your own speeder ("${r.label}")`);
  g.damage(v, 9999, null, { kind: 'bolt' });
  run(g, 0.2);
  check(!mine(g, p) && p.speederCdUntil > g.time, 'ship: a wrecked speeder means a wait before calling another');
  atRamp(g, p);
  g.handle('p', { t: 'callspeeder' });
  check(!mine(g, p), 'ship: no new speeder during the wait');
  run(g, 31);
  atRamp(g, p);
  g.handle('p', { t: 'callspeeder' });
  check(!!mine(g, p), 'ship: and another after it');
  // restock
  p.grenades = 1; p.medpacks = 0; p.credits = 1000;
  g.handle('p', { t: 'refill' });
  check(p.grenades === 8 && p.medpacks === 4 && p.credits === 1000 - 11 * REFILL_FEE, `ship: restocking tops up charges and medpacks for ${11 * REFILL_FEE}cr (${1000 - p.credits}cr)`);
  place(g, p, p.x + 40, p.z);
  p.grenades = 0;
  g.handle('p', { t: 'refill' });
  check(p.grenades === 0, 'ship: only at the ramp');
  atRamp(g, p);
  g.handle('p', { t: 'boardship' });
  check(p.aboard, 'ship: the menu boards the ship');
}

// ---------------------------------------------------------------- stealing a parked speeder, unseen
{
  const { g, p } = setup();
  hush(g);
  const v = [...g.ents.values()].find((e) => e.kind === K.SPEEDER && e.owned);
  place(g, p, v.x + 1.5, v.z); face(p, v.x, v.z);
  const c = g.pickInteract(p);
  check(c && c.id.startsWith('steal:') && c.hold >= 3, `theft: a town speeder has to be hotwired ("${c && c.label}", ${c && c.hold}s)`);
  use(g, p, c.hold);
  check(p.vehicle === v.id && v.stolenBy === p.id, 'theft: hotwiring takes the speeder');
  run(g, 6);
  check(heatOf(g) === 0, 'theft: with no witnesses, nobody reports it yet');
  run(g, 90);
  check(heatOf(g) >= HEAT.discovered - 5, `theft: the owner notices eventually (heat ${heatOf(g).toFixed(0)})`);
  // ride it back home and give it back
  place(g, p, v.home.x + 2, v.home.z); v.x = v.home.x + 1; v.z = v.home.z; g.rebuildSpatial();
  const back = g.pickInteract(p);
  check(back && back.id.startsWith('return:'), `theft: back where you took it, you can give it back ("${back && back.label}")`);
  const h = heatOf(g), cr = p.credits;
  use(g, p);
  check(!v.stolenBy && !p.vehicle && heatOf(g) < h && p.credits > cr, 'theft: giving it back cools the town and earns a thank-you');
}

// ---------------------------------------------------------------- witnessed theft, heat, militia, fine
{
  const { g, p } = setup();
  p.invulnUntil = 1e9; // the militia are allowed to shoot; the test needs you standing
  const v = [...g.ents.values()].find((e) => e.kind === K.SPEEDER && e.owned);
  hush(g);
  const civ = [...g.ents.values()].find((e) => e.kind === K.CIVILIAN);
  civ.x = v.x + 6; civ.z = v.z + 1; civ.y = groundAt(g.world, civ.x, civ.z, 60); civ.ai.fleeUntil = 0;
  place(g, p, v.x + 1.5, v.z); face(p, v.x, v.z);
  use(g, p, 3);
  check(v.stolenBy === p.id, 'heat: stole a speeder in front of a witness');
  run(g, 6);
  check(heatOf(g) >= HEAT.witnessed - 1, `heat: the witness reports it (heat ${heatOf(g).toFixed(0)})`);
  run(g, 5);
  const mil = [...g.ents.values()].filter((e) => e.militia && !e.dead);
  check(mil.length >= 1 && mil.every((e) => g.encodeEnt(e)[6] & F.MILITIA), `heat: the owner's friends come after you (${mil.length})`);
  check(!g.alarm.active, "heat: the militia don't set off the garrison alarm");
  // prices
  const ex = [...g.ents.values()].find((e) => e.kind === K.MERCHANT && e.merchant === 'khetExchange');
  g.handle('p', { t: 'use', down: false });
  if (p.vehicle) g.exitVehicle(p, false);
  place(g, p, ex.x, ex.z + 2);
  p.credits = 100000;
  const m = g.market(); const s0 = m.stock.grain;
  const c0 = p.credits; g.handle('p', { t: 'trade', g: 'grain', n: 1 });
  const paid = c0 - p.credits;
  m.stock.grain = s0; p.pack = {};
  const base = (() => { const h = g.heat.duskvaro; g.heat.duskvaro = 0; const c1 = p.credits; g.handle('p', { t: 'trade', g: 'grain', n: 1 }); g.heat.duskvaro = h; return c1 - p.credits; })();
  check(paid > base, `heat: the exchange charges you more (${paid}cr vs ${base}cr)`);
  // high heat brings the militia out in force
  g.heat.duskvaro = 70;
  run(g, 30);
  const mil2 = [...g.ents.values()].filter((e) => e.militia && !e.dead).length;
  check(mil2 >= 3, `heat: at high heat the town militia turns out (${mil2})`);
  // killing militia makes it worse
  const one = [...g.ents.values()].find((e) => e.militia && !e.dead);
  const hBefore = heatOf(g);
  g.damage(one, 999, p, { kind: 'bolt' });
  check(heatOf(g) > hBefore, 'heat: killing the militia makes the town angrier');
  check(!g.corpses.includes(one), "heat: militia bodies don't trip the garrison");
  // pay the fine
  place(g, p, ex.x, ex.z + 2);
  const fine = Math.ceil(heatOf(g)) * HEAT.fine;
  const c2 = p.credits;
  g.handle('p', { t: 'fine' });
  check(heatOf(g) === 0 && c2 - p.credits === fine, `heat: paying the ${fine}cr fine clears the heat`);
  run(g, 8);
  check([...g.ents.values()].filter((e) => e.militia && !e.dead).length === 0, 'heat: and the militia go home');
}

// ---------------------------------------------------------------- heat fades away from town
{
  const { g, p } = setup();
  g.heat = { duskvaro: 30 };
  const T = g.world.regions.town;
  place(g, p, T.x + T.r + 150, T.z);
  for (const e of [...g.ents.values()]) if (e.militia) g.removeEnt(e);
  run(g, 10);
  check(heatOf(g) < 30 - 5, `fade: heat drops while the crew stays out of town (${heatOf(g).toFixed(1)})`);
}

// ---------------------------------------------------------------- fence, hijack, hauler cargo
{
  const { g, p } = setup();
  hush(g);
  const v = [...g.ents.values()].find((e) => e.kind === K.SPEEDER && e.owned);
  place(g, p, v.x + 1.5, v.z); face(p, v.x, v.z);
  use(g, p, 3);
  const ex = [...g.ents.values()].find((e) => e.kind === K.MERCHANT && e.merchant === 'khetExchange');
  g.exitVehicle(p, false);
  v.x = ex.x + 6; v.z = ex.z; place(g, p, ex.x, ex.z + 2);
  run(g, 0.1);
  const cr = p.credits;
  g.handle('p', { t: 'fence' });
  check(!g.ents.has(v.id) && p.credits > cr && (p.pack.scrap || 0) >= 2, `fence: the exchange's back room buys the stolen speeder (+${p.credits - cr}cr)`);
  // hijack a hauler
  const tr = [...g.ents.values()].find((e) => e.kind === K.TRAFFIC && e.vk === 'hauler');
  if (tr) {
    tr.v = 0; place(g, p, tr.x + 2, tr.z); face(p, tr.x, tr.z);
    const m = g.market();
    const before = { ...m.stock };
    const c = g.pickInteract(p);
    check(c && c.id.startsWith('jack:'), `hijack: a stopped hauler can be taken ("${c && c.label}")`);
    use(g, p, 0.8);
    const sv = p.vehicle && g.ents.get(p.vehicle);
    check(sv && sv.vk === 'hauler' && sv.stolenBy === p.id, 'hijack: you drive off in the hauler');
    const lost = Object.keys(before).some((k) => m.stock[k] < before[k] - 1);
    check(sv && sv.cargo && lost, `hijack: its cargo never reaches the town (${JSON.stringify(sv && sv.cargo)})`);
    run(g, 6);
    check(heatOf(g) >= HEAT.hijack - 1, `hijack: the driver reports it (heat ${heatOf(g).toFixed(0)})`);
  } else check(false, 'hijack: found a hauler on the road');
}

// ---------------------------------------------------------------- abandon
{
  const { g, p } = setup();
  hush(g);
  const v = [...g.ents.values()].find((e) => e.kind === K.SPEEDER && e.owned);
  place(g, p, v.x + 1.5, v.z); face(p, v.x, v.z);
  use(g, p, 3);
  g.exitVehicle(p, false);
  place(g, p, v.x + 200, v.z);
  run(g, 62);
  check(!g.ents.has(v.id), 'abandon: a stolen speeder left alone finds its way home');
  run(g, 60);
  check([...g.ents.values()].some((e) => e.kind === K.SPEEDER && e.slot === v.slot && !e.stolenBy), 'abandon: and the owner has it back');
}

console.log(failures ? `\n${failures} theft check(s) FAILED` : '\nAll theft checks passed');
process.exit(failures ? 1 : 0);
