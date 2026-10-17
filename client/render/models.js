// Procedural low-poly models with joint rigs and procedural animation.
import * as THREE from 'three';
import { clamp, lerp, mulberry32 } from '../../shared/math.js';
import { textures, repeated } from './textures.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const texCache = new Map();
function texSet(name, rep) { const k = name + rep; if (!texCache.has(k)) texCache.set(k, repeated(textures()[name], rep)); return texCache.get(k); }

const matCache = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  let m = matCache.get(key);
  if (!m) {
    const tx = opts.tex ? texSet(opts.tex, opts.rep || 1) : {};
    m = new THREE.MeshStandardMaterial({ color, roughness: opts.tex ? 1 : opts.rough ?? 0.75, metalness: opts.metal ?? 0.05, flatShading: !opts.tex, emissive: opts.emissive ?? 0x000000, emissiveIntensity: opts.ei ?? 1, transparent: !!opts.transparent, opacity: opts.opacity ?? 1, ...tx });
    m.userData.cached = true;
    matCache.set(key, m);
  }
  return m;
}
export function glowMat(color, intensity = 3) {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), toneMapped: false });
}
const geoCache = new Map();
function boxG(w, h, d) {
  const k = `b${w},${h},${d}`;
  let g = geoCache.get(k);
  if (!g) { g = new THREE.BoxGeometry(w, h, d); geoCache.set(k, g); }
  return g;
}
function cylG(rt, rb, h, s = 8) {
  const k = `c${rt},${rb},${h},${s}`;
  let g = geoCache.get(k);
  if (!g) { g = new THREE.CylinderGeometry(rt, rb, h, s); geoCache.set(k, g); }
  return g;
}
function mesh(g, m, x = 0, y = 0, z = 0, shadow = true) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = shadow;
  return o;
}
function joint(parent, x, y, z) { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; }

// ------------------------------------------------------------------ weapons

export function makeRifle() {
  const g = new THREE.Group();
  const dark = mat(0x2b2d33, { metal: 0.4, rough: 0.5 }), mid = mat(0x55524c, { metal: 0.3 });
  g.add(mesh(boxG(0.07, 0.11, 0.42), dark, 0, 0, -0.08));
  g.add(mesh(cylG(0.025, 0.025, 0.34, 6), dark, 0, 0.02, -0.42).rotateX(Math.PI / 2));
  g.add(mesh(boxG(0.05, 0.14, 0.06), mid, 0, -0.1, 0.02));
  g.add(mesh(boxG(0.06, 0.08, 0.2), mid, 0, -0.01, 0.2));
  g.add(mesh(boxG(0.04, 0.05, 0.16), dark, 0, 0.09, -0.08));
  const tip = mesh(boxG(0.03, 0.03, 0.03), glowMat(0x66d0ff, 2), 0, 0.02, -0.6, false);
  g.add(tip);
  g.userData.muzzle = tip;
  return g;
}

export function makePistol() {
  const g = new THREE.Group();
  const dark = mat(0x2b2d33, { metal: 0.5, rough: 0.45 }), grip = mat(0x5a3a28);
  g.add(mesh(boxG(0.05, 0.08, 0.24), dark, 0, 0.01, -0.06));
  g.add(mesh(cylG(0.018, 0.018, 0.12, 6), dark, 0, 0.025, -0.22).rotateX(Math.PI / 2));
  g.add(mesh(boxG(0.045, 0.12, 0.06), grip, 0, -0.07, 0.03));
  const tip = mesh(boxG(0.02, 0.02, 0.02), glowMat(0x66d0ff, 2), 0, 0.025, -0.29, false);
  g.add(tip);
  g.userData.muzzle = tip;
  return g;
}

