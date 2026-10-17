// Crew classes: loadouts, Q/F/X abilities, and the Warden's "wanted" status.
import { CLASSES, DEFAULT_CLASS, WEAPONS, POWERS, K, STEALTH, ADVANCED, BRANCHES, LEVELS, SLOTS, effectiveClass, levelOf, abilityPool, defaultSlots } from '../config.js';
import { clamp, dist2, yawTo, angleDiff, dirFromYawPitch } from '../math.js';
import { lineOfSight, navWalkable, terrainHeight, groundAt, raycast } from '../world.js';
import { isUnaware, pick, spawnGuard } from './ai.js';
import { powerPush, powerPull, explode } from './combat.js';

export const classOf = (p) => effectiveClass(p.cls, p.adv, p.branch, p.slots);
export const levelOfPlayer = (p) => levelOf(p.xp || 0).lv;

// Abilities this character has unlocked at their level
export function unlockedPool(p) {
  const lv = levelOfPlayer(p);
  return abilityPool(p.cls, p.adv, p.branch).filter((a) => a.lv <= lv);
}

// Keep only abilities that are unlocked, each in one slot; the fourth slot needs an advanced class
export function sanitizeSlots(p, slots) {
  const ok = new Set(unlockedPool(p).map((a) => a.id));
  const out = { q: null, f: null, x: null, z: null }, used = new Set();
  for (const k of SLOTS) {
    const id = slots && typeof slots[k] === 'string' ? slots[k] : null;
    if (!id || !ok.has(id) || used.has(id) || (k === 'z' && !p.adv)) continue;
    out[k] = id; used.add(id);
  }
  return out;
}

// Newly unlocked abilities drop into any empty slot; returns the ones left waiting in the pool
export function fillSlots(p) {
  const used = new Set(Object.values(p.slots).filter(Boolean));
  const waiting = [];
  for (const a of unlockedPool(p)) {
    if (used.has(a.id)) continue;
    const k = SLOTS.find((s) => !p.slots[s] && (s !== 'z' || p.adv));
    if (k) { p.slots[k] = a.id; used.add(a.id); } else waiting.push(a);
  }
  return waiting;
}

export function applyLoadout(p, cls, prof) {
  // a character who took an advanced class is that class for good
  if (prof && prof.locked && CLASSES[prof.locked]) cls = prof.locked;
  if (!CLASSES[cls]) cls = DEFAULT_CLASS;
  p.cls = cls;
  const lv = levelOf(p.xp || 0).lv;
  const adv = prof && prof.advs && prof.advs[cls];
  p.adv = adv && ADVANCED[adv] && ADVANCED[adv].base === cls && lv >= LEVELS.advancedAt ? adv : null;
  p.locked = p.adv ? cls : null;
  const br = prof && prof.branch;
  p.branch = p.adv && br && BRANCHES[br] && BRANCHES[br].adv === p.adv && lv >= LEVELS.branchAt ? br : null;
  p.slots = defaultSlots(cls, p.adv);
  if (prof && prof.slots && prof.cls === cls) p.slots = sanitizeSlots(p, prof.slots);
  fillSlots(p);
  const C = classOf(p);
  p.weapon = C.weapon;
  const same = prof && prof.cls === cls;
  p.grenades = same && prof.grenades != null ? Math.min(C.maxGrenades, prof.grenades) : C.grenades;
  p.medpacks = same && prof.medpacks != null ? Math.min(C.maxMedpacks, prof.medpacks) : C.medpacks;
  p.cdk = {}; // ability id -> ready time, so swapping slots never skips a cooldown
  p.act = {}; // active ability -> expiry time
  p.knives = 3;
  p.knifeRegen = 0;
  p.mines = 2;
  p.mineRegen = 0;
  p.stillT = 0;
  p.overshield = 0;
  p.invulnUntil = 0;
}
export const hasAbility = (p, id) => Object.values(classOf(p).abilities).some((a) => a.id === id);

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
const r2 = (v) => Math.round(v * 100) / 100;
const isFoe = (e) => e.hostile && !e.dead && e.kind !== K.CAMERA;

