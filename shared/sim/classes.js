// Crew classes: loadouts, Q/F/X abilities, and the Warden's "wanted" status.
import { CLASSES, DEFAULT_CLASS, WEAPONS, POWERS, K, STEALTH, ADVANCED, LEVELS, effectiveClass, levelOf } from '../config.js';
import { clamp, dist2, yawTo, angleDiff, dirFromYawPitch } from '../math.js';
import { lineOfSight, navWalkable, terrainHeight, groundAt, raycast } from '../world.js';
import { isUnaware, pick, spawnGuard } from './ai.js';
import { powerPush, powerPull } from './combat.js';

export const classOf = (p) => effectiveClass(p.cls, p.adv);
export const levelOfPlayer = (p) => levelOf(p.xp || 0).lv;

export function applyLoadout(p, cls, prof) {
  if (!CLASSES[cls]) cls = DEFAULT_CLASS;
  p.cls = cls;
  // an advanced class sticks once chosen, as long as the level still allows it
  const adv = prof && prof.advs && prof.advs[cls];
  p.adv = adv && ADVANCED[adv] && ADVANCED[adv].base === cls && levelOf(p.xp || 0).lv >= LEVELS.advancedAt ? adv : null;
  const C = effectiveClass(cls, p.adv);
  p.weapon = C.weapon;
  const same = prof && prof.cls === cls;
  p.grenades = same && prof.grenades != null ? Math.min(C.maxGrenades, prof.grenades) : C.grenades;
  p.medpacks = same && prof.medpacks != null ? Math.min(C.maxMedpacks, prof.medpacks) : C.medpacks;
  p.cdk = { q: 0, f: 0, x: 0 };
  p.act = {}; // active ability -> expiry time
  p.knives = 3;
  p.knifeRegen = 0;
  p.mines = 2;
  p.mineRegen = 0;
  p.stillT = 0;
  p.overshield = 0;
  p.invulnUntil = 0;
}

export function weaponStats(p) { return WEAPONS[p.weapon] || WEAPONS.blaster; }
export const active = (g, p, id) => (p.act[id] || 0) > g.time;

// Pick the best target near the aim ray
function aimTarget(g, p, yaw, pitch, range, cone, filter) {
  const dir = dirFromYawPitch(yaw, pitch);
  const ox = p.x, oy = p.y + 1.5, oz = p.z;
  let best = null, bs = 1e9;
  for (const e of g.nearby(p.x, p.z, range)) {
    if (e === p || !filter(e)) continue;
    const dx = e.x - ox, dy = e.y + 1 - oy, dz = e.z - oz;
    const d = Math.hypot(dx, dy, dz);
    if (d > range || d < 0.3) continue;
    const ang = Math.acos(clamp((dx * dir.x + dy * dir.y + dz * dir.z) / d, -1, 1));
    if (ang > cone + 0.5 / d) continue;
    if (!lineOfSight(g.world, ox, oy, oz, e.x, e.y + 1, e.z)) continue;
    const sc = ang * 8 + d * 0.05;
    if (sc < bs) { bs = sc; best = e; }
  }
  return best;
}
const isFoe = (e) => e.hostile && !e.dead && e.kind !== K.CAMERA;

