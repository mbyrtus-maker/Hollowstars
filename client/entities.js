// Snapshot interpolation and rendering of every networked entity.
import * as THREE from 'three';
import { K, F, PLAYER_COLORS, BLADE_COLORS } from '../shared/config.js';
import { lerp, lerpAngle, clamp } from '../shared/math.js';
import { Critter, makeSpeeder, makeSecCam, makeGrenade, makePickup } from './render/models.js';
import { Humanoid } from './render/humanoid.js';

const HUMAN = { [K.PLAYER]: 'player', [K.LANCER]: 'lancer', [K.OFFICER]: 'officer', [K.CIVILIAN]: 'civilian', [K.MERCHANT]: 'merchant', [K.INFORMANT]: 'informant', [K.PRISONER]: 'prisoner', [K.BARTENDER]: 'bartender' };
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();

export class Entities {
  constructor(scene, fx, audio) {
    this.scene = scene;
    this.fx = fx;
    this.audio = audio;
    this.views = new Map();
    this.roster = new Map(); // player id -> {name, color}
    this.myId = 0;
  }

  setRoster(party) {
    for (const [id, name, color, hp, down, cr, cls] of party) this.roster.set(id, { name, color, hp, down, cls });
  }

  onSnapshot(tm, ents) {
    const seen = new Set();
    for (const a of ents) {
      const [id, kind, x, y, z, yaw, flags, hp, a1, a2] = a;
      seen.add(id);
      let v = this.views.get(id);
      if (!v) {
        if (kind === K.PLAYER && !this.roster.has(id) && id !== this.myId) continue;
        v = this.create(id, kind, a1);
        if (!v) continue;
        this.views.set(id, v);
      }
      v.buf.push({ t: tm, x, y, z, yaw, flags, hp, a1, a2 });
      if (v.buf.length > 8) v.buf.shift();
      v.flags = flags; v.hp = hp; v.a1 = a1; v.a2 = a2;
    }
    for (const [id, v] of this.views) if (!seen.has(id)) this.destroy(v);
  }

  create(id, kind, a1) {
    let model, human = null, critter = null;
    if (HUMAN[kind]) {
      const opts = { variant: kind === K.PLAYER ? id : a1 || id };
      if (kind === K.PLAYER) {
        const r = this.roster.get(id);
        const c = r ? r.color : 0;
        opts.color = PLAYER_COLORS[c]; opts.bladeColor = BLADE_COLORS[c]; opts.colorIdx = c; opts.cls = r ? r.cls : 'soldier';
      }
      human = new Humanoid(HUMAN[kind], opts);
      model = human.root;
    } else if (kind === K.CRITTER) { critter = new Critter(a1 || id); model = critter.root; }
    else if (kind === K.SPEEDER) model = makeSpeeder();
    else if (kind === K.CAMERA) model = makeSecCam();
    else if (kind === K.GRENADE) model = makeGrenade();
    else if (kind === K.PICKUP) model = makePickup(a1);
    else return null;
    this.scene.add(model);
    return { id, kind, model, human, critter, buf: [], x: 0, y: 0, z: 0, yaw: 0, speed: 0, flags: 0, hp: 100, a1: 0, a2: 0, bubble: null, bubbleT: 0, lastSwingSeen: null };
  }

  destroy(v) {
    this.scene.remove(v.model);
    this.views.delete(v.id);
  }
  clear() { for (const v of [...this.views.values()]) this.destroy(v); }

  sample(v, rt) {
    const b = v.buf;
    if (!b.length) return null;
    if (rt <= b[0].t) return b[0];
    for (let i = b.length - 1; i > 0; i--) {
      const s0 = b[i - 1], s1 = b[i];
      if (rt >= s0.t && rt <= s1.t) {
        const f = (rt - s0.t) / Math.max(1e-4, s1.t - s0.t);
        return { x: lerp(s0.x, s1.x, f), y: lerp(s0.y, s1.y, f), z: lerp(s0.z, s1.z, f), yaw: lerpAngle(s0.yaw, s1.yaw, f), flags: s1.flags, a1: s1.a1, a2: lerp(s0.a2, s1.a2, f) };
      }
    }
    // beyond newest: extrapolate briefly
    const s1 = b[b.length - 1], s0 = b[b.length - 2] || s1;
    const dt = Math.min(0.15, rt - s1.t);
    const span = Math.max(1e-3, s1.t - s0.t);
    return { x: s1.x + (s1.x - s0.x) / span * dt, y: s1.y + (s1.y - s0.y) / span * dt * 0.5, z: s1.z + (s1.z - s0.z) / span * dt, yaw: s1.yaw, flags: s1.flags, a1: s1.a1, a2: s1.a2 };
  }

  get(id) { return this.views.get(id); }