// The Sniper's LR-9 long-las: a long barrel with heat fins, a scope and a folded bipod
export function makeLongLas() {
  const g = new THREE.Group();
  const dark = mat(0x26282d, { metal: 0.45, rough: 0.45 }), wood = mat(0x6a4a30, { rough: 0.7 }), brass = mat(0xb08a4a, { metal: 0.6, rough: 0.35 });
  g.add(mesh(boxG(0.065, 0.1, 0.46), dark, 0, 0, -0.04));            // receiver
  g.add(mesh(cylG(0.02, 0.022, 0.78, 8), dark, 0, 0.02, -0.66).rotateX(Math.PI / 2)); // barrel
  for (let i = 0; i < 5; i++) g.add(mesh(cylG(0.032, 0.032, 0.025, 8), dark, 0, 0.02, -0.34 - i * 0.07).rotateX(Math.PI / 2)); // heat fins
  g.add(mesh(cylG(0.03, 0.026, 0.1, 8), dark, 0, 0.02, -1.08).rotateX(Math.PI / 2)); // muzzle brake
  g.add(mesh(cylG(0.03, 0.03, 0.3, 10), dark, 0, 0.11, -0.08).rotateX(Math.PI / 2)); // scope tube
  g.add(mesh(cylG(0.04, 0.03, 0.06, 10), brass, 0, 0.11, -0.25).rotateX(Math.PI / 2));
  g.add(mesh(new THREE.CircleGeometry(0.028, 10), glowMat(0xff5a3a, 0.8), 0, 0.11, -0.281, false).rotateY(Math.PI));
  g.add(mesh(boxG(0.05, 0.13, 0.06), wood, 0, -0.1, 0.06));         // grip
  g.add(mesh(boxG(0.055, 0.1, 0.32), wood, 0, -0.03, 0.32));        // stock
  g.add(mesh(boxG(0.06, 0.13, 0.05), wood, 0, -0.04, 0.47));
  for (const s of [-1, 1]) g.add(mesh(cylG(0.008, 0.008, 0.26, 5), dark, s * 0.03, -0.02, -0.52).rotateX(Math.PI / 2 - 0.06)); // folded bipod legs
  const tip = mesh(boxG(0.025, 0.025, 0.025), glowMat(0xff6a4a, 2), 0, 0.02, -1.14, false);
  g.add(tip);
  g.userData.muzzle = tip;
  return g;
}

// The Agent's suppressed sidearm
export function makeSilenced() {
  const g = makePistol();
  const can = mesh(cylG(0.026, 0.026, 0.2, 10), mat(0x1a1b1f, { metal: 0.5, rough: 0.5 }), 0, 0.025, -0.36);
  can.rotateX(Math.PI / 2);
  g.add(can);
  g.userData.muzzle.position.z = -0.47;
  return g;
}

// A Sniper's proximity mine: a squat disc with a blinking arming light
export function makeMine(color = '#ff4030') {
  const g = new THREE.Group();
  g.add(mesh(cylG(0.24, 0.28, 0.08, 14), mat(0x3a3d45, { metal: 0.5 }), 0, 0.04, 0));
  g.add(mesh(cylG(0.12, 0.14, 0.05, 10), mat(0x22242a, { metal: 0.5 }), 0, 0.1, 0));
  const l = mesh(new THREE.SphereGeometry(0.035, 6, 4), glowMat(0xff3030, 3), 0, 0.14, 0, false);
  g.add(l);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.34, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.5, side: THREE.DoubleSide, toneMapped: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02;
  g.add(ring);
  g.userData.light = l;
  return g;
}

export function makeKnife() {
  const g = new THREE.Group();
  g.add(mesh(cylG(0.02, 0.022, 0.12, 6), mat(0x2a2422), 0, 0, 0));
  g.add(mesh(boxG(0.07, 0.015, 0.03), mat(0x8a8c92, { metal: 0.7 }), 0, 0.065, 0));
  const blade = mesh(boxG(0.03, 0.26, 0.008), mat(0xc8ccd4, { metal: 0.85, rough: 0.25 }), 0, 0.2, 0);
  g.add(blade);
  g.add(mesh(boxG(0.006, 0.24, 0.01), glowMat(0x9ff0ff, 1.6), 0.016, 0.2, 0, false)); // vibro edge
  return g;
}

