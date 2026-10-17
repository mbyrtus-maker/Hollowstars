// Projectiles, grenades, explosions, the arc blade, and psionic Current powers.

import { K, WEAPONS, POWERS, F } from '../config.js';
import { clamp, angleDiff, yawTo, segVsVertical, dist2, dirFromYawPitch } from '../math.js';
import { raycast, lineOfSight, terrainHeight, queryBoxes } from '../world.js';
import { isUnaware } from './ai.js';

const HIT_R = { [K.CRITTER]: 0.6, [K.SPEEDER]: 1.3, [K.CAMERA]: 0.42, [K.PICKUP]: 0, [K.TRAFFIC]: 1.2 };

export function hittable(e) {
  return !e.dead && e.kind !== K.PICKUP && e.kind !== K.GRENADE;
}

// ------------------------------------------------------------------ bolts

export function stepBolts(game, dt) {
  const W = game.world;
  for (let i = game.bolts.length - 1; i >= 0; i--) {
    const b = game.bolts[i];
    b.life -= dt;
    const sp = Math.hypot(b.vx, b.vy, b.vz);
    const len = sp * dt;
    const dx = b.vx / sp, dy = b.vy / sp, dz = b.vz / sp;
    const hit = raycast(W, b.x, b.y, b.z, dx, dy, dz, len, { terrainStep: 1.5 });
    let tBest = hit ? hit.t : len;
    let target = null;
    const ex = b.x + dx * len, ey = b.y + dy * len, ez = b.z + dz * len;
    const minX = Math.min(b.x, ex) - 1.5, maxX = Math.max(b.x, ex) + 1.5;
    const minZ = Math.min(b.z, ez) - 1.5, maxZ = Math.max(b.z, ez) + 1.5;
    for (const e of game.ents.values()) {
      if (e.x < minX || e.x > maxX || e.z < minZ || e.z > maxZ) continue;
      if (e.id === b.owner || !hittable(e)) continue;
      if (e.kind === K.PLAYER && (b.team === 'player' || e.downed)) continue;
      if (e.kind === K.SPEEDER && e.driver && b.team === 'player') continue;
      if ((e.kind === K.LANCER || e.kind === K.OFFICER || e.kind === K.CAMERA) && b.team === 'enemy') continue;
      if (e.kind === K.PRISONER && b.team === 'enemy') continue; // the Concordance wants her alive
      if (b.team === 'hunter' && e.kind !== K.CRITTER) continue; // hunters only shoot game
      if (e.kind === K.TRAFFIC && b.team !== 'player') continue;
      if (e.kind === K.PLAYER && e.vehicle) continue; // speeder takes the hit
      const r = HIT_R[e.kind] ?? 0.42;
      let y0 = e.y + 0.05, y1 = e.y + (e.crouch || (e.flags & F.CROUCH) ? 1.1 : e.h);
      if (e.kind === K.CAMERA) { y0 = e.y - 0.25; y1 = e.y + 0.25; }
      if (e.kind === K.SPEEDER) { y0 = e.y - 0.3; y1 = e.y + 1.0; }
      if (e.kind === K.TRAFFIC) { y0 = e.y - 0.5; y1 = e.y + 1.3; }
      if (e.downed || (e.flags & F.DOWNED)) y1 = e.y + 0.5;
      const res = segVsVertical(b.x, b.y, b.z, ex, ey, ez, e.x, y0, y1, e.z);
      if (res.d < r) {
        const t = res.t * len;
        if (t < tBest) { tBest = t; target = { e, y: res.y }; }
      }
    }
    const hx = b.x + dx * tBest, hy = b.y + dy * tBest, hz = b.z + dz * tBest;
    if (target) {
      const e = target.e;
      if (e.kind === K.PLAYER && tryDeflect(game, e, b, hx, hy, hz)) {
        continue; // bolt re-aimed, keep it alive
      }
      const head = e.kind !== K.CAMERA && e.kind !== K.SPEEDER && target.y > e.y + (e.flags & F.CROUCH ? 0.9 : e.h - 0.32);
      const silentKill = b.knife && isUnaware(e);
      game.damage(e, silentKill ? 999 : b.dmg * (head ? 1.8 : 1), game.ents.get(b.owner), { kind: b.knife ? 'knife' : 'bolt', head, silent: silentKill || (b.knife && e.hp <= b.dmg), x: hx, y: hy, z: hz, dir: [dx, dy, dz], deflected: b.deflected });
      game.event(['bend', b.id, +hx.toFixed(2), +hy.toFixed(2), +hz.toFixed(2), e.kind === K.CAMERA || e.kind === K.SPEEDER ? 2 : 1]);
      game.bolts.splice(i, 1);
      continue;
    }
    if (hit) {
      if (hit.box && hit.box.tag && b.team === 'player') {
        const d = Object.values(W.destructibles).find((q) => q.boxId === hit.box.id);
        if (d) game.damageDestructible(d, b.dmg, game.ents.get(b.owner));
      }
      game.event(['bend', b.id, +hx.toFixed(2), +hy.toFixed(2), +hz.toFixed(2), 0]);
      game.bolts.splice(i, 1);
      continue;
    }
    b.x = ex; b.y = ey; b.z = ez;
    if (b.life <= 0 || b.y < -50) game.bolts.splice(i, 1);
  }
}

