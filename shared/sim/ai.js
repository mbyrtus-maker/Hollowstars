// NPC behaviour: Concordance guards (stealth perception, combat, alarms), townsfolk,
// merchants, the prisoner, and desert wildlife. Everything is always doing something.

import { K, F, STEALTH, WEAPONS } from '../config.js';
import { clamp, angleDiff, yawTo, dist2, lerpAngle, wrapAngle } from '../math.js';
import { findPath, moveBody, lineOfSight, terrainHeight } from '../world.js';

const BARKS = {
  suspicious: ['Hm? Something moved.', 'Who\'s there?', 'Did you hear that?', 'Hold on...', 'Show yourself.'],
  investigate: ['Checking it out.', 'Going to take a look.', 'Probably a skitter. Probably.'],
  calm: ['Must be the wind.', 'Nothing. Back to it.', 'Jumping at shadows again.', 'All clear.'],
  spot: ['Intruder!', 'Contact!', 'There! Open fire!', 'Rebel scum on the line!'],
  alarm: ['Sounding the alarm!', 'Garrison, wake up! We have intruders!', 'Hitting the alarm!'],
  corpse: ['Man down! We have a body!', 'Someone get over here — he\'s dead!'],
  search: ['Spread out, find them.', 'They can\'t have gone far.', 'Check every corner.'],
  lost: ['Lost them.', 'Where did they go?'],
  chat: [
    'Sector chief wants the tithe numbers by dawn.', 'Khet\'s short on its tithe again.', 'Rotation off this rock can\'t come soon enough.',
    'You hear the fleet\'s coming through next cycle?', 'My visor fogs up every time the wind turns.', 'Third double shift this week.',
    'They say Rhal had a whole moon razed for missing payment.', 'Keep your eyes on the ridge. Bandits.',
  ],
  civ: [
    'Tithe collectors come again in three days...', 'They took Ilsa right off the street.', 'Water\'s up to forty a jug now.',
    'Don\'t look at the troopers. Just keep walking.', 'My cousin flies freight out past the Reach.', 'Best stew in Khet, if you like grit.',
    'The garrison lights never go out.', 'If the tithe isn\'t paid, they burn the fields. Every time.',
  ],
  flee: ['Blasters! Run!', 'Get inside!', 'Not again!'],
  pain: ['Agh!', 'I\'m hit!', 'Hnngh!'],
};
export const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];

// ------------------------------------------------------------------ spawning

function mkNPC(game, kind, x, z, extra = {}) {
  const y = extra.y ?? terrainHeight(x, z) + 0.2;
  const e = game.spawn({
    kind, x, y, z, yaw: extra.yaw ?? 0, vx: 0, vy: 0, vz: 0, r: 0.4, h: 1.8, onGround: false,
    hp: extra.hp ?? 60, maxHp: extra.hp ?? 60, flags: 0, a1: 0, a2: 0,
    ai: { state: 'routine', task: 0, wait: 0, path: null, pathT: 0, sus: 0, alert: 0, ...extra.ai },
    ...extra.props,
  });
  return e;
}

const T = (x, z, act = 'look', wait = [1.5, 3.5], face) => ({ x, z, act, wait, face });

export function garrisonRoster(W) {
  const towerYaw = (tx, tz) => yawTo(170, 0, tx, tz);
  const roster = [
    { name: 'gate-l', post: true, tasks: [T(121.6, -4.6, 'scan', [5, 9], Math.PI / 2)] },
    { name: 'gate-r', post: true, tasks: [T(121.6, 4.6, 'scan', [5, 9], Math.PI / 2)] },
    { name: 'court', tasks: [T(135, -12), T(135, 11), T(166, 13.5, 'look', [2, 4]), T(168, -11), T(150, -11, 'scan', [2, 4])] },
    { name: 'inner', tasks: [T(132, -31.6, 'look', [1, 2]), T(170, -31.8, 'look', [1, 2]), T(207.5, -31.6, 'scan', [2, 3]), T(211, -10), T(211, 24, 'look', [1, 2]), T(207, 31.6), T(132, 31.6, 'scan', [2, 3]), T(130.5, 12)] },
    { name: 'outer', tasks: [T(119, -40, 'scan', [2, 4]), T(170, -41), T(221, -40, 'look', [2, 3]), T(221, -20, 'look', [1, 2]), T(221, 40, 'scan', [2, 3]), T(170, 41), T(119, 40)] },
    { name: 'cell', tasks: [T(145, -18.5, 'look', [3, 6]), T(157, -18.5, 'look', [3, 6])] },
    { name: 'mess-a', tasks: [T(171.2, 6, 'talk', [10, 16], Math.PI * 0.5 * -1), T(151, 12.5, 'idle', [3, 5]), T(171.2, 6, 'talk', [10, 16])] },
    { name: 'mess-b', tasks: [T(174.4, 6.3, 'talk', [12, 18], Math.PI / 2), T(166, 18, 'look', [2, 4])] },
    { name: 'depot', tasks: [T(196.5, 10.5, 'work', [3, 6], -Math.PI / 2), T(202, 10.5, 'work', [3, 5]), T(210.5, 10, 'work', [3, 5], Math.PI / 2), T(202, 1.5, 'look', [2, 4])] },
    { name: 'sec', tasks: [T(180.2, 17.8, 'work', [8, 14], -Math.PI / 2), T(175, 19, 'look', [2, 4])] },
    { name: 'courier', tasks: [T(171.2, -21, 'look', [2, 4]), T(151, 12.5, 'idle', [2, 4]), T(168, 8.5, 'look', [1, 2]), T(186, 9, 'work', [3, 5])] },
  ];
  W.towers.forEach((t, i) => roster.push({ name: 'tower' + i, post: true, tower: t, tasks: [T(t.x, t.z, 'scan', [4, 8], towerYaw(t.x, t.z) + Math.PI)] }));
  roster.push({
    name: 'rhal', officer: true,
    tasks: [T(171.5, -19, 'look', [4, 6]), T(190.5, 8.5, 'look', [3, 4]), T(174.6, 8, 'talk', [5, 8]), T(151, -11.4, 'look', [3, 4]), T(130, 0, 'scan', [4, 6]), T(140, 12, 'look', [2, 3])],
  });
  roster.push({ name: 'road-a', road: true, tasks: [T(112, 3, 'scan', [4, 7]), T(48, 14, 'look', [4, 7])] });
  roster.push({ name: 'road-b', road: true, offset: 1.4, tasks: [T(112, 4.6, 'idle', [4, 7]), T(48, 15.6, 'scan', [4, 7])] });
  return roster;
}