export function useAbility(g, p, k, m) {
  const C = classOf(p);
  const A = C.abilities[k];
  if (!A || p.downed || p.dead) return;
  const yaw = Number.isFinite(+m.yaw) ? +m.yaw : p.yaw, pitch = Number.isFinite(+m.pitch) ? +m.pitch : p.pitch;
  const ready = () => g.time >= p.cdk[k];
  // every level shaves a little off ability cooldowns
  const spend = (cd) => { p.cdk[k] = g.time + cd * (1 - LEVELS.cdPer * (levelOfPlayer(p) - 1)); };
  switch (A.id) {
    // ---- Warden (uses Focus)
    case 'push': powerPush(g, p, { yaw, pitch }); break;
    case 'pull': if (!powerPull(g, p, { yaw, pitch })) g.pnote(p, 'Nothing to pull.', 'warn'); break;
    case 'suggest': {
      const P = POWERS.suggest;
      const cost = P.cost * (p.upgrades.attune ? 0.75 : 1);
      if (p.focus < cost || g.time < p.cd.suggest) return;
      const t = aimTarget(g, p, yaw, pitch, P.range, 0.22, isFoe);
      if (!t) { g.pnote(p, 'No one to suggest anything to.', 'warn'); return; }
      p.focus -= cost; p.focusUsedAt = g.time; p.cd.suggest = g.time + P.cooldown;
      const ai = t.ai;
      ai.ignore = { id: p.id, until: g.time + P.forget };
      if (ai.state === 'combat') { ai.state = 'search'; ai.lkp = null; ai.target = null; ai.alarmAt = null; ai.search = { x: t.x + 15, z: t.z, until: g.time + 8 }; ai.pendingAlert = null; }
      else { ai.state = 'routine'; ai.wait = 0; }
      ai.sus = 0;
      g.bark(t, pick(['Huh. Nothing to see here.', 'I should go check the depot.', 'These aren\'t the... never mind.', 'Must have been a skitter.', 'Move along. I mean — I\'ll move along.'], g.rng));
      g.event(['suggest', p.id, t.id]);
      break;
    }
    // ---- Gunslinger
    case 'fan': {
      if (!ready()) return;
      spend(A.cd);
      const d = g.validDir(m.d) || [dirFromYawPitch(yaw, pitch).x, dirFromYawPitch(yaw, pitch).y, dirFromYawPitch(yaw, pitch).z];
      const W = WEAPONS.pistols;
      for (let i = 0; i < 6; i++) {
        g.later(i * 0.06, () => {
          if (p.downed || !g.ents.has(p.id)) return;
          const sp = 0.05;
          const dx = d[0] + (g.rng() - 0.5) * sp, dy = d[1] + (g.rng() - 0.5) * sp * 0.6, dz = d[2] + (g.rng() - 0.5) * sp;
          const l = Math.hypot(dx, dy, dz);
          const side = i % 2 ? 1 : -1;
          const rx = Math.cos(p.yaw) * 0.3 * side, rz = -Math.sin(p.yaw) * 0.3 * side;
          g.spawnBolt(p, p.x + rx + d[0] * 0.5, p.y + 1.35, p.z + rz + d[2] * 0.5, dx / l, dy / l, dz / l, W.boltSpeed, W.damage * (active(g, p, 'deadeye') ? 1.8 : 1) * (p.upgrades.coil ? 1.4 : 1), 'player', p.upgrades.damper ? 12 : W.noise);
        });
      }
      p.swingCount = (p.swingCount + 1) % 1000;
      break;
    }
    case 'roll': if (!ready()) return; spend(A.cd); p.invulnUntil = g.time + 0.5; p.impulseT = g.time; g.event(['roll', p.id]); break;
    case 'deadeye': if (!ready()) return; spend(A.cd); p.act.deadeye = g.time + A.dur; g.pnote(p, 'Deadeye: every shot hits harder', 'stealth'); break;
    // ---- Soldier
    case 'suppress': if (!ready()) return; spend(A.cd); p.act.suppress = g.time + A.dur; p.heat = 0; p.overheated = false; g.pnote(p, 'Suppressive fire: no overheating', 'info'); break;
    case 'bulwark': if (!ready()) return; spend(A.cd); p.act.bulwark = g.time + A.dur; p.overshield = 70; g.event(['bulwark', p.id]); break;
    // ---- Medic
    case 'burst': {
      if (!ready()) return;
      spend(A.cd);
      let n = 0;
      for (const o of g.players()) {
        if (dist2(o.x, o.z, p.x, p.z) > 10) continue;
        if (o.downed) { g.revive(o, p); o.hp = 50; } else o.hp = Math.min(o.maxHp, o.hp + 40);
        n++;
      }
      g.event(['burst', p.id, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)]);
      g.pnote(p, `Med burst patched up ${n} ${n === 1 ? 'crewmate' : 'crewmates'}`, 'credits');
      break;
    }
    case 'dart': {
      if (!ready()) return;
      const ally = aimTarget(g, p, yaw, pitch, 32, 0.25, (e) => e.kind === K.PLAYER && e !== p);
      spend(A.cd);
      const tgt = ally || p;
      if (tgt.downed) g.revive(tgt, p);
      tgt.hp = Math.min(tgt.maxHp, tgt.hp + (ally ? 45 : 25));
      g.event(['dart', p.id, tgt.id]);
      if (ally) g.pnote(ally, `${p.name} hit you with a stim dart`, 'credits');
      break;
    }
    // ---- Spy
    case 'execute': {
      if (!ready()) return;
      const t = aimTarget(g, p, yaw, pitch, 7.5, 0.45, (e) => !e.dead && (e.hostile || e.kind === K.CRITTER) && e.kind !== K.CAMERA);
      if (!t) { g.pnote(p, 'No target in reach. Get within a few meters.', 'warn'); return; }
      spend(A.cd);
      const finish = isUnaware(t) || t.hp / t.maxHp < 0.5 || t.stagger > 0 || active(g, p, 'cloak');
      const silent = isUnaware(t) || active(g, p, 'cloak') && t.ai && t.ai.state !== 'combat';
      // blink in behind the target
      const bx = t.x + Math.sin(t.yaw) * 1.1, bz = t.z + Math.cos(t.yaw) * 1.1;
      const by = groundAt(g.world, bx, bz, t.y + 1.5) + 0.02;
      const ox = p.x, oz = p.z;
      if (navWalkable(g.world, bx, bz) || Math.abs(by - t.y) < 1) g.teleport(p, bx, by, bz);
      g.event(['exec', p.id, t.id, +ox.toFixed(2), +oz.toFixed(2), finish ? 1 : 0]);
      p.swingCount = (p.swingCount + 1) % 1000;
      if (finish) g.damage(t, 999, p, { kind: 'execute', silent, x: t.x, y: t.y + 1.1, z: t.z });
      else { g.damage(t, 40, p, { kind: 'execute' }); t.stagger = Math.max(t.stagger || 0, 1.2); t.staggerBy = p.id; }
      breakCloak(g, p);
      break;
    }
    case 'knife': {
      if (p.knives <= 0) { g.pnote(p, 'Out of throwing knives — they come back in a few seconds.', 'warn'); return; }
      const d = g.validDir(m.d);
      if (!d) return;
      p.knives--;
      const o = g.validOrigin(p, m.o, 3);
      const b = g.spawnBolt(p, o[0], o[1], o[2], d[0], d[1], d[2], WEAPONS.thrownKnife.speed, WEAPONS.thrownKnife.damage, 'player', 0, m.c | 0, 2);
      b.knife = true;
      break;
    }
    // ---- Sniper
    case 'overcharge': if (!ready()) return; spend(A.cd); p.act.overcharge = g.time + A.dur; g.pnote(p, 'Overcharged: your next shot punches through', 'stealth'); g.event(['charge', p.id]); break;
    case 'mine': {
      if (p.mines <= 0) { g.pnote(p, 'No mines ready. They come back in a while.', 'warn'); return; }
      const f = dirFromYawPitch(yaw, 0);
      const mx = p.x + f.x * 1.4, mz = p.z + f.z * 1.4;
      const my = groundAt(g.world, mx, mz, p.y + 1.5);
      if (Math.abs(my - p.y) > 1.5) { g.pnote(p, 'Find flat ground for the mine.', 'warn'); return; }
      p.mines--;
      const mine = g.spawn({ kind: K.MINE, x: mx, y: my + 0.05, z: mz, yaw, owner: p.id, armAt: g.time + WEAPONS.mine.arm, hp: 20, maxHp: 20, r: 0.3, h: 0.2, a1: p.color });
      // a sniper keeps up to four mines in the ground; the oldest is reclaimed
      const mine4 = [...g.ents.values()].filter((e) => e.kind === K.MINE && e.owner === p.id);
      if (mine4.length > 4) g.removeEnt(mine4[0]);
      g.event(['mine', p.id, mine.id]);
      break;
    }
    case 'recon': {
      if (!ready()) return;
      spend(A.cd);
      const f = dirFromYawPitch(yaw, 0);
      let n = 0;
      for (const e of g.nearby(p.x, p.z, 110)) {
        if (!e.hostile || e.dead) continue;
        const dx = e.x - p.x, dz = e.z - p.z, d = Math.hypot(dx, dz) || 1;
        if ((dx * f.x + dz * f.z) / d < Math.cos(0.75)) continue;
        e.markedUntil = g.time + 14;
        n++;
      }
      g.event(['recon', p.id, +yaw.toFixed(2)]);
      g.note(`${p.name}'s recon sweep marked ${n} ${n === 1 ? 'hostile' : 'hostiles'} for the crew.`, n ? 'stealth' : 'info');
      break;
    }
    case 'phase': {
      if (!ready()) return;
      spend(A.cd);
      p.phaseShot = true;
      cloakUp(g, p, A.dur);
      break;
    }
    // ---- Guardian
    case 'bastion': {
      const cost = 35 * (p.upgrades.attune ? 0.75 : 1);
      if (!ready() || p.focus < cost) return;
      spend(A.cd);
      p.focus -= cost; p.focusUsedAt = g.time;
      p.act.bastion = g.time + A.dur;
      g.event(['bastion', p.id, A.dur]);
      break;
    }
    // ---- Bounty Hunter
    case 'rocket': {
      if (!ready()) return;
      const d = g.validDir(m.d);
      if (!d) return;
      spend(A.cd);
      const o = g.validOrigin(p, m.o, 3);
      const R = WEAPONS.wristRocket;
      const b = g.spawnBolt(p, o[0], o[1], o[2], d[0], d[1], d[2], R.speed, R.damage, 'player', 30, 0, 4);
      b.explode = { r: R.radius, dmg: R.damage };
      b.life = 3;
      break;
    }
    case 'bounty': {
      if (!ready()) return;
      const t = aimTarget(g, p, yaw, pitch, 80, 0.15, isFoe);
      if (!t) { g.pnote(p, 'No mark in your sights.', 'warn'); return; }
      spend(A.cd);
      t.bountyUntil = g.time + A.dur; t.bountyBy = p.id; t.markedUntil = Math.max(t.markedUntil || 0, g.time + A.dur);
      g.event(['bounty', p.id, t.id]);
      g.note(`${p.name} put a bounty on a ${t.kind === K.OFFICER ? 'Concordance officer' : 'Lancer'}: it takes half again the damage.`, 'stealth');
      break;
    }
    // ---- Commando
    case 'jets': {
      if (!ready()) return;
      spend(A.cd);
      const f = dirFromYawPitch(yaw, 0);
      p.impulseT = g.time;
      g.impulse(p, f.x * 11, 13, f.z * 11);
      g.event(['jets', p.id]);
      g.noise(p.x, p.y, p.z, 14, p, false);
      break;
    }
    case 'swarm': {
      if (!ready()) return;
      const f = dirFromYawPitch(yaw, 0);
      const targets = [];
      for (const e of g.nearby(p.x, p.z, 50)) {
        if (!isFoe(e)) continue;
        const dx = e.x - p.x, dz = e.z - p.z, d = Math.hypot(dx, dz) || 1;
        if ((dx * f.x + dz * f.z) / d < Math.cos(0.7)) continue;
        if (!lineOfSight(g.world, p.x, p.y + 2, p.z, e.x, e.y + 1, e.z)) continue;
        targets.push([d, e]);
      }
      targets.sort((a, b) => a[0] - b[0]);
      if (!targets.length) { g.pnote(p, 'No targets for the rocket pod.', 'warn'); return; }
      spend(A.cd);
      const R = WEAPONS.swarmRocket;
      for (let i = 0; i < 6; i++) {
        const t = targets[i % targets.length][1];
        g.later(i * 0.12, () => {
          if (!g.ents.has(p.id) || p.downed) return;
          const side = i % 2 ? 1 : -1;
          const ox = p.x + Math.cos(p.yaw) * 0.25 * side, oz = p.z - Math.sin(p.yaw) * 0.25 * side, oy = p.y + 2.0;
          const b = g.spawnBolt(p, ox, oy, oz, f.x * 0.6, 0.8, f.z * 0.6, R.speed, R.damage, 'player', 20, 0, 4);
          b.explode = { r: R.radius, dmg: R.damage };
          b.homing = t.id;
          b.life = 4;
        });
      }
      break;
    }
    // ---- Combat Surgeon
    case 'adrenal': {
      if (!ready()) return;
      spend(A.cd);
      let n = 0;
      for (const o of g.players()) {
        if (o.downed || dist2(o.x, o.z, p.x, p.z) > 15) continue;
        o.act.adrenal = g.time + A.dur;
        o.overshield = Math.max(o.overshield, 30);
        n++;
      }
      g.event(['adrenal', p.id, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)]);
      g.note(`${p.name} pumped ${n} of the crew full of adrenaline.`, 'credits');
      break;
    }
    // ---- Agent
    case 'decoy': {
      if (!ready()) return;
      const d = dirFromYawPitch(yaw, pitch);
      const hit = raycast(g.world, p.x, p.y + 1.5, p.z, d.x, d.y, d.z, 26, { terrainStep: 0.8 });
      const t = hit ? Math.max(1.5, hit.t - 0.8) : 26;
      const x = p.x + d.x * t, z = p.z + d.z * t;
      if (!navWalkable(g.world, x, z)) { g.pnote(p, 'Pick open ground for the decoy.', 'warn'); return; }
      spend(A.cd);
      const y = groundAt(g.world, x, z, p.y + d.y * t + 2);
      g.spawn({ kind: K.DECOY, x, y, z, yaw: p.yaw, owner: p.id, until: g.time + A.dur, nextNoise: 0, hp: 1, maxHp: 1, r: 0.4, h: 1.8, a1: p.color, a2: p.id });
      g.event(['decoy', p.id]);
      break;
    }
    case 'cloak': {
      if (!ready()) return;
      spend(A.cd);
      cloakUp(g, p, A.dur);
      break;
    }
  }
}

