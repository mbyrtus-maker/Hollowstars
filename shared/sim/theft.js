// Speeders that belong to someone. The crew calls its own from the Wayfarer; every speeder in
// town belongs to a townsperson, and taking one is theft. Witnesses report it, the town's heat
// goes up, prices rise, and the owner's friends (then the town militia) come after the thief.
import { K, F, WEAPONS } from '../config.js';
import { dist2, clamp } from '../math.js';
import { groundAt, lineOfSight, navWalkable } from '../world.js';
import { SPEEDER } from '../vehicles.js';
import { spawnGuard, civilianScare } from './ai.js';
import { classOf } from './classes.js';
import { GOODS, RAW, TOWNS } from '../economy.js';
import { PLANETS, SHIP } from '../planets.js';

const r2 = (v) => Math.round(v * 100) / 100;
const MODEL = { bike: 0, car: 1, hauler: 2 };
const VALUE = { bike: 180, car: 340, hauler: 420 };
const OWNERS = ['Teo Barrask', 'Ada Venn', 'Moll Okkar', 'Rusk Tal', 'Iri Danz', 'Pem Holloway', 'Jask Merrow', 'Una Pell', 'Corvin Ash', 'Lida Shree'];
export const HEAT = { witnessed: 35, hijack: 45, discovered: 15, militiaKill: 20, fenceCaught: 20, returned: 25, lowAt: 20, highAt: 60, fine: 15 };
export const TOWN_REWARD_RETURN = 40;
const REPORT_DELAY = 5;
const DISCOVER_DELAY = 90;
const ABANDON_AFTER = 60;
const SPEEDER_COOLDOWN = 30;

// a2 for speeders: health in the low 7 bits, then the model and paint for the client
export function speederLook(v) { return (MODEL[v.vk || 'bike'] | 0) | ((v.paint | 0) << 2); }

export const town = (g) => g.world.regions.town || { x: g.world.pois.spawn.x, z: g.world.pois.spawn.z, r: 60 };
export const townName = (g) => (TOWNS[g.planet] || {}).name || PLANETS[g.planet].settlement;
export const heatOf = (g) => (g.heat && g.heat[g.planet]) || 0;
// buying costs more and selling pays less while the town is angry with you
export const buyMult = (g) => 1 + heatOf(g) / 200;
export const sellMult = (g) => 1 - heatOf(g) / 300;

export function addHeat(g, n, why) {
  g.heat ||= {};
  const before = heatOf(g);
  const now = clamp(before + n, 0, 100);
  g.heat[g.planet] = now;
  g.globalDirty = true;
  if (n > 0 && why) {
    const what = now >= HEAT.highAt ? 'The town militia is out looking for you.' : now >= HEAT.lowAt ? "The owner's friends are coming for you, and prices are up." : 'Prices are up.';
    g.note(`${why} Heat in ${townName(g)}: ${Math.round(now)}. ${what}`, 'warn');
  }
  if (before >= HEAT.lowAt && now < HEAT.lowAt / 2) standDown(g);
}

// ---------------------------------------------------------------- parked town speeders

export function spawnOwnedSpeeder(g, i) {
  const s = g.speederSpawns[i];
  if (!s) return null;
  const y = groundAt(g.world, s.x, s.z, 50) + SPEEDER.hover;
  const vk = s.vk || (i % 3 === 2 ? 'car' : 'bike');
  const v = g.spawn({
    kind: K.SPEEDER, x: s.x, y, z: s.z, yaw: s.yaw, hp: SPEEDER.hp, maxHp: SPEEDER.hp, r: SPEEDER.r, h: SPEEDER.h, driver: null, slot: i, onGround: false,
    vk, paint: (i * 3 + 1) % 8, owned: true, ownerName: OWNERS[(i * 7 + g.planet.length) % OWNERS.length], home: { x: s.x, z: s.z, yaw: s.yaw },
  });
  v.a2 = 100 | (speederLook(v) << 7);
  return v;
}

// ---------------------------------------------------------------- the crew's own speeders

// a clear, flat spot beside the Wayfarer's ramp
function rampSpot(g, p) {
  const r = g.world.pois.ship, i = Math.max(0, g.players().indexOf(p));
  for (const [dx, dz] of [[4.5, 1.5], [-4.5, 1.5], [4.5, 5], [-4.5, 5], [0, 7], [7, 3], [-7, 3], [0, 10]]) {
    const x = r.x + dx + (dx ? 0 : (i - 1.5) * 2), z = r.z + dz;
    if (!navWalkable(g.world, x, z)) continue;
    if ([...g.ents.values()].some((e) => e.kind === K.SPEEDER && dist2(e.x, e.z, x, z) < 2.5)) continue;
    return { x, z };
  }
  return { x: r.x + 4, z: r.z + 2 };
}