// The arc blade catches bolts on its own whenever it's drawn and the bolt comes from the
// front, and sends them where the Warden is looking. Holding block widens the arc, and a
// block raised just in time sends the bolt straight back at whoever fired it.
function tryDeflect(game, p, b, hx, hy, hz) {
  if (b.team !== 'enemy' || p.weapon !== 'blade' || !p.drawn || p.vehicle || p.downed) return false;
  const bw = WEAPONS.blade;
  const blocking = p.blocking;
  const inYaw = yawTo(0, 0, -b.vx, -b.vz);
  if (Math.abs(angleDiff(p.yaw, inYaw)) > (blocking ? bw.deflectCone : bw.autoDeflectCone)) return false;
  const att = p.upgrades.attune ? 0.6 : 1;
  const cost = (blocking ? bw.deflectFocus : bw.autoDeflectFocus) * att;
  if (blocking) { if (p.focus < cost) return false; p.focus -= cost; p.focusUsedAt = game.time; }
  else p.focus = Math.max(0, p.focus - cost); // the automatic catch never fails, it just tires you
  const perfect = blocking && game.time - p.blockStart < bw.perfectWindow;
  const shooter = game.ents.get(b.owner);
  const sp = Math.hypot(b.vx, b.vy, b.vz) * 1.15;
  let d;
  if (perfect && shooter && !shooter.dead) {
    d = { x: shooter.x - hx, y: shooter.y + 1.2 - hy, z: shooter.z - hz };
  } else {
    // where the Warden is looking, nudged onto an enemy close to that line
    d = dirFromYawPitch(p.yaw, p.pitch || 0);
    let best = null, bestA = bw.deflectAssist;
    for (const e of game.nearby(p.x, p.z, 60)) {
      if (!e.hostile || e.dead) continue;
      const tx = e.x - hx, ty = e.y + 1.1 - hy, tz = e.z - hz;
      const tl = Math.hypot(tx, ty, tz) || 1;
      const a = Math.acos(Math.max(-1, Math.min(1, (tx * d.x + ty * d.y + tz * d.z) / tl)));
      if (a < bestA) { bestA = a; best = { x: tx, y: ty, z: tz }; }
    }
    if (best) d = best;
  }
  const l = Math.hypot(d.x, d.y, d.z) || 1;
  const dx = d.x / l, dy = d.y / l, dz = d.z / l;
  b.vx = dx * sp; b.vy = dy * sp; b.vz = dz * sp;
  b.x = hx + dx * 0.3; b.y = hy + dy * 0.3; b.z = hz + dz * 0.3;
  b.team = 'player';
  b.owner = p.id;
  b.deflected = true;
  b.life = 2;
  game.event(['defl', b.id, +b.x.toFixed(2), +b.y.toFixed(2), +b.z.toFixed(2), +b.vx.toFixed(2), +b.vy.toFixed(2), +b.vz.toFixed(2), p.id, perfect ? 1 : 0]);
  return true;
}