export function makeBlade(color) {
  const g = new THREE.Group();
  const hilt = new THREE.Group();
  hilt.add(mesh(cylG(0.03, 0.035, 0.26, 8), mat(0x9a9ca3, { metal: 0.7, rough: 0.35 }), 0, 0, 0));
  hilt.add(mesh(cylG(0.038, 0.038, 0.05, 8), mat(0x222226, { metal: 0.5 }), 0, 0.1, 0));
  hilt.add(mesh(boxG(0.02, 0.06, 0.03), mat(0xb8343a), 0.03, -0.02, 0));
  g.add(hilt);
  const beam = new THREE.Group();
  beam.position.y = 0.13;
  const core = new THREE.Mesh(cylG(0.016, 0.02, 1.0, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
  core.position.y = 0.5;
  const c = new THREE.Color(color);
  const glow = new THREE.Mesh(cylG(0.045, 0.05, 1.05, 10), new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(2.6), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  glow.position.y = 0.52;
  const halo = new THREE.Mesh(cylG(0.09, 0.1, 1.1, 10), new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(1.2), transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  halo.position.y = 0.53;
  beam.add(core, glow, halo);
  g.add(beam);
  g.userData.beam = beam;
  g.userData.tipLocal = new THREE.Vector3(0, 1.13, 0);
  g.userData.baseLocal = new THREE.Vector3(0, 0.16, 0);
  g.userData.ignite = 1;
  return g;
}

// ------------------------------------------------------------------ critters

export class Critter {
  constructor(variant) {
    this.root = new THREE.Group();
    const rng = mulberry32(variant * 31 + 7);
    const hide = mat([0xa77b52, 0x8f6a48, 0xb89068][Math.floor(rng() * 3)]);
    const dark = mat(0x5a3f2c);
    this.body = new THREE.Group();
    this.body.position.y = 0.55;
    this.root.add(this.body);
    const torso = mesh(new THREE.IcosahedronGeometry(0.42, 0), hide);
    torso.scale.set(0.8, 0.75, 1.35);
    this.body.add(torso);
    this.headJ = joint(this.body, 0, 0.18, -0.5);
    this.headJ.add(mesh(boxG(0.24, 0.22, 0.34), hide, 0, 0, -0.12));
    this.headJ.add(mesh(boxG(0.05, 0.32, 0.1), dark, -0.09, 0.2, 0).rotateZ(0.3));
    this.headJ.add(mesh(boxG(0.05, 0.32, 0.1), dark, 0.09, 0.2, 0).rotateZ(-0.3));
    this.tail = joint(this.body, 0, 0.05, 0.55);
    this.tail.add(mesh(boxG(0.06, 0.06, 0.6), dark, 0, 0, 0.28));
    this.legs = [];
    for (const [x, z] of [[-0.2, -0.3], [0.2, -0.3], [-0.2, 0.32], [0.2, 0.32]]) {
      const l = joint(this.body, x, -0.15, z);
      l.add(mesh(boxG(0.07, 0.42, 0.07), dark, 0, -0.2, 0));
      this.legs.push(l);
    }
    this.phase = rng() * 10;
    this.deadT = -1;
  }
  update(dt, s, t) {
    if (s.dead) {
      if (this.deadT < 0) this.deadT = 0;
      this.deadT += dt;
      this.root.rotation.z = Math.min(1.5, this.deadT * 4);
      return;
    }
    this.deadT = -1; this.root.rotation.z = 0;
    const sp = s.speed || 0;
    this.phase += dt * (sp * 2.2 + 0.5);
    const p = this.phase;
    const amp = clamp(sp / 4, 0, 1);
    this.legs.forEach((l, i) => { l.rotation.x = Math.sin(p + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI / 2 : 0)) * 0.7 * amp; });
    this.body.position.y = 0.55 + Math.abs(Math.sin(p)) * 0.12 * amp;
    this.headJ.rotation.x = s.work ? -0.7 + Math.sin(t * 3) * 0.1 : 0.1;
    this.tail.rotation.y = Math.sin(t * 4 + p) * 0.4;
    this.tail.rotation.x = s.flee ? -0.6 : 0.1;
  }
}

// ------------------------------------------------------------------ speeder

export function makeSpeeder(color = 0x8a7a64, vane = 0x9a3a2c) {
  const g = new THREE.Group();
  const hull = mat(color, { metal: 0.35, rough: 0.55 }), dark = mat(0x2e2c30, { metal: 0.5 }), red = mat(vane);
  const body = new THREE.Group();
  body.position.y = 0;
  g.add(body);
  body.add(mesh(boxG(0.7, 0.32, 2.3), hull, 0, 0.0, 0.1));
  body.add(mesh(boxG(0.55, 0.25, 1.0), hull, 0, -0.02, -1.4).rotateX(0.12));
  body.add(mesh(boxG(0.5, 0.18, 0.7), dark, 0, 0.22, 0.5)); // seat
  body.add(mesh(boxG(0.9, 0.06, 0.08), dark, 0, 0.38, -0.35)); // bars
  body.add(mesh(boxG(0.08, 0.3, 0.08), dark, 0, 0.22, -0.4));
  body.add(mesh(boxG(1.4, 0.06, 0.5), red, 0, 0.0, -0.9)); // vanes
  for (const x of [-0.5, 0.5]) {
    body.add(mesh(cylG(0.17, 0.2, 1.1, 8), dark, x, -0.05, 0.75).rotateX(Math.PI / 2));
    const glow = mesh(new THREE.CircleGeometry(0.15, 10), glowMat(0x6ad8ff, 3), x, -0.05, 1.31, false);
    body.add(glow);
  }
  const under = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 2.2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x55c8ff).multiplyScalar(1.4), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  under.rotation.x = Math.PI / 2;
  under.position.y = -0.18;
  body.add(under);
  g.userData.body = body;
  g.userData.under = under;
  g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  return g;
}

// ------------------------------------------------------------------ civilian landspeeder and cargo hauler

function underglow(w, l, y) {
  const u = new THREE.Mesh(new THREE.PlaneGeometry(w, l), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x55c8ff).multiplyScalar(1.2), transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  u.rotation.x = Math.PI / 2; u.position.y = y;
  return u;
}

// An open-top two-seat landspeeder. Faces -Z. Driver sits front-left.
export function makeLandspeeder(color = 0xb8a27e) {
  const g = new THREE.Group(), body = new THREE.Group();
  g.add(body);
  const paint = mat(color, { metal: 0.45, rough: 0.4 }), dark = mat(0x2a2a2e, { metal: 0.5, rough: 0.6 }), trim = mat(0xd8d2c4, { metal: 0.6, rough: 0.35 });
  const seat = mat(0x5a3a2a, { rough: 0.8 });
  const hullG = new RoundedBoxGeometry(1.9, 0.5, 4.0, 3, 0.22);
  body.add(mesh(hullG, paint, 0, 0.05, 0));
  const nose = new RoundedBoxGeometry(1.7, 0.36, 1.3, 3, 0.16);
  body.add(mesh(nose, paint, 0, 0.12, -2.1).rotateX(0.08));
  body.add(mesh(boxG(1.94, 0.08, 3.6), trim, 0, 0.2, 0.1)); // chrome rail
  // windscreen
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.45), new THREE.MeshStandardMaterial({ color: 0x9fd4e8, transparent: true, opacity: 0.35, metalness: 0.9, roughness: 0.05, side: THREE.DoubleSide }));
  glass.position.set(0, 0.55, -0.95); glass.rotation.x = -0.6;
  body.add(glass);
  body.add(mesh(boxG(1.5, 0.05, 0.05), dark, 0, 0.75, -0.82));
  // seats and a tiller
  for (const x of [-0.42, 0.42]) { body.add(mesh(boxG(0.55, 0.16, 0.6), seat, x, 0.33, -0.1)); body.add(mesh(boxG(0.55, 0.6, 0.14), seat, x, 0.6, 0.22).rotateX(-0.15)); }
  body.add(mesh(cylG(0.03, 0.03, 0.5, 6), dark, -0.42, 0.55, -0.62).rotateX(0.9));
  body.add(mesh(new THREE.TorusGeometry(0.16, 0.025, 6, 14), dark, -0.42, 0.72, -0.78).rotateX(0.9));
  // three rear turbines
  for (const [x, y] of [[-0.62, 0.32], [0.62, 0.32], [0, 0.62]]) {
    body.add(mesh(cylG(0.24, 0.28, 1.2, 12), dark, x, y, 1.7).rotateX(Math.PI / 2));
    body.add(mesh(new THREE.CircleGeometry(0.2, 12), glowMat(0x6ad8ff, 2.2), x, y, 2.31, false));
  }
  body.add(mesh(boxG(0.3, 0.06, 0.12), glowMat(0xffe0a0, 2.5), -0.6, 0.12, -2.72, false)); // headlights
  body.add(mesh(boxG(0.3, 0.06, 0.12), glowMat(0xffe0a0, 2.5), 0.6, 0.12, -2.72, false));
  const brake = [];
  for (const x of [-0.85, 0.85]) { const b = mesh(boxG(0.16, 0.08, 0.04), glowMat(0xff2020, 0.6), x, 0.2, 2.02, false); body.add(b); brake.push(b); }
  const under = underglow(1.6, 3.8, -0.22);
  body.add(under);
  g.userData = { body, under, brake, seats: [[-0.42, 0.41, -0.05], [0.42, 0.41, -0.05]] };
  g.traverse((m) => { if (m.isMesh && m !== under && m !== glass) m.castShadow = true; });
  return g;
}