  update(rt, dt, t, local, cam) {
    for (const v of this.views.values()) {
      let s;
      const isMe = local && v.id === local.id;
      if (isMe) s = local.state;
      else if (local && local.vehicleId && v.id === local.vehicleId) s = local.vehicleState;
      else s = this.sample(v, rt);
      if (!s) continue;
      const px = v.x, pz = v.z;
      v.x = s.x; v.y = s.y; v.z = s.z; v.yaw = s.yaw;
      const inst = dt > 0 ? Math.hypot(v.x - px, v.z - pz) / dt : 0;
      v.speed = lerp(v.speed, Math.min(inst, 60), Math.min(1, dt * 10));
      const fl = s.flags ?? v.flags;
      const m = v.model;
      const cd = cam ? Math.hypot(v.x - cam.position.x, v.z - cam.position.z) : 0;
      m.visible = cd < 190 && !(v.flags & F.ABOARD);
      if (!m.visible) continue;
      const far = cd > 45;
      if (far !== v.far) { v.far = far; m.traverse((o) => { if (o.isMesh && o.material.blending !== THREE.AdditiveBlending) o.castShadow = !far; }); }
      m.position.set(v.x, v.y, v.z);
      m.rotation.y = v.yaw;
      if (v.human) this.animateHuman(v, s, fl, dt, t, isMe, local);
      else if (v.critter) v.critter.update(dt, { speed: v.speed, dead: !!(fl & F.DEAD), work: !!(fl & F.WORK), flee: !!(fl & F.FLEE) }, t);
      else if (v.kind === K.SPEEDER) this.animateSpeeder(v, dt, t);
      else if (v.kind === K.CAMERA) this.animateCam(v, fl, t);
      else if (v.kind === K.GRENADE) { m.userData.light.visible = Math.sin(t * 22) > 0; m.rotation.x += dt * 9; }
      else if (v.kind === K.PICKUP) { m.position.y = v.y + 0.25 + Math.sin(t * 3) * 0.08; m.rotation.y = t * 1.5; }
      if (v.bubbleT > 0) v.bubbleT -= dt;
    }
  }

  animateHuman(v, s, fl, dt, t, isMe, local) {
    const h = v.human;
    const kind = v.kind;
    const guard = kind === K.LANCER || kind === K.OFFICER;
    let weapon = null;
    if (kind === K.PLAYER) weapon = h.weaponKind;
    else if (guard) weapon = 'blaster';
    let speed = v.speed;
    if (isMe) speed = local.speed;
    const driving = !!(fl & F.DRIVING);
    if (driving) {
      // ride on the speeder: find it under us
      v.model.position.y = v.y + 0.18;
    }
    h.setShroud(!!(fl & F.SHROUD), isMe ? 0.22 : h.cls === 'spy' ? 0.04 : 0.16);
    if (kind === K.PLAYER) {
      const on = !!(fl & F.SHIELD);
      if (on && !v.bubble3d) {
        v.bubble3d = new THREE.Mesh(new THREE.SphereGeometry(1.15, 20, 14), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb04a).multiplyScalar(1.2), transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
        v.bubble3d.position.y = 1;
        v.model.add(v.bubble3d);
      }
      if (v.bubble3d) { v.bubble3d.visible = on; v.bubble3d.material.opacity = 0.09 + Math.sin(t * 6) * 0.03; }
    }
    h.update(dt, {
      speed, crouch: !!(fl & F.CROUCH) && kind !== K.INFORMANT, sit: kind === K.INFORMANT || (kind === K.CIVILIAN && (fl & F.CROUCH) && !(fl & F.FLEE)), cower: kind === K.PRISONER && (fl & F.CROUCH) && speed < 0.3,
      pitch: kind === K.PLAYER ? (isMe ? local.pitch : (s.a2 || 0) / 100) : 0,
      weapon, drawn: kind === K.PLAYER ? !!(fl & F.DRAWN) : undefined, block: !!(fl & F.BLOCK), swing: kind === K.PLAYER ? (isMe ? local.swingCount : s.a1) : undefined,
      downed: !!(fl & F.DOWNED), dead: !!(fl & F.DEAD), driving, talk: !!(fl & F.TALK), work: !!(fl & F.WORK),
      flee: !!(fl & F.FLEE), stagger: !!(fl & F.STAGGER), air: kind === K.PLAYER && !!(fl & F.AIR) && !driving,
      aim: guard ? !!(fl & F.ALERT) : isMe ? local.aiming : true, lowReady: guard && !(fl & F.ALERT),
    }, t + v.id);
    if (kind === K.INFORMANT) v.model.position.y = v.y - 0.05;
    // footsteps: one per stride half-cycle while walking on the ground
    const step = Math.floor(h.phase / Math.PI);
    if (step !== v.lastStep) {
      v.lastStep = step;
      const grounded = !(fl & (F.DEAD | F.DOWNED | F.DRIVING | F.AIR));
      const L = this.audio.listener;
      if (grounded && speed > 0.6 && Math.hypot(v.x - L.x, v.z - L.z) < 24) {
        const gr = this.hardRegion;
        const hard = !!gr && v.x > gr.minX - 1 && v.x < gr.maxX + 1 && v.z > gr.minZ - 1 && v.z < gr.maxZ + 1;
        const crouched = !!(fl & F.CROUCH);
        const loud = crouched ? 0.1 : speed > 7 ? 1 : speed > 3.5 ? 0.6 : 0.4;
        this.audio.footstep(v.x, v.y, v.z, hard, isMe ? loud : loud * 0.8);
      }
    }
    // Blade fx
    if (weapon === 'knives' && h.swingT < 0.02 && v.lastSwingSeen !== h.lastSwing) { v.lastSwingSeen = h.lastSwing; this.audio.slash(v.x, v.y + 1, v.z); }
    if (weapon === 'blade' && !(fl & (F.DEAD | F.DOWNED)) && !driving) {
      if (h.bladeWorld(tmpA, tmpB)) {
        if (h.swingT < 0.45 || (fl & F.BLOCK && v.speed > 0.1)) this.fx.bladeTrail(v.id, tmpA, tmpB, BLADE_COLORS[this.roster.get(v.id)?.color || 0]);
        if (h.swingT < 0.02 && v.lastSwingSeen !== h.lastSwing) { v.lastSwingSeen = h.lastSwing; this.audio.swing(v.x, v.y + 1, v.z); }
      }
    }
    if (isMe) v.model.visible = !local.firstPerson || !!(fl & (F.DOWNED | F.DRIVING));
  }

