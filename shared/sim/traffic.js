// Speeder bikes, landspeeders and cargo haulers driven by townsfolk along each town's
// streets and haul roads (W.traffic, laid out in shared/districts.js). They brake for
// anyone in the way and can be shot up, which goes about as well as you'd expect.
import { K, F } from '../config.js';
import { groundAt } from '../world.js';
import { dist2, angleDiff, wrapAngle, clamp, yawTo } from '../math.js';

export const TRAFFIC_KIND = { bike: 1, car: 2, hauler: 3 };
const SPEED = { bike: 15, car: 11.5, hauler: 8 };
const TOWN_SPEED = { bike: 10, car: 8.5, hauler: 7 };
const HOVER = { bike: 0.7, car: 0.75, hauler: 0.85 };
const HP = { bike: 60, car: 120, hauler: 170 };
const RADIUS = { bike: 0.9, car: 1.4, hauler: 1.7 };

function prep(r) {
  const pts = r.loop ? [...r.pts, r.pts[0]] : r.pts;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist2(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
  return { ...r, path: pts, cum, len: cum[cum.length - 1] };
}

// Point and heading at distance s along the route
function at(r, s) {
  if (r.loop) s = ((s % r.len) + r.len) % r.len; else s = clamp(s, 0, r.len);
  let i = 1;
  while (i < r.cum.length - 1 && r.cum[i] < s) i++;
  const a = r.path[i - 1], b = r.path[i];
  const seg = r.cum[i] - r.cum[i - 1] || 1, f = (s - r.cum[i - 1]) / seg;
  return { x: a[0] + (b[0] - a[0]) * f, z: a[1] + (b[1] - a[1]) * f, yaw: yawTo(a[0], a[1], b[0], b[1]) };
}

export function spawnTraffic(game) {
  game.routes = game.world.traffic.map(prep);
  game.routes.forEach((r, ri) => { for (let i = 0; i < r.n; i++) spawnVehicle(game, ri, i); });
}

export function spawnVehicle(game, ri, i, atStart) {
  const r = game.routes[ri];
  if (!r) return null;
  const vk = r.kinds[i % r.kinds.length];
  const s = atStart ? 0 : (r.len * (i + 0.37)) / r.n;
  const p = at(r, s);
  const y = groundAt(game.world, p.x, p.z, 60) + HOVER[vk];
  return game.spawn({
    kind: K.TRAFFIC, vk, a1: TRAFFIC_KIND[vk], a2: Math.floor(game.rng() * 1000), x: p.x, y, z: p.z, yaw: p.yaw,
    route: ri, slot: i, s, dir: 1, v: 0, wait: game.rng() * 3, hp: HP[vk], maxHp: HP[vk], r: RADIUS[vk], h: 1.6,
  });
}

export function updateTraffic(game, e, dt) {
  const r = game.routes[e.route];
  e.flags = 0;
  if (!r) return;
  if (e.wait > 0) { e.wait -= dt; e.v = 0; e.flags |= F.WORK; return; }
  let vt = SPEED[e.vk];
  const town = game.world.regions.town;
  if (town && dist2(e.x, e.z, town.x, town.z) < town.r + 6) vt = TOWN_SPEED[e.vk];
  // slow for corners ahead
  const ahead = at(r, e.s + 12 * e.dir), here = at(r, e.s);
  const turn = Math.abs(angleDiff(here.yaw, ahead.yaw));
  vt *= 1 - Math.min(0.6, turn * 0.55);
  // brake for anything in the lane ahead
  const fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw);
  let blockedBy = null;
  for (const o of game.nearby(e.x, e.z, 13)) {
    if (o === e || o.dead || o.aboard || o.kind === K.CAMERA || o.kind === K.PICKUP || o.kind === K.GRENADE) continue;
    const rx = o.x - e.x, rz = o.z - e.z;
    const along = rx * fx + rz * fz, lat = Math.abs(rx * fz - rz * fx);
    if (along <= 0.5 || along > 12 || lat > (o.kind === K.TRAFFIC ? 2.6 : 2.0) + e.r * 0.5) continue;
    if (o.kind === K.TRAFFIC && Math.abs(angleDiff(o.yaw, e.yaw)) > 2.4 && along > 6) continue; // oncoming on a two-way road
    vt = Math.min(vt, Math.max(0, (along - 4.5) * 1.6));
    if (o.kind === K.PLAYER || o.kind === K.CIVILIAN) blockedBy = o;
  }
  if (vt < e.v) e.flags |= F.AIM; // brake lights
  e.v += clamp(vt - e.v, -14 * dt, 4.5 * dt);
  if (blockedBy && e.v < 0.5) {
    e.honkT = (e.honkT || 0) + dt;
    if (e.honkT > 1.6) { e.honkT = -4; game.event(['honk', e.id]); if (blockedBy.kind === K.PLAYER && game.rng() < 0.5) game.bark(e, ['Move it!', 'Out of the road!', 'Some of us have deliveries!', 'Get off the street, offworlder!'][Math.floor(game.rng() * 4)]); }
  } else e.honkT = 0;
  e.s += e.v * dt * e.dir;
  if (!r.loop) {
    if (e.s >= r.len) { e.s = r.len; e.dir = -1; e.wait = r.pause; }
    else if (e.s <= 0) { e.s = 0; e.dir = 1; e.wait = r.pause; }
  }
  const p = at(r, e.s);
  const px = e.x, pz = e.z;
  e.x = p.x; e.z = p.z;
  const gy = groundAt(game.world, e.x, e.z, e.y + 3) + HOVER[e.vk];
  e.y += (gy - e.y) * Math.min(1, dt * 8);
  const heading = e.dir > 0 ? p.yaw : wrapAngle(p.yaw + Math.PI);
  e.yaw = wrapAngle(e.yaw + clamp(angleDiff(e.yaw, heading), -2.6 * dt, 2.6 * dt));
  e.vx = (e.x - px) / dt; e.vz = (e.z - pz) / dt;
}