// ------------------------------------------------------------------ grenades

export function stepGrenades(game, dt) {
  const W = game.world;
  for (const g of [...game.ents.values()]) {
    if (g.kind !== K.GRENADE) continue;
    g.fuse -= dt;
    const sub = 3;
    for (let s = 0; s < sub; s++) {
      const h = dt / sub;
      g.vy -= 22 * h;
      let nx = g.x + g.vx * h, ny = g.y + g.vy * h, nz = g.z + g.vz * h;
      // boxes
      queryBoxes(W, nx - 0.15, nz - 0.15, nx + 0.15, nz + 0.15, (b) => {
        if (!b.solid) return;
        if (nx < b.minX - 0.12 || nx > b.maxX + 0.12 || ny < b.minY - 0.12 || ny > b.maxY + 0.12 || nz < b.minZ - 0.12 || nz > b.maxZ + 0.12) return;
        // reflect along the axis we entered from
        const wasInX = g.x > b.minX - 0.12 && g.x < b.maxX + 0.12;
        const wasInY = g.y > b.minY - 0.12 && g.y < b.maxY + 0.12;
        const wasInZ = g.z > b.minZ - 0.12 && g.z < b.maxZ + 0.12;
        if (!wasInY) { g.vy = -g.vy * 0.35; g.vx *= 0.7; g.vz *= 0.7; ny = g.y; }
        else if (!wasInX) { g.vx = -g.vx * 0.4; nx = g.x; }
        else if (!wasInZ) { g.vz = -g.vz * 0.4; nz = g.z; }
        else { ny = b.maxY + 0.13; g.vy = Math.abs(g.vy) * 0.3; }
      });
      const th = terrainHeight(nx, nz) + 0.12;
      if (ny < th) { ny = th; if (g.vy < 0) g.vy = -g.vy * 0.35; g.vx *= 0.72; g.vz *= 0.72; }
      g.x = nx; g.y = ny; g.z = nz;
    }
    g.yaw += dt * 8;
    if (g.fuse <= 0 && g.noisemaker) {
      game.removeEnt(g);
      game.event(['noisy', +g.x.toFixed(2), +g.y.toFixed(2), +g.z.toFixed(2)]);
      game.noise(g.x, g.y, g.z, 30, game.ents.get(g.owner) || null, false);
      continue;
    }
    if (g.fuse <= 0) {
      game.removeEnt(g);
      explode(game, g.x, g.y + 0.2, g.z, WEAPONS.grenade.radius, WEAPONS.grenade.damage, game.ents.get(g.owner), 'grenade');
    }
  }
}

export function explode(game, x, y, z, radius, dmg, src, cause) {
  game.event(['boom', +x.toFixed(2), +y.toFixed(2), +z.toFixed(2), radius]);
  game.noise(x, y, z, WEAPONS.grenade.noise, src && src.kind === K.PLAYER ? src : null, true);
  for (const e of [...game.ents.values()]) {
    if (!hittable(e) || e.kind === K.CAMERA && dist2(x, z, e.x, e.z) > radius) continue;
    const cy = e.y + 0.9;
    const d = Math.hypot(e.x - x, cy - y, e.z - z);
    if (d > radius) continue;
    if (!lineOfSight(game.world, x, y + 0.3, z, e.x, cy, e.z, { terrain: false }) && d > 2) continue;
    const f = Math.pow(1 - d / radius, 0.75);
    let amt = dmg * f;
    if (e.kind === K.PLAYER && src && src.kind === K.PLAYER) amt *= e.id === src.id ? 0.5 : 0.35;
    game.damage(e, amt, src, { kind: 'explosion', x, y, z });
    // knockback
    const kx = (e.x - x) / (d + 0.1), kz = (e.z - z) / (d + 0.1);
    const kf = 14 * f;
    if (e.kind === K.PLAYER) game.impulse(e, kx * kf, 4 + 5 * f, kz * kf);
    else if (e.kind !== K.SPEEDER && e.kind !== K.CAMERA && !e.dead) {
      e.vx = kx * kf; e.vz = kz * kf; e.vy = 4 + 6 * f; e.stagger = Math.max(e.stagger || 0, 0.8); e.staggerBy = src ? src.id : null;
    }
  }
  for (const d of Object.values(game.world.destructibles)) {
    if (d.destroyed) continue;
    const dd = Math.max(0, dist2(x, z, d.x, d.z) - d.radius);
    if (dd < radius && y > d.y - 1 && y < d.y + d.height + 1) game.damageDestructible(d, dmg * Math.pow(1 - dd / radius, 0.6) * 1.2, src);
  }
}