// A cab-forward cargo hauler with a crate bed. Faces -Z.
export function makeHauler(color = 0x8f8676, seed = 1) {
  const g = new THREE.Group(), body = new THREE.Group();
  g.add(body);
  const rng = mulberry32(seed * 977 + 3);
  const paint = mat(color, { metal: 0.4, rough: 0.55 }), dark = mat(0x2a2a2e, { metal: 0.5, rough: 0.6 }), stripe = mat(0xd98b2e, { rough: 0.6 });
  body.add(mesh(new RoundedBoxGeometry(2.3, 0.45, 6.2, 2, 0.15), dark, 0, 0, 0.2));
  const cab = new RoundedBoxGeometry(2.2, 1.4, 1.8, 3, 0.3);
  body.add(mesh(cab, paint, 0, 0.9, -2.2));
  body.add(mesh(boxG(2.24, 0.18, 1.82), stripe, 0, 0.55, -2.2));
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.6), new THREE.MeshStandardMaterial({ color: 0x0e2a36, metalness: 0.9, roughness: 0.08, emissive: 0x0a2a3a, emissiveIntensity: 0.5 }));
  glass.position.set(0, 1.2, -3.11); body.add(glass);
  // the bed: side rails and a stack of crates that changes per vehicle
  body.add(mesh(boxG(2.3, 0.5, 0.12), paint, 0, 0.45, 3.25));
  for (const x of [-1.1, 1.1]) body.add(mesh(boxG(0.1, 0.5, 4.2), paint, x, 0.45, 1.2));
  const crateMat = mat(0x7d6a4e, { tex: 'crate', rep: 1 });
  for (let i = 0; i < 6; i++) {
    if (rng() < 0.25) continue;
    const s = 0.75 + rng() * 0.25;
    body.add(mesh(boxG(s, s, s), crateMat, (i % 2 ? 0.5 : -0.5), 0.22 + s / 2, -0.4 + Math.floor(i / 2) * 1.2));
    if (rng() < 0.4) body.add(mesh(boxG(s * 0.8, s * 0.8, s * 0.8), crateMat, (i % 2 ? 0.5 : -0.5), 0.22 + s + s * 0.4, -0.4 + Math.floor(i / 2) * 1.2).rotateY(rng()));
  }
  // repulsor pods
  for (const [x, z] of [[-1.05, -2.2], [1.05, -2.2], [-1.05, 2.5], [1.05, 2.5]]) {
    body.add(mesh(cylG(0.32, 0.36, 0.3, 12), dark, x, -0.32, z));
    body.add(mesh(new THREE.CircleGeometry(0.28, 12), glowMat(0x6ad8ff, 2), x, -0.48, z, false).rotateX(Math.PI / 2));
  }
  body.add(mesh(boxG(0.3, 0.08, 0.1), glowMat(0xffe0a0, 2.5), -0.75, 0.4, -3.12, false));
  body.add(mesh(boxG(0.3, 0.08, 0.1), glowMat(0xffe0a0, 2.5), 0.75, 0.4, -3.12, false));
  const brake = [];
  for (const x of [-0.95, 0.95]) { const b = mesh(boxG(0.16, 0.1, 0.04), glowMat(0xff2020, 0.6), x, 0.5, 3.33, false); body.add(b); brake.push(b); }
  const under = underglow(2, 5.6, -0.4);
  body.add(under);
  g.userData = { body, under, brake, seats: [[-0.45, 0.62, -2.3]] };
  g.traverse((m) => { if (m.isMesh && m !== under) m.castShadow = true; });
  return g;
}