export function callSpeeder(g, p) {
  if (!nearShip(g, p)) return;
  if (g.time < (p.speederCdUntil || 0)) { g.pnote(p, `Your speeder is being patched up. Ready in ${Math.ceil(p.speederCdUntil - g.time)}s.`, 'warn'); return; }
  const old = [...g.ents.values()].find((e) => e.kind === K.SPEEDER && e.personal === p.id);
  const s = rampSpot(g, p);
  const yaw = g.world.pois.shipBody.yaw || 0;
  if (old) {
    // the same bike comes back to the ramp
    if (old.driver) { const d = g.ents.get(old.driver); if (d) g.exitVehicle(d, true); }
    old.x = s.x; old.z = s.z; old.y = groundAt(g.world, s.x, s.z, g.world.pois.ship.y + 4) + SPEEDER.hover; old.vx = old.vz = old.vy = 0; old.yaw = yaw + Math.PI;
    g.event(['abfx', p.id, 'speeder', r2(s.x), r2(old.y), r2(s.z)]);
    g.pnote(p, 'Your speeder is back at the ramp.', 'info');
    g.rebuildSpatial();
    return old;
  }
  const v = g.spawn({
    kind: K.SPEEDER, x: s.x, y: groundAt(g.world, s.x, s.z, g.world.pois.ship.y + 4) + SPEEDER.hover, z: s.z, yaw: yaw + Math.PI,
    hp: SPEEDER.hp, maxHp: SPEEDER.hp, r: SPEEDER.r, h: SPEEDER.h, driver: null, onGround: false,
    vk: 'bike', paint: 8 + (p.color | 0), personal: p.id, ownerName: p.name,
  });
  v.a2 = 100 | (speederLook(v) << 7);
  if (!p.usedSpeeder) { p.usedSpeeder = true; g.persist(p); }
  g.event(['abfx', p.id, 'speeder', r2(s.x), r2(v.y), r2(s.z)]);
  g.pnote(p, `Your speeder rolls down the ${SHIP.name}'s ramp.`, 'info');
  g.rebuildSpatial();
  return v;
}

export const nearShip = (g, p) => g.world.pois.ship && !g.travel && !g.landing && dist2(p.x, p.z, g.world.pois.ship.x, g.world.pois.ship.z) < 9;

// Free top-ups of the class kit; charges and medpacks cost a little
export const REFILL_FEE = 20;
export function refillQuote(p) {
  const C = classOf(p);
  const gr = Math.max(0, C.maxGrenades - p.grenades), md = Math.max(0, C.maxMedpacks - p.medpacks);
  return { gr, md, mines: 2 - p.mines, knives: 3 - p.knives, cost: (gr + md) * REFILL_FEE };
}
export function refill(g, p) {
  if (!nearShip(g, p)) return;
  const q = refillQuote(p);
  if (!q.gr && !q.md && q.mines <= 0 && q.knives <= 0) { g.pnote(p, 'You are already fully stocked.', 'info'); return; }
  if (p.credits < q.cost) { g.pnote(p, `Restocking costs ${q.cost}cr.`, 'warn'); return; }
  g.addCredits(p, -q.cost);
  const C = classOf(p);
  p.grenades = C.maxGrenades; p.medpacks = C.maxMedpacks; p.mines = 2; p.knives = 3;
  g.persist(p);
  g.pnote(p, `Restocked from the ${SHIP.name}'s lockers${q.cost ? ` (${q.cost}cr)` : ''}.`, 'credits');
}

// ---------------------------------------------------------------- what you can do with a speeder

export function speederOptions(g, p, e, add) {
  if (e.kind === K.TRAFFIC && !e.dead && (e.v || 0) < 2.5) {
    add('jack:' + e.id, e.x, e.z, `Pull the ${e.vk === 'bike' ? 'rider' : 'driver'} off (steal it)`, 0.8, 3.6);
    return;
  }
  if (e.kind !== K.SPEEDER || e.driver || e.dead) return;
  if (e.personal) {
    const own = e.personal === p.id;
    add('veh:' + e.id, e.x, e.z, own ? 'Ride your speeder' : `Ride ${e.ownerName}'s speeder`, 0, 3.8);
  } else if (e.stolenBy) add('veh:' + e.id, e.x, e.z, 'Ride the stolen speeder', 0, 3.8);
  else if (e.owned) add('steal:' + e.id, e.x, e.z, `Hotwire ${e.ownerName}'s ${e.vk === 'bike' ? 'speeder bike' : e.vk === 'car' ? 'landspeeder' : 'hauler'} (steal it)`, 3 / (classOf(p).sliceSpeed || 1), 3.8);
  else add('veh:' + e.id, e.x, e.z, 'Ride speeder', 0, 3.8);
}