export function spawnGuard(game, def, opts = {}) {
  const t0 = def.tasks[0];
  const officer = !!def.officer;
  const y = def.tower ? def.tower.y : undefined;
  const e = mkNPC(game, officer ? K.OFFICER : K.LANCER, opts.x ?? t0.x, opts.z ?? t0.z, {
    y, hp: officer ? 140 : 60, yaw: t0.face ?? 0,
    ai: { tasks: def.tasks, post: !!def.post || !!def.tower, tower: !!def.tower, name: def.name, garrison: !def.road, burst: 0, shotT: 0, strafe: 1, strafeT: 0 },
    props: { hostile: true, officer, hasKeycard: officer },
  });
  if (opts.alerted) {
    e.ai.state = 'combat'; e.ai.alert = 2; e.ai.sus = 1;
    e.ai.lkp = opts.lkp || null;
  }
  return e;
}

export function spawnTown(game) {
  const W = game.world, rng = game.rng;
  const spots = W.civSpots;
  for (let i = 0; i < 11; i++) {
    const s = spots[Math.floor(rng() * spots.length)];
    mkNPC(game, K.CIVILIAN, s.x + (rng() - 0.5) * 2, s.z + (rng() - 0.5) * 2, {
      hp: 40, ai: { home: spots.filter((p) => p.home)[i % 10], wait: rng() * 4 }, props: { variant: Math.floor(rng() * 1000) },
    });
  }
  mkNPC(game, K.MERCHANT, W.pois.teska.x, W.pois.teska.z, { hp: 80, yaw: W.pois.teska.yaw, ai: { baseYaw: W.pois.teska.yaw }, props: { merchant: 'teska', variant: 7 } });
  mkNPC(game, K.MERCHANT, W.pois.bram.x, W.pois.bram.z, { hp: 80, yaw: W.pois.bram.yaw, ai: { baseYaw: W.pois.bram.yaw }, props: { merchant: 'bram', variant: 13 } });
  mkNPC(game, K.INFORMANT, W.pois.informant.x, W.pois.informant.z, { hp: 80, yaw: W.pois.informant.yaw, ai: { baseYaw: W.pois.informant.yaw }, props: { variant: 21 } });
  mkNPC(game, K.BARTENDER, W.pois.bartender.x, W.pois.bartender.z, { hp: 80, yaw: W.pois.bartender.yaw, ai: { baseYaw: W.pois.bartender.yaw, task: 0 }, props: { variant: 33 } });
}

export function spawnWildlife(game) {
  const rng = game.rng;
  const herds = [{ x: -40, z: -50 }, { x: 10, z: 95 }, { x: 100, z: -70 }];
  game.herds = herds.map((h, i) => ({ ...h, tx: h.x, tz: h.z, t: 0, id: i }));
  game.herds.forEach((h) => {
    for (let i = 0; i < 4; i++) {
      mkNPC(game, K.CRITTER, h.x + (rng() - 0.5) * 10, h.z + (rng() - 0.5) * 10, { hp: 30, ai: { herd: h.id, gx: h.x, gz: h.z, wait: rng() * 3 }, props: { r: 0.55, h: 1.0, variant: Math.floor(rng() * 100) } });
    }
  });
}

export function spawnPrisoner(game) {
  const p = game.world.pois.prisoner;
  return mkNPC(game, K.PRISONER, p.x, p.z, { hp: 120, yaw: 0, ai: { state: 'caged' }, props: { variant: 77 } });
}

// ------------------------------------------------------------------ movement helpers

function faceToward(e, yaw, dt, rate = 7) {
  const d = angleDiff(e.yaw, yaw);
  const s = clamp(d, -rate * dt, rate * dt);
  e.yaw = wrapAngle(e.yaw + s);
}