// Vanish: anyone tracking you loses sight and has to search where they last saw you
function cloakUp(g, p, dur) {
  p.act.cloak = g.time + dur; p.shroudUntil = g.time + dur; p.cloaked = true;
  for (const e of g.ents.values()) {
    if (!e.hostile || e.dead || !e.ai) continue;
    if (e.kind === K.CAMERA) { e.ai.sus = 0; e.ai.tracking = false; continue; }
    if (e.ai.target === p.id || (e.ai.stim && e.ai.stim.id === p.id)) {
      e.ai.target = null; e.ai.lastSeen = -99;
      e.ai.lkp = { x: p.x, y: p.y, z: p.z };
      if (e.ai.state !== 'combat') e.ai.sus = Math.min(e.ai.sus, 0.3);
    }
  }
  if (g.alarm.lkp && dist2(g.alarm.lkp.x, g.alarm.lkp.z, p.x, p.z) < 30) g.alarm.lkp = { x: p.x, y: p.y, z: p.z };
  g.event(['shroud', p.id, dur]);
}

export function breakCloak(g, p) {
  if (active(g, p, 'cloak')) {
    p.act.cloak = g.time + 0.25;
    p.shroudUntil = g.time + 0.25;
  }
}

export function tickClass(g, p, dt) {
  const C = classOf(p);
  if (C.abilities.f && C.abilities.f.id === 'knife' && p.knives < 3) {
    p.knifeRegen += dt;
    if (p.knifeRegen >= CLASSES.spy.abilities.f.recharge) { p.knifeRegen = 0; p.knives++; }
  }
  if (C.abilities.f && C.abilities.f.id === 'mine' && p.mines < 2) {
    p.mineRegen += dt;
    if (p.mineRegen >= CLASSES.sniper.abilities.f.recharge) { p.mineRegen = 0; p.mines++; }
  }
  if (p.overshield > 0 && !active(g, p, 'bulwark') && !active(g, p, 'adrenal')) p.overshield = 0;
  // snipers (and phantoms even more) melt into cover when they stay low and still
  const still = Math.hypot(p.vx || 0, p.vz || 0) < 0.4 && p.crouch;
  p.stillT = still ? (p.stillT || 0) + dt : 0;
}
export const camoFactor = (p) => { const c = classOf(p).camo; return c && p.stillT > 1 ? c : 1; };