  animateSpeeder(v, dt, t) {
    const body = v.model.userData.body;
    const prevYaw = v.prevYaw ?? v.yaw;
    const yawRate = (v.yaw - prevYaw) / Math.max(dt, 1e-3);
    v.prevYaw = v.yaw;
    v.bank = lerp(v.bank || 0, clamp(-yawRate * 0.18, -0.5, 0.5), Math.min(1, dt * 6));
    body.rotation.z = v.bank;
    body.position.y = Math.sin(t * 2.3 + v.id) * 0.04;
    v.model.userData.under.material.opacity = 0.35 + Math.sin(t * 20) * 0.08 + Math.min(0.3, v.speed / 80);
    if (v.speed > 6 && Math.random() < dt * v.speed * 0.5) this.fx.dust(v.x - Math.sin(v.yaw) * -1.2, v.y - 1.0, v.z - Math.cos(v.yaw) * -1.2, 1, 1.2);
  }

  animateCam(v, fl, t) {
    const head = v.model.userData.head;
    v.model.rotation.y = 0;
    head.rotation.y = v.yaw;
    const off = !!(fl & (F.OFF | F.DEAD));
    const cone = v.model.userData.cone, lens = v.model.userData.lens;
    cone.visible = !off;
    const sus = (v.a1 || 0) / 100;
    if (!off) {
      const c = cone.material.color;
      if (sus > 0.05) c.setRGB(1, 1 - sus * 0.8, 0.2 * (1 - sus)); else c.setRGB(1, 1, 1);
      cone.material.opacity = 0.022 + sus * 0.09;
    }
    lens.material.color.setHex(off ? 0x111111 : 0xff3344).multiplyScalar(off ? 1 : 3);
    if (fl & F.DEAD) head.rotation.x = 0.8;
  }

  say(id, text) {
    const v = this.views.get(id);
    if (!v) return;
    v.bubble = text;
    v.bubbleT = Math.min(6, 2.5 + text.length * 0.05);
  }

  // Approximate ray vs. entity capsules for aiming (client-side only)
  rayEntities(o, d, maxT, skipId) {
    let best = maxT, hit = null;
    for (const v of this.views.values()) {
      if (v.id === skipId || v.kind === K.PICKUP || v.kind === K.GRENADE || (v.flags & F.DEAD)) continue;
      const r = v.kind === K.SPEEDER ? 1.2 : v.kind === K.CRITTER ? 0.6 : 0.45;
      const y0 = v.y, y1 = v.y + (v.kind === K.CAMERA ? 0.4 : v.kind === K.CRITTER ? 1 : (v.flags & F.CROUCH) ? 1.1 : 1.8);
      // closest approach of ray to vertical axis
      const ox = o.x - v.x, oz = o.z - v.z;
      const a = d.x * d.x + d.z * d.z;
      const b = 2 * (ox * d.x + oz * d.z);
      const c = ox * ox + oz * oz - r * r;
      const disc = b * b - 4 * a * c;
      if (disc < 0 || a < 1e-8) continue;
      const tt = (-b - Math.sqrt(disc)) / (2 * a);
      if (tt < 0.3 || tt > best) continue;
      const yy = o.y + d.y * tt;
      if (yy < y0 || yy > y1) continue;
      best = tt; hit = v;
    }
    return hit ? { t: best, view: hit } : null;
  }
}