// Path-following steering. Returns true when arrived.
function moveTo(game, e, tx, tz, speed, dt, arrive = 0.6) {
  const ai = e.ai;
  const d = dist2(e.x, e.z, tx, tz);
  if (d < arrive) { brake(game, e, dt); ai.path = null; return true; }
  const needPath = !ai.path || !ai.goal || dist2(ai.goal.x, ai.goal.z, tx, tz) > 1.5 || ai.pathT <= 0 && ai.stuck > 0;
  if (needPath && ai.repathCD <= 0) {
    ai.path = findPath(game.world, e.x, e.z, tx, tz) || [{ x: tx, z: tz }];
    ai.goal = { x: tx, z: tz };
    ai.repathCD = 0.6;
    ai.stuck = 0;
  }
  let wp = ai.path && ai.path[0];
  while (wp && dist2(e.x, e.z, wp.x, wp.z) < 0.55 && ai.path.length > 1) { ai.path.shift(); wp = ai.path[0]; }
  if (!wp) wp = { x: tx, z: tz };
  let dx = wp.x - e.x, dz = wp.z - e.z;
  const l = Math.hypot(dx, dz) || 1;
  dx /= l; dz /= l;
  // separation from neighbours
  let sx = 0, sz = 0;
  for (const o of game.nearby(e.x, e.z, 1.6)) {
    if (o === e || o.dead || o.kind === K.CAMERA || o.kind === K.SPEEDER) continue;
    const ox = e.x - o.x, oz = e.z - o.z, od = Math.hypot(ox, oz);
    if (od > 0.01 && od < 1.2) { sx += (ox / od) * (1.2 - od); sz += (oz / od) * (1.2 - od); }
  }
  const vx = (dx + sx * 0.8) * speed, vz = (dz + sz * 0.8) * speed;
  const a = Math.min(1, dt * 10);
  e.vx += (vx - e.vx) * a; e.vz += (vz - e.vz) * a;
  const px = e.x, pz = e.z;
  moveBody(game.world, e, dt);
  faceToward(e, yawTo(0, 0, e.vx, e.vz), dt, 6);
  // stuck detection
  const prog = dist2(px, pz, e.x, e.z);
  if (prog < speed * dt * 0.25) { ai.stuck = (ai.stuck || 0) + dt; if (ai.stuck > 1.2) { ai.path = null; ai.repathCD = 0; ai.stuck = 0; ai.stuckCount = (ai.stuckCount || 0) + 1; } }
  else ai.stuck = 0;
  e.moving = true;
  return false;
}

function brake(game, e, dt) {
  const a = Math.min(1, dt * 10);
  e.vx -= e.vx * a; e.vz -= e.vz * a;
  moveBody(game.world, e, dt);
  e.moving = false;
}

// ------------------------------------------------------------------ perception

function eye(e) { return e.y + (e.kind === K.CAMERA ? 0 : 1.62); }

function bestStimulus(game, e, isCamera) {
  const ai = e.ai;
  const combat = ai.alert >= 2;
  const heightened = ai.alert >= 1 || game.alarm.active;
  const range = isCamera ? STEALTH.cameraRange : (combat ? STEALTH.alertVisionRange : STEALTH.visionRange * (heightened ? 1.25 : 1)) * (game.alarm.active ? 1.2 : 1);
  const halfA = isCamera ? STEALTH.cameraHalfAngle : (combat ? 1.45 : STEALTH.visionHalfAngle);
  const facing = isCamera ? e.lookYaw : e.yaw;
  let best = null, bestRate = 0;
  for (const p of game.players()) {
    if (p.dead || p.downed) continue;
    if (p.cloaked) continue; // a cloaked player cannot be seen, alarm or not
    if (!isCamera && ai.ignore && ai.ignore.id === p.id && game.time < ai.ignore.until) continue;
    const chest = p.y + (p.crouch ? 0.75 : 1.3);
    const dx = p.x - e.x, dz = p.z - e.z, dy = chest - eye(e);
    const d = Math.hypot(dx, dy, dz);
    if (d > range) continue;
    const ang = Math.abs(angleDiff(facing, yawTo(e.x, e.z, p.x, p.z)));
    // Cameras also have a pitch limit — they look down
    const inCone = ang < halfA;
    const close = !isCamera && d < STEALTH.peripheralRange;
    if (!inCone && !close) continue;
    if (!lineOfSight(game.world, e.x, eye(e), e.z, p.x, chest, p.z)) continue;
    const distF = clamp(1 - d / range, 0, 1);
    let rate = STEALTH.detectRate * p.visibility * (0.22 + distF * 1.5) * (inCone ? 1 : 0.45);
    if (combat) rate *= 6;
    if (isCamera) rate *= 1.15;
    if (p.vehicle) rate *= 2.5;
    if (p.cls === 'warden') rate *= 1.45; // wanted: every Lancer knows a Warden's face
    if (rate > bestRate) { bestRate = rate; best = p; }
  }
  return best ? { p: best, rate: bestRate } : null;
}

function seeCorpse(game, e) {
  for (const c of game.corpses) {
    if (c.discovered) continue;
    const d = dist2(e.x, e.z, c.x, c.z);
    if (d > 24) continue;
    if (Math.abs(angleDiff(e.yaw, yawTo(e.x, e.z, c.x, c.z))) > STEALTH.visionHalfAngle) continue;
    if (!lineOfSight(game.world, e.x, eye(e), e.z, c.x, c.y + 0.4, c.z)) continue;
    return c;
  }
  return null;
}

// ------------------------------------------------------------------ guard behaviour

function enterCombat(game, e, p, bark = true) {
  const ai = e.ai;
  const was = ai.state;
  ai.state = 'combat';
  ai.alert = 2;
  ai.sus = 1;
  ai.target = p ? p.id : ai.target;
  if (p) { ai.lkp = { x: p.x, y: p.y, z: p.z }; ai.lastSeen = game.time; }
  ai.combatStart = game.time;
  if (was !== 'combat') {
    if (bark) game.bark(e, pick(BARKS.spot, game.rng));
    // Start the alarm countdown if the base is still quiet
    if (!game.alarm.active && ai.alarmAt == null) ai.alarmAt = game.time + STEALTH.raiseAlarmDelay * (e.kind === K.OFFICER ? 0.7 : 1);
    // Shout to nearby guards
    for (const o of game.nearby(e.x, e.z, 22)) {
      if (o === e || !o.hostile || o.dead || o.kind === K.CAMERA) continue;
      if (o.ai.state === 'combat') continue;
      if (dist2(e.x, e.z, o.x, o.z) < 12 || lineOfSight(game.world, e.x, e.y + 1.6, e.z, o.x, o.y + 1.6, o.z)) {
        o.ai.pendingAlert = { at: game.time + 0.6 + game.rng() * 0.6, lkp: ai.lkp, target: ai.target };
      }
    }
  }
}