// Damage hook: invulnerable rolls and the Soldier's bulwark absorb hits first
export function absorbDamage(g, p, amt) {
  if (g.time < p.invulnUntil) return 0;
  if (p.overshield > 0) { const s = Math.min(p.overshield, amt); p.overshield -= s; amt -= s; }
  return amt;
}

export function cooldownView(g, p) {
  const C = classOf(p);
  const out = {};
  for (const k of ['q', 'f', 'x']) {
    const A = C.abilities[k];
    if (!A) continue;
    let cd = Math.max(0, p.cdk[k] - g.time), max = A.cd || 0;
    if (A.id === 'push' || A.id === 'pull') { cd = Math.max(0, p.cd[A.id] - g.time); max = POWERS[A.id].cooldown; }
    if (A.id === 'suggest') { cd = Math.max(0, (p.cd.suggest || 0) - g.time); max = POWERS.suggest.cooldown; }
    const act = A.dur ? Math.max(0, (p.act[A.id] || 0) - g.time) : 0;
    out[k] = [Math.round(cd * 10) / 10, max, Math.round(act * 10) / 10, A.id === 'knife' ? p.knives : A.id === 'mine' ? p.mines : -1];
  }
  return out;
}

// ------------------------------------------------------------------ Wardens are wanted

export function updateHunters(g, dt) {
  g.hunterT = (g.hunterT ?? 120) - dt;
  // Clear out hunters that lost the trail
  for (const e of g.ents.values()) {
    if (!e.hunter || e.dead) continue;
    const near = g.players().some((p) => dist2(p.x, p.z, e.x, e.z) < 120);
    if (!near && g.time - e.spawnedAt > 60) g.removeEnt(e);
  }
  if (g.hunterT > 0) return;
  g.hunterT = 150 + g.rng() * 90;
  const wardens = g.players().filter((p) => classOf(p).wanted && !p.downed);
  const huntersAlive = [...g.ents.values()].some((e) => e.hunter && !e.dead);
  if (!wardens.length || huntersAlive) return;
  const w = wardens[Math.floor(g.rng() * wardens.length)];
  const town = g.world.regions.town, gar = g.world.regions.garrison;
  const inTown = dist2(w.x, w.z, town.x, town.z) < town.r + 10;
  const inGarrison = w.x > gar.minX - 10 && w.x < gar.maxX + 10 && w.z > gar.minZ - 10 && w.z < gar.maxZ + 10;
  if (inTown || inGarrison) { g.hunterT = 30; return; }
  // find a walkable spot ~70m away, ideally out of sight
  for (let tries = 0; tries < 24; tries++) {
    const a = g.rng() * Math.PI * 2, r = 60 + g.rng() * 25;
    const x = w.x + Math.cos(a) * r, z = w.z + Math.sin(a) * r;
    if (!navWalkable(g.world, x, z)) continue;
    if (dist2(x, z, town.x, town.z) < town.r + 20) continue;
    for (let i = 0; i < 3; i++) {
      const h = spawnGuard(g, { name: 'hunter', tasks: [{ x: 122, z: 0, act: 'look', wait: [3, 5] }] }, { x: x + i * 1.6, z: z + i, alerted: true, lkp: { x: w.x, y: w.y, z: w.z } });
      h.hunter = true; h.spawnedAt = g.time;
      h.ai.target = w.id; h.ai.lastSeen = g.time - 3; h.ai.combatStart = g.time; h.ai.garrison = false;
    }
    g.note(`A Concordance hunter squad has picked up ${w.name}'s trail. Wardens are wanted.`, 'alarm');
    return;
  }
}