// ------------------------------------------------------------------ blade

export function bladeSwing(game, p) {
  const bw = p.weapon === 'knives' ? WEAPONS.knives : WEAPONS.blade;
  if (game.time - p.lastSwing < bw.swingTime * 0.85) return;
  p.lastSwing = game.time;
  p.swingCount = (p.swingCount + 1) % 1000;
  let hitAny = false;
  for (const e of game.nearby(p.x, p.z, bw.range + 1.2)) {
    if (e === p || !hittable(e) || e.kind === K.PLAYER || e.kind === K.SPEEDER) continue;
    const d = dist2(p.x, p.z, e.x, e.z);
    if (d > bw.range + 0.6 + (HIT_R[e.kind] ?? 0.4)) continue;
    if (Math.abs(e.y - p.y) > 2.2 && e.kind !== K.CAMERA) continue;
    if (e.kind === K.CAMERA && Math.abs(e.y - (p.y + 1.4)) > 2.6) continue;
    const ang = Math.abs(angleDiff(p.yaw, yawTo(p.x, p.z, e.x, e.z)));
    if (ang > bw.arc && d > 0.9) continue;
    const takedown = isUnaware(e);
    const amt = takedown ? 999 : bw.damage;
    game.damage(e, amt, p, { kind: 'blade', silent: takedown, x: e.x, y: e.y + 1.1, z: e.z });
    game.event(['slash', +e.x.toFixed(2), +(e.y + 1.1).toFixed(2), +e.z.toFixed(2), p.id, takedown ? 1 : 0]);
    hitAny = true;
  }
  // Blades cut through fuel tanks too
  if (p.weapon === 'blade') for (const d of Object.values(game.world.destructibles)) {
    if (d.destroyed) continue;
    if (dist2(p.x, p.z, d.x, d.z) - d.radius < bw.range && Math.abs(angleDiff(p.yaw, yawTo(p.x, p.z, d.x, d.z))) < bw.arc + 0.3) {
      game.damageDestructible(d, 40, p);
      hitAny = true;
    }
  }
  if (hitAny) game.noise(p.x, p.y, p.z, bw.noise, p, false);
}

// ------------------------------------------------------------------ the Current