// Riding a stolen speeder back to where it was taken from lets you give it back
export function returnOption(g, p, v) {
  if (!v || !v.stolenBy || !v.home) return null;
  if (dist2(v.x, v.z, v.home.x, v.home.z) > 12) return null;
  return { id: 'return:' + v.id, x: p.x, z: p.z, label: `Give the speeder back to ${v.ownerName}`, hold: 0, range: 99, force: true };
}

// Who saw it: townsfolk and guards with a clear line to the thief
function witnesses(g, p) {
  const out = [];
  for (const e of g.nearby(p.x, p.z, 30)) {
    if (e.dead || e === p) continue;
    const folk = e.kind === K.CIVILIAN || e.kind === K.MERCHANT || e.kind === K.BARTENDER || e.kind === K.INFORMANT || ((e.kind === K.LANCER || e.kind === K.OFFICER) && !e.militia);
    if (!folk) continue;
    if (!lineOfSight(g.world, e.x, e.y + 1.6, e.z, p.x, p.y + 1.2, p.z)) continue;
    out.push(e);
  }
  return out;
}

export function steal(g, p, v, how = 'hotwire') {
  v.stolenBy = p.id;
  v.stolenAt = g.time;
  v.flags |= F.STOLEN;
  const seen = witnesses(g, p);
  const t = { id: v.id, by: p.id, at: g.time, ws: seen.map((e) => e.id), heat: how === 'hijack' ? HEAT.hijack : HEAT.witnessed, owner: v.ownerName, done: false };
  if (how === 'hijack') t.ws.push(-1); // the rider you threw off saw it all
  (g.thefts ||= []).push(t);
  for (const e of seen) {
    if (e.kind === K.CIVILIAN) civilianScare(g, e, p.x, p.z);
    g.bark(e, ['Hey! That\'s not yours!', 'Thief! Somebody stop them!', 'I saw that!', 'That\'s ' + v.ownerName + '\'s ride!'][Math.floor(g.rng() * 4)]);
  }
  g.noise(p.x, p.y, p.z, 12, p, false);
  if (t.ws.length) g.pnote(p, `${t.ws.length === 1 ? 'Someone' : `${t.ws.length} people`} saw you take it. Deal with ${t.ws.length === 1 ? 'them' : 'them'} or they'll report it.`, 'warn');
  else g.pnote(p, `Nobody saw. ${v.ownerName} will notice it's gone eventually.`, 'stealth');
  g.globalDirty = true;
}

// Throw a townsperson off their ride and take it
export function hijack(g, p, tr) {
  if (!tr || tr.dead || tr.kind !== K.TRAFFIC) return null;
  const vk = tr.vk;
  g.removeEnt(tr);
  g.respawnQueue.push({ at: g.time + 60, kind: K.TRAFFIC, route: tr.route, slot: tr.slot });
  const y = groundAt(g.world, tr.x, tr.z, tr.y + 3) + SPEEDER.hover;
  const v = g.spawn({
    kind: K.SPEEDER, x: tr.x, y, z: tr.z, yaw: tr.yaw, hp: SPEEDER.hp * (vk === 'hauler' ? 1.6 : 1), maxHp: SPEEDER.hp * (vk === 'hauler' ? 1.6 : 1), r: SPEEDER.r, h: SPEEDER.h, driver: null, onGround: false,
    vk, paint: (tr.a2 | 0) % 8, owned: true, ownerName: OWNERS[(tr.a2 | 0) % OWNERS.length], home: { x: tr.x, z: tr.z, yaw: tr.yaw }, hijacked: true,
  });
  v.a2 = 100 | (speederLook(v) << 7);
  // a hauler carries a load the town was counting on
  if (vk === 'hauler') {
    const m = g.market();
    const good = RAW.slice().sort((a, b) => (m.stock[b] || 0) - (m.stock[a] || 0))[0];
    const n = Math.min(12, Math.floor((m.stock[good] || 0) * 0.4));
    if (n > 0) { m.stock[good] -= n; v.cargo = { [good]: n }; g.note(`A hauler full of ${GOODS[good].name.toLowerCase()} never made it to ${townName(g)}. Prices will climb.`, 'info'); }
  }
  for (const o of g.nearby(v.x, v.z, 25)) if (o.kind === K.CIVILIAN) civilianScare(g, o, v.x, v.z);
  g.event(['say', p.id, '']);
  steal(g, p, v, 'hijack');
  g.rebuildSpatial();
  return v;
}