export function guardHearNoise(game, e, x, y, z, radius, loud, source) {
  const ai = e.ai;
  if (e.dead || ai.state === 'combat') return;
  const d = dist2(e.x, e.z, x, z);
  if (d > radius) return;
  if (loud && d < radius * 0.55) {
    // Close gunfire: straight into combat toward the source
    ai.state = 'combat';
    ai.alert = 2; ai.sus = 1;
    ai.lkp = { x, y, z };
    ai.target = source ? source.id : null;
    ai.lastSeen = game.time - 2; // not actually seen
    ai.combatStart = game.time;
    if (!game.alarm.active && ai.alarmAt == null) ai.alarmAt = game.time + STEALTH.raiseAlarmDelay + 1.5;
    game.bark(e, pick(BARKS.spot, game.rng));
    return;
  }
  ai.sus = Math.max(ai.sus, 0.55);
  ai.state = 'investigate';
  ai.alert = Math.max(ai.alert, 1);
  ai.inv = { x: x + (game.rng() - 0.5) * 3, z: z + (game.rng() - 0.5) * 3, t: game.time, look: 1.5 };
  if (game.rng() < 0.7) game.bark(e, pick(BARKS.suspicious, game.rng));
}

function guardShoot(game, e, p, dt) {
  const ai = e.ai;
  ai.shotT -= dt;
  if (ai.shotT > 0) return;
  const W = e.kind === K.OFFICER ? WEAPONS.officerBlaster : WEAPONS.enemyBlaster;
  const ox = e.x - Math.sin(e.yaw) * 0.5 + Math.cos(e.yaw) * 0.25;
  const oz = e.z - Math.cos(e.yaw) * 0.5 - Math.sin(e.yaw) * 0.25;
  const oy = e.y + 1.35;
  const ty = p.y + (p.crouch ? 0.7 : 1.15);
  let dx = p.x - ox, dy = ty - oy, dz = p.z - oz;
  const d = Math.hypot(dx, dy, dz);
  // lead the target a little
  const tFly = d / W.boltSpeed;
  dx += (p.vx || 0) * tFly * 0.6; dz += (p.vz || 0) * tFly * 0.6;
  const l = Math.hypot(dx, dy, dz);
  dx /= l; dy /= l; dz /= l;
  const moveSpd = Math.hypot(p.vx || 0, p.vz || 0);
  let spread = 0.03 + clamp(d / 40, 0, 1) * 0.05 + clamp(moveSpd / 9, 0, 1) * 0.045 + (p.crouch ? -0.01 : 0);
  if (e.kind === K.OFFICER) spread *= 0.65;
  if (ai.tower) spread *= 1.2;
  if (game.time - ai.combatStart < 0.6) spread *= 1.6; // first shots are panicky
  const rx = (game.rng() - 0.5) * 2 * spread, ry = (game.rng() - 0.5) * 2 * spread, rz = (game.rng() - 0.5) * 2 * spread;
  dx += rx; dy += ry; dz += rz;
  const l2 = Math.hypot(dx, dy, dz);
  game.spawnBolt(e, ox, oy, oz, dx / l2, dy / l2, dz / l2, W.boltSpeed, W.damage, 'enemy', W.noise);
  ai.burst = (ai.burst || 0) + 1;
  if (ai.burst >= (e.kind === K.OFFICER ? 4 : 3)) { ai.burst = 0; ai.shotT = 0.9 + game.rng() * 0.9; }
  else ai.shotT = 0.16 + game.rng() * 0.06;
}