export function powerPush(game, p, aim) {
  const P = POWERS.push;
  const cost = P.cost * (p.upgrades.attune ? 0.75 : 1);
  if (p.focus < cost || game.time < p.cd.push) return false;
  p.focus -= cost; p.focusUsedAt = game.time; p.cd.push = game.time + P.cooldown;
  const yaw = p.yaw;
  game.event(['push', p.id, +p.x.toFixed(2), +(p.y + 1.2).toFixed(2), +p.z.toFixed(2), +yaw.toFixed(3), +(aim?.pitch ?? 0).toFixed(3)]);
  for (const e of game.nearby(p.x, p.z, P.range)) {
    if (e === p || !hittable(e) || e.kind === K.PLAYER || e.kind === K.CAMERA) continue;
    const d = dist2(p.x, p.z, e.x, e.z);
    if (Math.abs(angleDiff(yaw, yawTo(p.x, p.z, e.x, e.z))) > P.halfAngle && d > 1.5) continue;
    if (Math.abs(e.y - p.y) > 4) continue;
    if (!lineOfSight(game.world, p.x, p.y + 1.2, p.z, e.x, e.y + 1, e.z, { terrain: false })) continue;
    const f = 1 - (d / P.range) * 0.5;
    const ux = (e.x - p.x) / (d || 1), uz = (e.z - p.z) / (d || 1);
    if (e.kind === K.SPEEDER) { e.vx = (e.vx || 0) + ux * 10; e.vz = (e.vz || 0) + uz * 10; continue; }
    e.vx = ux * P.force * f; e.vz = uz * P.force * f; e.vy = P.lift * f;
    e.onGround = false;
    e.stagger = 1.6; e.staggerBy = p.id;
    game.damage(e, P.damage, p, { kind: 'push', silent: false });
  }
  // Swat incoming bolts and grenades
  for (const b of game.bolts) {
    const d = dist2(p.x, p.z, b.x, b.z);
    if (d < P.range * 0.7 && Math.abs(angleDiff(yaw, yawTo(p.x, p.z, b.x, b.z))) < P.halfAngle + 0.3) {
      const dir = dirFromYawPitch(yaw + (game.rng() - 0.5) * 0.6, 0.15);
      const sp = Math.hypot(b.vx, b.vy, b.vz);
      b.vx = dir.x * sp; b.vy = dir.y * sp; b.vz = dir.z * sp; b.team = 'player'; b.owner = p.id;
      game.event(['defl', b.id, +b.x.toFixed(2), +b.y.toFixed(2), +b.z.toFixed(2), +b.vx.toFixed(2), +b.vy.toFixed(2), +b.vz.toFixed(2), p.id, 0]);
    }
  }
  for (const g of game.ents.values()) {
    if (g.kind !== K.GRENADE) continue;
    const d = dist2(p.x, p.z, g.x, g.z);
    if (d < P.range && Math.abs(angleDiff(yaw, yawTo(p.x, p.z, g.x, g.z))) < P.halfAngle + 0.2) {
      const ux = (g.x - p.x) / (d || 1), uz = (g.z - p.z) / (d || 1);
      g.vx = ux * 18; g.vz = uz * 18; g.vy = 6;
    }
  }
  game.noise(p.x, p.y, p.z, P.noise, p, false);
  return true;
}

export function powerPull(game, p, aim) {
  const P = POWERS.pull;
  const cost = P.cost * (p.upgrades.attune ? 0.75 : 1);
  if (p.focus < cost || game.time < p.cd.pull) return false;
  const dir = dirFromYawPitch(aim.yaw, aim.pitch);
  const ox = p.x, oy = p.y + 1.55, oz = p.z;
  let best = null, bestScore = 1e9;
  for (const e of game.nearby(p.x, p.z, P.range)) {
    if (e === p || !hittable(e) || e.kind === K.PLAYER || e.kind === K.CAMERA || e.kind === K.SPEEDER) continue;
    const dx = e.x - ox, dy = e.y + 1 - oy, dz = e.z - oz;
    const d = Math.hypot(dx, dy, dz);
    if (d > P.range || d < 1.5) continue;
    const dot = (dx * dir.x + dy * dir.y + dz * dir.z) / d;
    const ang = Math.acos(clamp(dot, -1, 1));
    if (ang > P.aimCone + 0.6 / d) continue;
    if (!lineOfSight(game.world, ox, oy, oz, e.x, e.y + 1, e.z)) continue;
    const score = ang * 10 + d * 0.05;
    if (score < bestScore) { bestScore = score; best = e; }
  }
  if (!best) return false;
  p.focus -= cost; p.focusUsedAt = game.time; p.cd.pull = game.time + P.cooldown;
  const dx = p.x - best.x, dz = p.z - best.z, d = Math.hypot(dx, dz) || 1;
  const sp = Math.min(P.force, d * 2.2 + 4);
  best.vx = (dx / d) * sp; best.vz = (dz / d) * sp; best.vy = 4.5;
  best.onGround = false;
  best.stagger = P.stun; best.staggerBy = p.id;
  if (best.hasKeycard && !best.dead && game.rng() < 0.5) {
    // Yank the keycard right off his belt
    best.hasKeycard = false;
    game.spawnPickup('keycard', best.x, best.y + 1, best.z, dx / d * 6, 4, dz / d * 6);
    game.bark(best, 'My keycard!');
  }
  game.event(['pull', p.id, best.id]);
  if (best.hostile) game.damage(best, 1, p, { kind: 'pull', silent: true });
  return true;
}