export function giveBack(g, p, v) {
  if (!v || !v.stolenBy) return;
  if (p.vehicle === v.id) g.exitVehicle(p, false);
  const t = (g.thefts || []).find((q) => q.id === v.id && !q.done);
  if (t) t.done = true;
  v.stolenBy = null; v.flags &= ~F.STOLEN;
  if (v.cargo) { const m = g.market(); for (const [good, n] of Object.entries(v.cargo)) m.stock[good] += n; v.cargo = null; }
  addHeat(g, -HEAT.returned);
  g.addCredits(p, TOWN_REWARD_RETURN);
  g.note(`${p.name} gave ${v.ownerName}'s speeder back. ${townName(g)} cools off a little.`, 'credits');
  // a hijacked ride drives off again
  if (v.hijacked) g.later(4, () => { if (g.ents.has(v.id) && !v.driver) g.removeEnt(v); });
}

// The exchange's back room takes stolen speeders for parts, no questions asked
export function fenceQuote(g, p) {
  const ex = g.nearShop(p, 'exchange');
  if (!ex) return null;
  const v = [...g.ents.values()].find((e) => e.kind === K.SPEEDER && e.stolenBy && !e.driver && dist2(e.x, e.z, ex.x, ex.z) < 22);
  if (!v) return null;
  let cr = VALUE[v.vk] || 180;
  if (v.cargo) for (const [good, n] of Object.entries(v.cargo)) cr += Math.round(GOODS[good].base * n * 0.6);
  return { v, cr: Math.round(cr * (v.hp / v.maxHp * 0.5 + 0.5)) };
}
export function fence(g, p) {
  const q = fenceQuote(g, p);
  if (!q) { g.pnote(p, 'Park the stolen speeder by the exchange first.', 'warn'); return; }
  const v = q.v;
  const t = (g.thefts || []).find((x) => x.id === v.id && !x.done);
  if (t) t.done = !t.reported ? true : t.done;
  g.removeEnt(v);
  if (v.slot != null && !v.hijacked) g.respawnQueue.push({ at: g.time + 120, kind: K.SPEEDER, slot: v.slot });
  g.addCredits(p, q.cr);
  g.give(p, 'scrap', 2, true);
  g.pnote(p, `The fence strips it in minutes. +${q.cr}cr, +2 Salvage`, 'credits');
  if (g.rng() < 0.25) addHeat(g, HEAT.fenceCaught, "The Exchange's fence got caught with the parts and gave your name.");
}

export function payFine(g, p) {
  const h = Math.ceil(heatOf(g));
  if (!h) return;
  if (!g.nearShop(p, 'exchange')) { g.pnote(p, 'Fines are paid at the exchange.', 'warn'); return; }
  const cost = h * HEAT.fine;
  if (p.credits < cost) { g.pnote(p, `The fine is ${cost}cr.`, 'warn'); return; }
  g.addCredits(p, -cost);
  for (const t of g.thefts || []) t.done = true;
  g.heat[g.planet] = 0;
  standDown(g);
  g.note(`${p.name} paid ${townName(g)}'s fine (${cost}cr). The town lets it go.`, 'credits');
  g.globalDirty = true;
}

// ---------------------------------------------------------------- militia