export function useAbility(g, p, k, m) {
  const C = classOf(p);
  const A = C.abilities[k];
  if (!A || p.downed || p.dead) return;
  const yaw = Number.isFinite(+m.yaw) ? +m.yaw : p.yaw, pitch = Number.isFinite(+m.pitch) ? +m.pitch : p.pitch;
  const ready = () => g.time >= (p.cdk[A.id] || 0);
  // every level shaves a little off ability cooldowns
  const spend = (cd) => { p.cdk[A.id] = g.time + cd * ((C.cdScale && C.cdScale[A.id]) || 1) * (1 - LEVELS.cdPer * (levelOfPlayer(p) - 1)); };
  const dur = () => A.dur * ((C.durScale && C.durScale[A.id]) || 1);
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
      cloakUp(g, p, dur());
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
      const md = A.dur * (C.markScale || 1);
      t.bountyUntil = g.time + md; t.bountyBy = p.id; t.markedUntil = Math.max(t.markedUntil || 0, g.time + md);
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
    // ---- Shieldwall Sentinel
    case 'aegis': {
      if (!ready()) return;
      spend(A.cd);
      let n = 0;
      for (const o of g.players()) {
        if (o.downed || dist2(o.x, o.z, p.x, p.z) > 12) continue;
        o.act.aegis = g.time + 10; o.overshield = Math.max(o.overshield, 45); n++;
      }
      g.event(['abfx', p.id, 'aegis', r2(p.x), r2(p.y), r2(p.z)]);
      g.note(`${p.name} threw an aegis over ${n} of the crew.`, 'info');
      break;
    }
    case 'taunt': {
      if (!ready()) return;
      spend(A.cd);
      p.act.taunt = g.time + A.dur;
      let n = 0;
      for (const e of g.nearby(p.x, p.z, 25)) {
        if (!isFoe(e) || !e.ai || e.ai.state !== 'combat') continue;
        e.ai.target = p.id; e.ai.lkp = { x: p.x, y: p.y, z: p.z }; n++;
      }
      g.event(['abfx', p.id, 'taunt', r2(p.x), r2(p.y), r2(p.z)]);
      g.pnote(p, n ? `${n} ${n === 1 ? 'gun turns' : 'guns turn'} on you. You take less damage for ${A.dur}s.` : 'No one is fighting you yet. You take less damage for a few seconds.', 'info');
      break;
    }
    // ---- Bladedancer
    case 'riposte': if (!ready()) return; spend(A.cd); p.act.riposte = g.time + A.dur; g.event(['abfx', p.id, 'riposte', r2(p.x), r2(p.y), r2(p.z)]); g.pnote(p, 'Riposte: bolts in front of you go straight back', 'stealth'); break;
    case 'whirl': {
      if (!ready()) return;
      spend(A.cd);
      const dmg = 70 * (1 + (C.weaponBonus || 0)) * (p.upgrades.coil ? 1.2 : 1);
      for (const e of g.nearby(p.x, p.z, 4.5)) {
        if (!isFoe(e) && e.kind !== K.CRITTER) continue;
        if (Math.abs(e.y - p.y) > 2.5) continue;
        const dx = e.x - p.x, dz = e.z - p.z, d = Math.hypot(dx, dz) || 1;
        e.vx = dx / d * 6; e.vz = dz / d * 6; e.vy = 3; e.stagger = Math.max(e.stagger || 0, 0.7); e.staggerBy = p.id;
        g.damage(e, dmg, p, { kind: 'blade', x: e.x, y: e.y + 1, z: e.z });
      }
      p.swingCount = (p.swingCount + 1) % 1000;
      g.event(['abfx', p.id, 'whirl', r2(p.x), r2(p.y), r2(p.z)]);
      g.noise(p.x, p.y, p.z, 10, p, false);
      break;
    }
    // ---- Manhunter
    case 'net': {
      if (!ready()) return;
      const t = aimTarget(g, p, yaw, pitch, 40, 0.18, (e) => isFoe(e) || e.kind === K.CRITTER);
      if (!t) { g.pnote(p, 'No one in your sights to net.', 'warn'); return; }
      spend(A.cd);
      t.stagger = Math.max(t.stagger || 0, 3.5); t.staggerBy = p.id; t.vx = t.vz = 0;
      g.event(['beam', p.id, t.id, 'net']);
      break;
    }
    case 'hunt': {
      if (!ready()) return;
      spend(A.cd);
      const f = dirFromYawPitch(yaw, 0);
      const md = A.dur * (C.markScale || 1);
      let n = 0;
      for (const e of g.nearby(p.x, p.z, 45)) {
        if (!isFoe(e)) continue;
        const dx = e.x - p.x, dz = e.z - p.z, d = Math.hypot(dx, dz) || 1;
        if ((dx * f.x + dz * f.z) / d < Math.cos(0.9)) continue;
        e.bountyUntil = g.time + md; e.bountyBy = p.id; e.markedUntil = Math.max(e.markedUntil || 0, g.time + md); n++;
      }
      g.event(['recon', p.id, +yaw.toFixed(2)]);
      g.note(`Open season: ${p.name} put a bounty on ${n} ${n === 1 ? 'target' : 'targets'}.`, n ? 'stealth' : 'info');
      break;
    }
    // ---- Gunfighter
    case 'quickdraw': if (!ready()) return; spend(A.cd); p.act.quickdraw = g.time + A.dur; p.heat = 0; p.overheated = false; g.pnote(p, 'Quickdraw: harder shots, no heat', 'stealth'); g.event(['charge', p.id]); break;
    case 'trickshot': {
      if (!ready()) return;
      const targets = [];
      for (const e of g.nearby(p.x, p.z, 35)) {
        if (!isFoe(e)) continue;
        if (!lineOfSight(g.world, p.x, p.y + 1.5, p.z, e.x, e.y + 1, e.z)) continue;
        targets.push([dist2(p.x, p.z, e.x, e.z), e]);
      }
      if (!targets.length) { g.pnote(p, 'Nobody in view for a trick shot.', 'warn'); return; }
      spend(A.cd);
      targets.sort((a, b) => a[0] - b[0]);
      const W = WEAPONS.pistols;
      for (let i = 0; i < 8; i++) {
        const t = targets[i % Math.min(4, targets.length)][1];
        g.later(i * 0.07, () => {
          if (p.downed || !g.ents.has(p.id)) return;
          if (t.dead) return;
          // fired off to one side so the bolt visibly curves in
          const side = i % 2 ? 1 : -1;
          const ox = p.x + Math.cos(p.yaw) * 0.3 * side, oy = p.y + 1.35, oz = p.z - Math.sin(p.yaw) * 0.3 * side;
          let dx = t.x - ox, dy = t.y + 1.1 - oy, dz = t.z - oz;
          const l = Math.hypot(dx, dz) || 1;
          const fx = dx / l, fz = dz / l;
          dx = fx - fz * 0.03 * side; dz = fz + fx * 0.03 * side;
          const n = Math.hypot(dx, dy / l, dz) || 1;
          const b = g.spawnBolt(p, ox, oy, oz, dx / n, dy / l / n, dz / n, W.boltSpeed * 0.7, W.damage * 1.6 * (1 + (C.weaponBonus || 0)), 'player', 20);
          b.homing = t.id; b.life = 1.5;
        });
      }
      p.swingCount = (p.swingCount + 1) % 1000;
      break;
    }
    // ---- Vanguard
    case 'slam': {
      if (!ready()) return;
      spend(A.cd);
      const f = dirFromYawPitch(yaw, 0);
      p.impulseT = g.time;
      g.impulse(p, f.x * 13, 9, f.z * 13);
      g.event(['jets', p.id]);
      g.later(0.85, () => {
        if (!g.ents.has(p.id) || p.downed) return;
        explode(g, p.x, p.y + 0.3, p.z, 6, 95, p, 'slam', p);
      });
      break;
    }
    case 'barrage': {
      if (!ready()) return;
      const d = dirFromYawPitch(yaw, pitch);
      const hit = raycast(g.world, p.x, p.y + 1.6, p.z, d.x, d.y, d.z, 70, { terrainStep: 1 });
      if (!hit) { g.pnote(p, 'Point at the ground you want hit.', 'warn'); return; }
      spend(A.cd);
      const x = p.x + d.x * hit.t, y = p.y + 1.6 + d.y * hit.t, z = p.z + d.z * hit.t;
      g.event(['abfx', p.id, 'barrage', r2(x), r2(y), r2(z)]);
      g.note(`${p.name} called a barrage. Clear the mark!`, 'warn');
      for (let i = 0; i < 3; i++) {
        g.later(1.2 + i * 0.5, () => {
          const ox = x + (g.rng() - 0.5) * 5, oz = z + (g.rng() - 0.5) * 5;
          explode(g, ox, groundAt(g.world, ox, oz, y + 3) + 0.3, oz, 6, 85, p, 'barrage');
        });
      }
      break;
    }
    // ---- Heavy Gunner
    case 'rail': {
      if (!ready()) return;
      const d = g.validDir(m.d);
      if (!d) return;
      spend(A.cd);
      const o = g.validOrigin(p, m.o, 3);
      const b = g.spawnBolt(p, o[0], o[1], o[2], d[0], d[1], d[2], 220, 160 * (1 + (C.weaponBonus || 0)), 'player', 40, 0, 5);
      b.pierce = 6;
      g.event(['charge', p.id]);
      break;
    }
    case 'turret': {
      if (!ready()) return;
      const f = dirFromYawPitch(yaw, 0);
      const tx = p.x + f.x * 1.8, tz = p.z + f.z * 1.8;
      const ty = groundAt(g.world, tx, tz, p.y + 1.5);
      if (Math.abs(ty - p.y) > 1.5 || !navWalkable(g.world, tx, tz)) { g.pnote(p, 'Find flat ground for the turret.', 'warn'); return; }
      spend(A.cd);
      for (const e of [...g.ents.values()]) if (e.kind === K.TURRET && e.owner === p.id) g.removeEnt(e);
      g.spawn({ kind: K.TURRET, x: tx, y: ty, z: tz, yaw, owner: p.id, until: g.time + A.dur, nextShot: g.time + 0.6, hp: 120, maxHp: 120, r: 0.5, h: 1.2, a1: p.color });
      g.event(['abfx', p.id, 'turret', r2(tx), r2(ty), r2(tz)]);
      break;
    }
    // ---- Field Medic
    case 'field': {
      if (!ready()) return;
      spend(A.cd);
      g.spawn({ kind: K.CLOUD, x: p.x, y: p.y, z: p.z, owner: p.id, until: g.time + A.dur, rad: 9, heal: 9, hp: 1, maxHp: 1, r: 0.1, h: 0.1, a1: 1, a2: 9 });
      g.event(['abfx', p.id, 'field', r2(p.x), r2(p.y), r2(p.z)]);
      break;
    }
    case 'lifeline': {
      if (!ready()) return;
      spend(A.cd);
      let n = 0;
      for (const o of g.players()) {
        if (dist2(o.x, o.z, p.x, p.z) > 20) continue;
        if (o.downed) { g.revive(o, p); o.hp = 40; }
        o.act.lifeline = g.time + A.dur; n++;
      }
      g.event(['abfx', p.id, 'lifeline', r2(p.x), r2(p.y), r2(p.z)]);
      g.note(`${p.name}'s lifeline: ${n} of the crew can't go down for ${A.dur}s.`, 'credits');
      break;
    }
    // ---- Toxicologist
    case 'cloud': {
      if (!ready()) return;
      const d = dirFromYawPitch(yaw, pitch);
      const hit = raycast(g.world, p.x, p.y + 1.5, p.z, d.x, d.y, d.z, 30, { terrainStep: 0.8 });
      const t = hit ? Math.max(1.5, hit.t - 0.5) : 30;
      const x = p.x + d.x * t, z = p.z + d.z * t;
      const y = groundAt(g.world, x, z, p.y + 1.5 + d.y * t + 1);
      spend(A.cd);
      g.spawn({ kind: K.CLOUD, x, y, z, owner: p.id, until: g.time + A.dur, rad: 5.5, dps: 16, hp: 1, maxHp: 1, r: 0.1, h: 0.1, a1: 0, a2: 6 });
      g.event(['abfx', p.id, 'cloud', r2(x), r2(y), r2(z)]);
      break;
    }
    case 'sedate': {
      if (!ready()) return;
      const t = aimTarget(g, p, yaw, pitch, 45, 0.14, (e) => isFoe(e) || e.kind === K.CRITTER);
      if (!t) { g.pnote(p, 'No one in your sights to sedate.', 'warn'); return; }
      spend(A.cd);
      g.event(['beam', p.id, t.id, 'dart']);
      g.later(0.25, () => { if (!t.dead) g.damage(t, 999, p, { kind: 'sedate', silent: true, x: t.x, y: t.y + 1, z: t.z }); });
      break;
    }
    // ---- Infiltrator
    case 'disguise': {
      if (!ready()) return;
      if (g.alarm.active) { g.pnote(p, 'No disguise fools a garrison that is already hunting you.', 'warn'); return; }
      spend(A.cd);
      p.act.disguise = g.time + A.dur;
      g.event(['abfx', p.id, 'disguise', r2(p.x), r2(p.y), r2(p.z)]);
      g.pnote(p, 'Disguised. Guards only look twice if you get close or start shooting.', 'stealth');
      break;
    }
    case 'blackout': {
      if (!ready()) return;
      spend(A.cd);
      let cams = 0, guards = 0;
      for (const e of g.nearby(p.x, p.z, 40)) {
        if (e.dead || !e.ai) continue;
        if (e.kind === K.CAMERA) { e.blindUntil = g.time + A.dur; e.ai.sus = 0; e.ai.tracking = false; cams++; }
        else if (e.hostile && dist2(e.x, e.z, p.x, p.z) < 22 && e.ai.state !== 'combat') { e.ai.sus = 0; e.ai.ignore = { id: p.id, until: g.time + 8 }; guards++; }
      }
      g.event(['abfx', p.id, 'blackout', r2(p.x), r2(p.y), r2(p.z)]);
      g.note(`Blackout: ${cams} ${cams === 1 ? 'camera' : 'cameras'} and ${guards} ${guards === 1 ? 'guard' : 'guards'} blinded.`, 'stealth');
      break;
    }
    // ---- Saboteur
    case 'emp': {
      if (!ready()) return;
      spend(A.cd);
      let n = 0;
      for (const e of g.nearby(p.x, p.z, 25)) {
        if (e.dead) continue;
        if (e.kind === K.CAMERA) { e.blindUntil = g.time + 20; if (e.ai) { e.ai.sus = 0; e.ai.tracking = false; } n++; }
        else if (isFoe(e) && dist2(e.x, e.z, p.x, p.z) < 10) { e.stagger = Math.max(e.stagger || 0, 2.5); e.staggerBy = p.id; n++; }
        else if (e.kind === K.TURRET && e.owner !== p.id) e.until = g.time;
      }
      g.event(['abfx', p.id, 'emp', r2(p.x), r2(p.y), r2(p.z)]);
      g.pnote(p, `EMP hit ${n} ${n === 1 ? 'target' : 'targets'}.`, 'stealth');
      break;
    }
    case 'overload': {
      if (!ready()) return;
      const t = aimTarget(g, p, yaw, pitch, 40, 0.16, (e) => isFoe(e) && e.kind !== K.CAMERA);
      if (!t) { g.pnote(p, 'No trooper in your sights.', 'warn'); return; }
      spend(A.cd);
      g.event(['beam', p.id, t.id, 'overload']);
      g.later(0.6, () => { if (!t.dead) explode(g, t.x, t.y + 1, t.z, 3.5, 130, p, 'overload'); });
      break;
    }
    // ---- Wraith
    case 'blink': {
      if (!ready()) return;
      const f = dirFromYawPitch(yaw, 0);
      let to = null;
      for (const dd of [10, 8.5, 7, 5.5, 4]) {
        const x = p.x + f.x * dd, z = p.z + f.z * dd;
        if (!navWalkable(g.world, x, z)) continue;
        const y = groundAt(g.world, x, z, p.y + 2.5);
        if (Math.abs(y - p.y) > 2.5 || !lineOfSight(g.world, p.x, p.y + 1, p.z, x, y + 1, z)) continue;
        to = { x, y, z }; break;
      }
      if (!to) { g.pnote(p, 'Nowhere to blink to.', 'warn'); return; }
      spend(A.cd);
      const ox = p.x, oz = p.z;
      g.teleport(p, to.x, to.y + 0.02, to.z);
      g.event(['exec', p.id, 0, r2(ox), r2(oz), 0]);
      break;
    }
    case 'veil': {
      if (!ready()) return;
      spend(A.cd);
      let n = 0;
      for (const o of g.players()) { if (o.downed || dist2(o.x, o.z, p.x, p.z) > 12) continue; cloakUp(g, o, A.dur); n++; }
      g.note(`${p.name} veiled ${n} of the crew.`, 'stealth');
      break;
    }
    // ---- Longshot
    case 'ricochet': if (!ready()) return; spend(A.cd); p.act.ricochet = g.time + A.dur; g.pnote(p, 'Ricochet round loaded: your next hit jumps to two more targets', 'stealth'); g.event(['charge', p.id]); break;
    case 'execmark': if (!ready()) return; spend(A.cd); p.act.execmark = g.time + A.dur; g.pnote(p, "Executioner's mark: double damage on anything marked", 'stealth'); g.event(['charge', p.id]); break;
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
  const ids = new Set(Object.values(C.abilities).map((a) => a.id));
  if (ids.has('knife') && p.knives < 3) {
    p.knifeRegen += dt;
    if (p.knifeRegen >= CLASSES.spy.abilities.f.recharge) { p.knifeRegen = 0; p.knives++; }
  }
  if (ids.has('mine') && p.mines < 2) {
    p.mineRegen += dt;
    if (p.mineRegen >= CLASSES.sniper.abilities.f.recharge) { p.mineRegen = 0; p.mines++; }
  }
  if (p.overshield > 0 && !active(g, p, 'bulwark') && !active(g, p, 'adrenal') && !active(g, p, 'aegis')) p.overshield = 0;
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
  for (const k of SLOTS) {
    const A = C.abilities[k];
    if (!A) continue;
    let cd = Math.max(0, (p.cdk[A.id] || 0) - g.time), max = (A.cd || 0) * ((C.cdScale && C.cdScale[A.id]) || 1);
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
