// Cover. Anyone tucked against something solid that sits between them and a shooter is in cover:
// bolts that still get through hit for half and come in less accurately, and guards look for
// low cover to crouch behind and pop up from. Blasts (grenades, rockets, charges) flush people out:
// for a few seconds after one goes off nearby, cover gives nothing and guards break and run.
import { K, COVER } from '../config.js';
import { raycast, queryBoxes, navWalkable, lineOfSight, groundAt } from '../world.js';
import { dist2 } from '../math.js';

// Does something solid stand between a body at (x, y, z) and a shooter at (tx, tz), right against it?
export function coverFrom(W, x, y, z, tx, tz, crouched) {
  const dx = tx - x, dz = tz - z, l = Math.hypot(dx, dz);
  if (l < 2) return false;
  const hit = raycast(W, x, y + (crouched ? COVER.lowBody : COVER.highBody), z, dx / l, 0, dz / l, COVER.reach, { terrain: false });
  return !!(hit && hit.box && hit.box.tag !== 'door');
}

export const flushed = (game, e) => game.time < (e.flushedUntil || 0);

// Is e in cover from src right now?
export function inCover(game, e, src) {
  if (!src || flushed(game, e) || e.vehicle) return false;
  return coverFrom(game.world, e.x, e.y, e.z, src.x, src.z, !!e.crouch);
}

// What a player's cover meter shows: 0 out in the open, 1 next to cover (nothing hunting them),
// 2 in cover from the nearest guard hunting them, 3 flushed out by a blast, 4 next to cover but
// the nearest guard hunting them has the angle on it (flanked, or standing up behind low cover)
export function playerCoverState(game, p) {
  if (flushed(game, p)) return 3;
  if (p.vehicle || p.aboard || p.downed) return 0;
  let threat = null, bd = 60;
  for (const e of game.nearby(p.x, p.z, 60)) {
    if (!e.hostile || e.dead || !e.ai || e.ai.state !== 'combat' || e.ai.target !== p.id) continue;
    const d = dist2(e.x, e.z, p.x, p.z);
    if (d < bd) { bd = d; threat = e; }
  }
  if (threat && coverFrom(game.world, p.x, p.y, p.z, threat.x, threat.z, !!p.crouch)) return 2;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    if (coverFrom(game.world, p.x, p.y, p.z, p.x + Math.sin(a) * 10, p.z + Math.cos(a) * 10, true)) return threat ? 4 : 1;
  }
  return 0;
}

// Knock everyone near a blast out of cover
export function flushAround(game, x, z, radius) {
  const r = radius * COVER.flushRange;
  for (const e of game.nearby(x, z, r)) {
    if (e.dead || (e.kind !== K.PLAYER && !e.ai)) continue;
    if (dist2(x, z, e.x, e.z) > r) continue;
    e.flushedUntil = game.time + COVER.flush;
    if (e.ai && e.ai.cover) {
      releaseCover(game, e);
      e.ai.coverBan = game.time + COVER.flush;
      e.ai.flushFrom = { x, z };
      if (game.rng() < 0.6) game.bark(e, ['Grenade! Move!', 'Get out of there!', 'Scatter!', 'Fall back!'][Math.floor(game.rng() * 4)]);
    }
  }
}

// ---- guards: finding and holding low cover

const key = (x, z) => `${Math.round(x * 2)},${Math.round(z * 2)}`;
export function releaseCover(game, e) {
  const c = e.ai && e.ai.cover;
  if (!c) return;
  if (game.coverClaims && game.coverClaims.get(c.key) === e.id) game.coverClaims.delete(c.key);
  e.ai.cover = null;
  e.crouch = false;
}
function claimed(game, k, e) {
  const id = game.coverClaims && game.coverClaims.get(k);
  if (id == null || id === e.id) return false;
  const o = game.ents.get(id);
  return !!(o && !o.dead && o.ai && o.ai.cover && o.ai.cover.key === k);
}

// The best spot within reach to wait out of the target's line of fire. Two kinds:
//  - low cover (sandbags, crates, hauler beds): crouch behind it, stand up to shoot over the top;
//  - tall cover (containers, wall corners, tanks): stand behind the corner, sidestep out to shoot.
// Candidates are walked round each box's outline; the spot has to be on our level, unclaimed, hidden
// from the target, and have a way to shoot back (over the top, or from a peek spot beside it).
export function findCoverSpot(game, e, t, R = 16) {
  const W = game.world;
  let best = null, bs = 1e9;
  const fy = groundAt(W, e.x, e.z, e.y + 0.6); // feet, even mid-step or mid-drop
  const ty = t.y + 1.2;
  queryBoxes(W, e.x - R, e.z - R, e.x + R, e.z + R, (b) => {
    if (!b.solid || b.tag === 'door' || b.tag === 'tank' || b.tag === 'mast') return;
    const top = b.maxY - fy;
    if (b.minY > fy + 0.5 || top < 0.95) return;
    const w = b.maxX - b.minX, d = b.maxZ - b.minZ;
    if (w > 20 || d > 20 || Math.min(w, d) < 0.25) return;
    const tall = top > 1.75;
    const off = 0.62, step = 1.2;
    const pts = [];
    for (let x = b.minX + Math.min(0.3, w / 2); x <= b.maxX - Math.min(0.3, w / 2) + 1e-6; x += step) pts.push(x, b.minZ - off, x, b.maxZ + off);
    for (let z = b.minZ + Math.min(0.3, d / 2); z <= b.maxZ - Math.min(0.3, d / 2) + 1e-6; z += step) pts.push(b.minX - off, z, b.maxX + off, z);
    for (let i = 0; i < pts.length; i += 2) {
      const sx = pts[i], sz = pts[i + 1];
      const de = dist2(e.x, e.z, sx, sz);
      if (de > R) continue;
      const dt = dist2(sx, sz, t.x, t.z);
      if (dt < 6 || dt > 34) continue;
      // the box has to sit between the spot and the target
      const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
      if ((sx - cx) * (t.x - cx) + (sz - cz) * (t.z - cz) > 0) continue;
      const score = de + Math.abs(dt - 15) * 0.25 + (tall ? 0.8 : 0);
      if (score >= bs) continue;
      const k2 = key(sx, sz);
      if (claimed(game, k2, e)) continue;
      if (!navWalkable(W, sx, sz)) continue;
      const gy = groundAt(W, sx, sz, fy + 1.5);
      if (Math.abs(gy - fy) > 0.6) continue;
      if (!coverFrom(W, sx, gy, sz, t.x, t.z, !tall)) continue;
      let peek = null;
      if (!tall) {
        if (!lineOfSight(W, sx, gy + 1.35, sz, t.x, ty, t.z)) continue; // room to pop up and shoot
      } else {
        // step out sideways, across the line to the target
        let px = -(t.z - sz), pz = t.x - sx;
        const l = Math.hypot(px, pz) || 1; px /= l; pz /= l;
        for (const sg of [1, -1]) {
          const qx = sx + px * sg * 1.0, qz = sz + pz * sg * 1.0;
          if (navWalkable(W, qx, qz) && lineOfSight(W, qx, gy + 1.4, qz, t.x, ty, t.z)) { peek = { x: qx, z: qz }; break; }
        }
        if (!peek) continue;
      }
      bs = score; best = { x: sx, z: sz, key: k2, tall, peek };
    }
  });
  if (best) { (game.coverClaims ||= new Map()).set(best.key, e.id); }
  return best;
}