function nearestPlayer(game, x, z, maxD = 1e9) {
  let best = null, bd = maxD;
  for (const p of game.players()) {
    if (p.dead || p.downed) continue;
    const d = dist2(x, z, p.x, p.z);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

function updateGuard(game, e, dt) {
  const ai = e.ai;
  ai.repathCD = (ai.repathCD || 0) - dt;
  e.flags = 0;
  if (ai.pendingAlert && game.time >= ai.pendingAlert.at) {
    const pa = ai.pendingAlert; ai.pendingAlert = null;
    if (ai.state !== 'combat') {
      enterCombat(game, e, null, game.rng() < 0.5);
      ai.lkp = pa.lkp; ai.target = pa.target; ai.lastSeen = game.time - 1.5;
    }
  }
  // Raise the alarm if this guard survived the countdown
  if (ai.alarmAt != null && game.time >= ai.alarmAt) {
    ai.alarmAt = null;
    if (!game.alarm.active && ai.state === 'combat' && !e.stagger) {
      game.bark(e, pick(BARKS.alarm, game.rng));
      game.triggerAlarm(ai.garrison ? 'guard' : 'radio');
    }
  }
  // Perception (every tick for nearby players)
  const stim = bestStimulus(game, e, false);
  if (stim) {
    ai.sus = Math.min(1, ai.sus + stim.rate * dt);
    ai.stim = { x: stim.p.x, y: stim.p.y, z: stim.p.z, id: stim.p.id };
    ai.stimT = game.time;
    if (ai.state === 'combat') { ai.lkp = { x: stim.p.x, y: stim.p.y, z: stim.p.z }; ai.lastSeen = game.time; ai.target = stim.p.id; }
    if (ai.state === 'combat' || ai.sus >= 1) game.noteDetection(stim.p);
  } else if (ai.state !== 'combat') {
    ai.sus = Math.max(0, ai.sus - STEALTH.decayRate * dt * (ai.state === 'investigate' ? 0.5 : 1));
  }
  if (ai.state !== 'combat') {
    if (ai.sus >= 1 && stim) { enterCombat(game, e, stim.p); }
    else if (ai.sus >= STEALTH.suspiciousAt && stim && ai.state !== 'suspicious' && ai.state !== 'investigate') {
      ai.state = 'suspicious';
      ai.alert = Math.max(ai.alert, 1);
      ai.susT = 0;
      game.bark(e, pick(BARKS.suspicious, game.rng));
    }
    const c = ai.state !== 'combat' ? seeCorpse(game, e) : null;
    if (c) {
      c.discovered = true;
      game.bark(e, pick(BARKS.corpse, game.rng));
      ai.state = 'combat'; ai.alert = 2; ai.sus = 1; ai.lkp = { x: c.x, y: c.y, z: c.z }; ai.lastSeen = game.time - 2; ai.combatStart = game.time;
      if (!game.alarm.active && ai.alarmAt == null) ai.alarmAt = game.time + STEALTH.corpseAlarmDelay;
    }
  }
  // During a base-wide alarm everyone hunts
  const L = game.alarm.lkp;
  if (game.alarm.active && ai.garrison && L && (ai.state === 'routine' || ai.state === 'suspicious') && !ai.post) {
    ai.state = 'search'; ai.alert = 2;
    ai.search = { x: L.x + (game.rng() - 0.5) * 24, z: L.z + (game.rng() - 0.5) * 24, until: game.time + 14 + game.rng() * 8 };
  }

  const walk = 1.9, run = 5.2;
  switch (ai.state) {
    case 'routine': routine(game, e, dt, walk); break;
    case 'suspicious': {
      brake(game, e, dt);
      if (ai.stim) faceToward(e, yawTo(e.x, e.z, ai.stim.x, ai.stim.z), dt, 4);
      ai.susT += dt;
      if (ai.sus < 0.12) { ai.state = 'routine'; game.bark(e, pick(BARKS.calm, game.rng)); ai.alert = 1; ai.calmAt = game.time; }
      else if (ai.susT > 1.8 && ai.stim && !ai.post) {
        ai.state = 'investigate';
        ai.inv = { x: ai.stim.x, z: ai.stim.z, t: game.time, look: 2 };
        game.bark(e, pick(BARKS.investigate, game.rng));
      }
      break;
    }
    case 'investigate': {
      const inv = ai.inv;
      if (!inv) { ai.state = 'routine'; break; }
      if (ai.post) { brake(game, e, dt); faceToward(e, yawTo(e.x, e.z, inv.x, inv.z), dt, 4); if (game.time - inv.t > 6) { ai.state = 'routine'; } break; }
      const arrived = moveTo(game, e, inv.x, inv.z, walk * 1.25, dt, 1.2);
      if (arrived || (ai.stuckCount || 0) > 3) {
        inv.look -= dt;
        e.ai.scanT = (e.ai.scanT || 0) + dt;
        e.yaw = wrapAngle(e.yaw + Math.sin(e.ai.scanT * 1.6) * dt * 1.6);
        if (inv.look <= -4) { ai.state = 'routine'; ai.stuckCount = 0; if (ai.sus < 0.4) game.bark(e, pick(BARKS.calm, game.rng)); }
      }
      if (game.time - inv.t > 30) ai.state = 'routine';
      break;
    }
    case 'combat': combat(game, e, dt, run); break;
    case 'search': {
      const s = ai.search;
      if (!s || game.time > s.until) {
        ai.state = 'routine'; ai.alert = 1; ai.sus = 0.2;
        if (!game.alarm.active) game.bark(e, pick(BARKS.lost, game.rng));
        break;
      }
      if (ai.post) { brake(game, e, dt); e.yaw = wrapAngle(e.yaw + dt * 0.9); break; }
      if (!s.pt || moveTo(game, e, s.pt.x, s.pt.z, walk * 1.5, dt, 1.0) || (ai.stuckCount || 0) > 2) {
        s.pause = (s.pause || 0) - dt;
        if (s.pause <= 0) {
          s.pt = { x: s.x + (game.rng() - 0.5) * 18, z: s.z + (game.rng() - 0.5) * 18 };
          s.pause = 1.5 + game.rng() * 2;
          ai.stuckCount = 0;
        }
      }
      break;
    }
  }
  if (ai.state === 'combat') e.flags |= F.ALERT | F.AIM;
  e.a1 = Math.round(ai.sus * 100);
  e.a2 = (ai.state === 'combat' ? 2 : ai.state === 'routine' ? 0 : 1);
}

function routine(game, e, dt, speed) {
  const ai = e.ai;
  const tasks = ai.tasks;
  if (!tasks || !tasks.length) { brake(game, e, dt); return; }
  const t = tasks[ai.task % tasks.length];
  if (ai.tower) {
    // Tower guards stay put and sweep the horizon
    e.vx = e.vz = 0;
    moveBody(game.world, e, dt);
    ai.scanT = (ai.scanT || 0) + dt;
    const base = t.face ?? e.yaw;
    e.yaw = wrapAngle(base + Math.sin(ai.scanT * 0.35) * 1.3);
    return;
  }
  if (ai.wait > 0) {
    ai.wait -= dt;
    brake(game, e, dt);
    if (t.act === 'scan') { ai.scanT = (ai.scanT || 0) + dt; e.yaw = wrapAngle((t.face ?? e.yaw) + Math.sin(ai.scanT * 0.7) * 0.9); }
    else if (t.face != null) faceToward(e, t.face, dt, 3);
    if (t.act === 'talk') e.flags |= F.TALK;
    if (t.act === 'work') e.flags |= F.WORK;
    if (t.act === 'talk' && game.rng() < dt * 0.06) game.bark(e, pick(BARKS.chat, game.rng));
    if (ai.wait <= 0) { ai.task = (ai.task + 1) % tasks.length; ai.stuckCount = 0; }
    return;
  }
  if (moveTo(game, e, t.x, t.z, speed, dt, 0.7) || (ai.stuckCount || 0) > 4) {
    ai.wait = t.wait[0] + game.rng() * (t.wait[1] - t.wait[0]);
    ai.stuckCount = 0;
    if (ai.calmAt && game.time - ai.calmAt > 30) ai.alert = 0;
  }
}

function combat(game, e, dt, run) {
  const ai = e.ai;
  let p = game.ents.get(ai.target);
  if (p && (p.dead || p.downed || p.kind !== K.PLAYER)) p = null;
  const sees = p && game.time - ai.lastSeen < 0.25;
  if (sees) {
    faceToward(e, yawTo(e.x, e.z, p.x, p.z), dt, 9);
    const d = dist2(e.x, e.z, p.x, p.z);
    if (!ai.tower && !ai.post) {
      ai.strafeT -= dt;
      if (ai.strafeT <= 0) { ai.strafe = game.rng() < 0.5 ? -1 : 1; ai.strafeT = 1.2 + game.rng() * 2; if (game.rng() < 0.3) ai.strafe = 0; }
      const fx = Math.sin(-e.yaw) , fz = -Math.cos(e.yaw);
      let mvx = 0, mvz = 0;
      if (d > 20) { mvx += fx; mvz += fz; } else if (d < 7) { mvx -= fx; mvz -= fz; }
      mvx += -fz * ai.strafe * 0.7; mvz += fx * ai.strafe * 0.7;
      const l = Math.hypot(mvx, mvz);
      const spd = run * 0.55;
      const tvx = l > 0.01 ? (mvx / l) * spd : 0, tvz = l > 0.01 ? (mvz / l) * spd : 0;
      const a = Math.min(1, dt * 6);
      e.vx += (tvx - e.vx) * a; e.vz += (tvz - e.vz) * a;
      moveBody(game.world, e, dt);
      if (e.hitWall) ai.strafe = -ai.strafe;
      e.moving = l > 0.01;
    } else { e.vx = e.vz = 0; moveBody(game.world, e, dt); }
    if (game.time - ai.combatStart > 0.35) guardShoot(game, e, p, dt);
    return;
  }
  // No sight: chase last known position
  const lkp = ai.lkp;
  if (!lkp) { ai.state = 'search'; ai.search = { x: e.x, z: e.z, until: game.time + 10 }; return; }
  if (ai.tower || ai.post) {
    brake(game, e, dt);
    faceToward(e, yawTo(e.x, e.z, lkp.x, lkp.z), dt, 3);
    if (game.time - ai.lastSeen > 12 && !game.alarm.active) { ai.state = 'routine'; ai.alert = 1; ai.calmAt = game.time; }
    return;
  }
  const arrived = moveTo(game, e, lkp.x, lkp.z, run, dt, 2.0);
  if (arrived || (ai.stuckCount || 0) > 3 || game.time - ai.lastSeen > 14) {
    ai.state = 'search';
    ai.stuckCount = 0;
    ai.search = { x: lkp.x, z: lkp.z, until: game.time + (game.alarm.active ? 20 : 14) };
    game.bark(e, pick(BARKS.search, game.rng));
  }
}

// ------------------------------------------------------------------ cameras

export function updateCamera(game, e, dt) {
  if (e.dead) return;
  const ai = e.ai;
  const off = !game.camerasOn;
  e.flags = off ? F.OFF : 0;
  e.lookYaw = ai.baseYaw + Math.sin(game.time * ai.speed + ai.phase) * ai.sweep;
  if (ai.tracking && game.time - ai.trackT < 1.5) e.lookYaw = ai.trackYaw;
  e.yaw = e.lookYaw;
  if (off) { ai.sus = 0; e.a1 = 0; return; }
  const stim = bestStimulus(game, e, true);
  if (stim) {
    ai.sus = Math.min(1, ai.sus + stim.rate * dt);
    ai.tracking = true; ai.trackT = game.time; ai.trackYaw = yawTo(e.x, e.z, stim.p.x, stim.p.z);
    if (ai.sus >= 0.6) game.noteDetection(stim.p);
    if (ai.sus >= 1 && !game.alarm.active) {
      game.bark(e, 'INTRUDER DETECTED.');
      game.triggerAlarm('camera');
      game.broadcastAlert(stim.p);
    }
  } else {
    ai.sus = Math.max(0, ai.sus - 0.25 * dt);
    if (game.time - (ai.trackT || 0) > 1.5) ai.tracking = false;
  }
  e.a1 = Math.round(ai.sus * 100);
}

// ------------------------------------------------------------------ civilians & friends

function updateCivilian(game, e, dt) {
  const ai = e.ai, W = game.world;
  ai.repathCD = (ai.repathCD || 0) - dt;
  e.flags = 0;
  if (ai.fleeUntil && game.time < ai.fleeUntil) {
    e.flags |= F.FLEE;
    const home = ai.home || W.civSpots[0];
    if (moveTo(game, e, home.x, home.z, 5.2, dt, 1.0)) e.flags |= F.CROUCH;
    return;
  }
  if (ai.wait > 0) {
    ai.wait -= dt;
    brake(game, e, dt);
    if (ai.act === 'talk') e.flags |= F.TALK;
    if (ai.act === 'sit') e.flags |= F.CROUCH;
    if (ai.act === 'work') e.flags |= F.WORK;
    if (ai.faceYaw != null) faceToward(e, ai.faceYaw, dt, 3);
    // occasionally chatter when a player is close
    if (game.rng() < dt * 0.04) {
      const np = nearestPlayer(game, e.x, e.z, 6);
      if (np) game.bark(e, pick(BARKS.civ, game.rng));
    }
    return;
  }
  if (!ai.dest) {
    const spots = W.civSpots;
    const s = spots[Math.floor(game.rng() * spots.length)];
    ai.dest = { x: s.x + (game.rng() - 0.5) * 1.2, z: s.z + (game.rng() - 0.5) * 1.2, act: s.act };
  }
  if (moveTo(game, e, ai.dest.x, ai.dest.z, 1.55 + (e.variant % 5) * 0.08, dt, 0.7) || (ai.stuckCount || 0) > 3) {
    ai.wait = 5 + game.rng() * 11;
    ai.act = ai.dest.act;
    ai.stuckCount = 0;
    // Talkers face a nearby neighbour
    ai.faceYaw = null;
    if (ai.act === 'talk') {
      for (const o of game.nearby(e.x, e.z, 3.5)) if (o !== e && o.kind === K.CIVILIAN) { ai.faceYaw = yawTo(e.x, e.z, o.x, o.z); break; }
    }
    ai.dest = null;
  }
}

export function civilianScare(game, e, x, z) {
  if (e.dead) return;
  const ai = e.ai;
  if (!ai.fleeUntil || game.time > ai.fleeUntil) game.bark(e, pick(BARKS.flee, game.rng));
  ai.fleeUntil = game.time + 18 + game.rng() * 8;
  ai.wait = 0; ai.dest = null; ai.path = null;
}

function updateStationary(game, e, dt) {
  const ai = e.ai;
  e.flags = 0;
  const np = nearestPlayer(game, e.x, e.z, 7);
  if (np) {
    faceToward(e, yawTo(e.x, e.z, np.x, np.z), dt, 3);
    if (!ai.greeted || game.time - ai.greeted > 60) {
      ai.greeted = game.time;
      if (e.kind === K.MERCHANT) game.bark(e, game.merchantGreet(e));
      else if (e.kind === K.INFORMANT) game.bark(e, 'Over here. Quietly.');
    }
    e.flags |= F.TALK;
  } else {
    faceToward(e, ai.baseYaw, dt, 2);
    ai.idleT = (ai.idleT || 0) + dt;
    if (Math.sin(ai.idleT * 0.4 + e.id) > 0.3) e.flags |= F.WORK;
  }
  if (e.kind === K.INFORMANT) e.flags |= F.CROUCH; // sitting
  e.vx = e.vz = 0;
  moveBody(game.world, e, dt);
}

function updateBartender(game, e, dt) {
  const ai = e.ai;
  ai.repathCD = (ai.repathCD || 0) - dt;
  e.flags = F.WORK;
  const spots = [{ x: -196.8, z: 27.5 }, { x: -196.8, z: 31 }, { x: -196.8, z: 34.5 }];
  if (ai.wait > 0) { ai.wait -= dt; brake(game, e, dt); faceToward(e, -Math.PI / 2, dt, 3); return; }
  e.flags = 0;
  const s = spots[ai.task % spots.length];
  if (moveTo(game, e, s.x, s.z, 1.3, dt, 0.4) || (ai.stuckCount || 0) > 2) { ai.wait = 4 + game.rng() * 6; ai.task = (ai.task + 1 + Math.floor(game.rng() * 2)) % spots.length; ai.stuckCount = 0; }
}

function updatePrisoner(game, e, dt) {
  const ai = e.ai;
  ai.repathCD = (ai.repathCD || 0) - dt;
  e.flags = 0;
  if (ai.state === 'caged') {
    e.flags |= F.CROUCH;
    brake(game, e, dt);
    const np = nearestPlayer(game, e.x, e.z, 6);
    if (np) { faceToward(e, yawTo(e.x, e.z, np.x, np.z), dt, 2); if (game.rng() < dt * 0.2) game.bark(e, 'Get me out of here!'); }
    return;
  }
  // Follow the nearest player at a respectful distance
  const leader = nearestPlayer(game, e.x, e.z, 45);
  if (!leader) {
    e.flags |= F.CROUCH; brake(game, e, dt);
    if (game.rng() < dt * 0.1) game.bark(e, 'Don\'t leave me here!');
    return;
  }
  const d = dist2(e.x, e.z, leader.x, leader.z);
  const danger = game.alarm.active;
  if (d > 3.2) {
    moveTo(game, e, leader.x, leader.z, d > 9 ? 6.4 : danger ? 4.6 : 3.4, dt, 2.6);
    if (danger || leader.crouch) e.flags |= F.CROUCH;
  } else {
    brake(game, e, dt);
    if (leader.crouch || danger) e.flags |= F.CROUCH;
    faceToward(e, yawTo(e.x, e.z, leader.x, leader.z), dt, 3);
  }
}

function updateCritter(game, e, dt) {
  const ai = e.ai;
  const herd = game.herds[ai.herd];
  e.flags = 0;
  // Flee from nearby players
  let threat = null;
  for (const p of game.players()) {
    if (p.dead) continue;
    const d = dist2(e.x, e.z, p.x, p.z);
    const r = p.crouch ? 5 : p.vehicle ? 18 : 10;
    if (d < r) { threat = p; break; }
  }
  if (threat || (ai.fleeUntil && game.time < ai.fleeUntil)) {
    if (threat) { ai.fx = e.x - threat.x; ai.fz = e.z - threat.z; ai.fleeUntil = Math.max(ai.fleeUntil || 0, game.time + 2.5); }
    const l = Math.hypot(ai.fx || 1, ai.fz || 0);
    const tvx = ((ai.fx || 1) / l) * 10, tvz = ((ai.fz || 0) / l) * 10;
    e.vx += (tvx - e.vx) * Math.min(1, dt * 5); e.vz += (tvz - e.vz) * Math.min(1, dt * 5);
    if (e.onGround && game.rng() < dt * 3) e.vy = 3.2; // bounding hops
    moveBody(game.world, e, dt);
    faceToward(e, yawTo(0, 0, e.vx, e.vz), dt, 8);
    e.flags |= F.FLEE;
    e.moving = true;
    return;
  }
  if (ai.wait > 0) {
    ai.wait -= dt;
    e.vx *= 0.85; e.vz *= 0.85;
    moveBody(game.world, e, dt);
    e.flags |= F.WORK; // grazing
    e.moving = false;
    return;
  }
  const tx = herd.x + (Math.sin(e.id * 1.7) * 5), tz = herd.z + (Math.cos(e.id * 2.3) * 5);
  const d = dist2(e.x, e.z, tx, tz);
  if (d < 1.2) { ai.wait = 2 + game.rng() * 6; return; }
  const sp = 2.2;
  const tvx = ((tx - e.x) / d) * sp, tvz = ((tz - e.z) / d) * sp;
  e.vx += (tvx - e.vx) * Math.min(1, dt * 3); e.vz += (tvz - e.vz) * Math.min(1, dt * 3);
  moveBody(game.world, e, dt);
  if (e.hitWall) { ai.wait = 1; }
  faceToward(e, yawTo(0, 0, e.vx, e.vz), dt, 4);
  e.moving = true;
}

export function updateHerds(game, dt) {
  for (const h of game.herds) {
    h.t -= dt;
    if (h.t <= 0) {
      h.t = 12 + game.rng() * 18;
      h.tx = clamp(h.x + (game.rng() - 0.5) * 60, -120, 110);
      h.tz = clamp(h.z + (game.rng() - 0.5) * 60, -130, 130);
      // keep herds out of the garrison and town
      if (h.tx > 100) h.tx = 95;
      if (h.tx < -100 && Math.abs(h.tz - 40) < 80) h.tx = -95;
    }
    const d = dist2(h.x, h.z, h.tx, h.tz);
    if (d > 0.5) { h.x += ((h.tx - h.x) / d) * 1.2 * dt; h.z += ((h.tz - h.z) / d) * 1.2 * dt; }
  }
}

// ------------------------------------------------------------------ dispatcher

export function updateNPC(game, e, dt) {
  if (e.dead) return;
  if (e.stagger > 0) {
    e.stagger -= dt;
    const f = e.onGround ? Math.min(1, dt * 4) : 0;
    e.vx -= e.vx * f; e.vz -= e.vz * f;
    const sp = Math.hypot(e.vx, e.vz);
    moveBody(game.world, e, dt);
    if (e.hitWall && sp > 7) game.damage(e, 25 + sp * 1.5, e.staggerBy, { kind: 'impact' });
    e.flags = F.STAGGER | (e.flags & F.ALERT);
    if (e.hostile && e.ai.state !== 'combat' && e.stagger <= 0) enterCombat(game, e, game.ents.get(e.staggerBy) || null);
    return;
  }
  switch (e.kind) {
    case K.LANCER: case K.OFFICER: updateGuard(game, e, dt); break;
    case K.CAMERA: updateCamera(game, e, dt); break;
    case K.CIVILIAN: updateCivilian(game, e, dt); break;
    case K.MERCHANT: case K.INFORMANT: updateStationary(game, e, dt); break;
    case K.BARTENDER: updateBartender(game, e, dt); break;
    case K.PRISONER: updatePrisoner(game, e, dt); break;
    case K.CRITTER: updateCritter(game, e, dt); break;
  }
}

export function guardOnDamaged(game, e, src) {
  if (!e.hostile || e.dead) return;
  if (game.rng() < 0.35) game.bark(e, pick(BARKS.pain, game.rng));
  const p = src && src.kind === K.PLAYER ? src : null;
  if (e.ai.state !== 'combat') enterCombat(game, e, p, true);
  if (p) { e.ai.lkp = { x: p.x, y: p.y, z: p.z }; e.ai.target = p.id; e.ai.lastSeen = game.time - 0.2; }
}

export function alertGuardTo(game, e, p) {
  if (e.dead || !e.hostile) return;
  enterCombat(game, e, null, false);
  e.ai.lkp = { x: p.x, y: p.y, z: p.z };
  e.ai.target = p.id;
  e.ai.lastSeen = game.time - 2;
}

export function isUnaware(e) {
  return e.hostile && !e.dead && e.ai.state !== 'combat' && e.ai.sus < 0.6;
}