const militia = (g) => [...g.ents.values()].filter((e) => e.militia && !e.dead);
function standDown(g) {
  for (const e of militia(g)) { e.ai.state = 'routine'; e.ai.target = null; g.bark(e, 'Fine. Stay out of trouble.'); g.later(6, () => { if (g.ents.has(e.id) && !e.dead) g.removeEnt(e); }); e.standingDown = true; }
}
function thiefOf(g) {
  // whoever is in town answers for the crew
  const list = g.players().filter((p) => !p.downed && !p.aboard);
  const T = town(g);
  let best = null, bd = T.r + 120;
  for (const p of list) { const d = dist2(p.x, p.z, T.x, T.z); if (d < bd) { bd = d; best = p; } }
  return best;
}
function spawnMilitia(g, target) {
  const W = g.world;
  const spots = W.civSpots.filter((s) => { const d = dist2(s.x, s.z, target.x, target.z); return d > 22 && d < 70; });
  const s = spots.length ? spots[Math.floor(g.rng() * spots.length)] : { x: town(g).x, z: town(g).z };
  const e = spawnGuard(g, { tasks: [{ x: s.x, z: s.z }], road: true, name: 'militia' }, { x: s.x, z: s.z, alerted: true, lkp: { x: target.x, y: target.y, z: target.z } });
  e.militia = true;
  e.ai.noAlarm = true;
  e.ai.target = target.id;
  e.ai.lastSeen = g.time - 1;
  e.hp = e.maxHp = 50;
  g.bark(e, ['There! The speeder thief!', 'You picked the wrong town to steal from.', 'Militia! Hold it right there!'][Math.floor(g.rng() * 3)]);
  return e;
}

// ---------------------------------------------------------------- per tick

export function updateTheft(g, dt) {
  g.heat ||= {};
  // witnesses report what they saw; unwitnessed thefts come out later
  for (const t of g.thefts || []) {
    if (t.done) continue;
    if (!t.reported && t.ws.length && g.time - t.at > REPORT_DELAY) {
      const alive = t.ws.filter((id) => id === -1 || (g.ents.has(id) && !g.ents.get(id).dead));
      t.ws = [];
      if (alive.length) { t.reported = true; addHeat(g, t.heat, `A witness reported the theft of ${t.owner}'s speeder.`); }
      else { t.at = g.time; t.quiet = true; }
    } else if (!t.reported && !t.ws.length && g.time - t.at > DISCOVER_DELAY) {
      t.reported = true;
      const v = g.ents.get(t.id);
      if (v && v.stolenBy) addHeat(g, HEAT.discovered, `${t.owner} found their speeder gone.`);
      else t.done = true;
    }
  }
  if (g.thefts && g.thefts.length > 30) g.thefts = g.thefts.filter((t) => !t.done);
  // abandoned stolen speeders find their way home
  for (const v of [...g.ents.values()]) {
    if (v.kind !== K.SPEEDER || !v.stolenBy || v.driver) { if (v.kind === K.SPEEDER) v.leftAt = null; continue; }
    const crewNear = g.players().some((p) => dist2(p.x, p.z, v.x, v.z) < 50);
    if (crewNear) { v.leftAt = null; continue; }
    v.leftAt ??= g.time;
    if (g.time - v.leftAt > ABANDON_AFTER) {
      const t = (g.thefts || []).find((q) => q.id === v.id);
      if (t && !t.reported) t.done = true; // nobody can pin it on you now
      g.removeEnt(v);
      if (v.slot != null && !v.hijacked) g.respawnQueue.push({ at: g.time + 60, kind: K.SPEEDER, slot: v.slot });
    }
  }
  // heat fades, faster when the crew stays out of town
  const h = heatOf(g);
  if (h > 0) {
    const T = town(g);
    const hunting = militia(g).some((e) => e.ai.state === 'combat' && !e.standingDown);
    const away = g.players().every((p) => p.aboard || dist2(p.x, p.z, T.x, T.z) > T.r + 60);
    const rate = hunting ? 0 : away ? 1 : 0.2;
    if (rate) { g.heat[g.planet] = Math.max(0, h - rate * dt); if (Math.floor(h) !== Math.floor(g.heat[g.planet])) g.globalDirty = true; }
    if (h >= HEAT.lowAt && g.heat[g.planet] < HEAT.lowAt / 2) standDown(g);
  }
  // the owner's friends, then the militia, go after the crew
  g.militiaT = (g.militiaT || 0) - dt;
  if (g.militiaT <= 0) {
    g.militiaT = 4;
    const want = h >= HEAT.highAt ? 5 : h >= HEAT.lowAt ? 2 : 0;
    const have = militia(g).filter((e) => !e.standingDown).length;
    if (have < want && !g.alarm.active) {
      const target = thiefOf(g);
      if (target) { for (let i = 0; i < Math.min(2, want - have); i++) spawnMilitia(g, target); g.militiaT = 10; }
    }
  }
}

// A militia member killed is the town's own
export function militiaKilled(g, e, killer) {
  if (killer) { g.addCredits(killer, -100); addHeat(g, HEAT.militiaKill, `${killer.name} killed one of ${townName(g)}'s militia.`); }
}