// ------------------------------------------------------------------ security camera

export function makeSecCam() {
  const g = new THREE.Group();
  const head = new THREE.Group();
  g.add(mesh(boxG(0.12, 0.3, 0.12), mat(0x3a3d45), 0, 0.12, 0));
  head.add(mesh(boxG(0.22, 0.2, 0.42), mat(0xc9ccd3, { metal: 0.4 }), 0, 0, -0.1));
  const lens = mesh(cylG(0.07, 0.07, 0.05, 10), glowMat(0xff3344, 3), 0, 0, -0.33, false);
  lens.rotation.x = Math.PI / 2;
  head.add(lens);
  // vision cone (visual aid for stealth)
  const coneLen = 12;
  const cone = new THREE.Mesh(new THREE.ConeGeometry(Math.tan(0.55) * coneLen, coneLen, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.03, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  // apex at the lens, opening forward and tilted down 0.45 rad
  cone.rotation.x = Math.PI / 2 - 0.45;
  cone.position.set(0, -Math.sin(0.45) * coneLen / 2, -Math.cos(0.45) * coneLen / 2);
  head.add(cone);
  head.rotation.x = 0;
  g.add(head);
  g.userData.head = head;
  g.userData.lens = lens;
  g.userData.cone = cone;
  return g;
}

export function makeGrenade() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.IcosahedronGeometry(0.12, 0), mat(0x3a3d45, { metal: 0.6 })));
  const l = mesh(new THREE.SphereGeometry(0.05, 6, 6), glowMat(0xff4030, 4), 0, 0.1, 0, false);
  g.add(l);
  g.userData.light = l;
  return g;
}

export function makePickup(code) {
  const g = new THREE.Group();
  if (code === 1) {
    g.add(mesh(boxG(0.22, 0.02, 0.14), mat(0xc9a24a, { metal: 0.7, rough: 0.3 })));
    g.add(mesh(boxG(0.1, 0.025, 0.06), glowMat(0xffd27a, 2), 0.04, 0, 0, false));
  } else {
    g.add(mesh(new THREE.OctahedronGeometry(0.18, 0), glowMat(0x7fe3ff, 2.5)));
  }
  const halo = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.38, 24), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.6, side: THREE.DoubleSide, toneMapped: false }));
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = -0.1;
  g.add(halo);
  return g;
}
