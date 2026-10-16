// Procedural low-poly models with joint rigs and procedural animation.
import * as THREE from 'three';
import { clamp, lerp, mulberry32 } from '../../shared/math.js';
import { textures, repeated } from './textures.js';

const texCache = new Map();
function texSet(name, rep) { const k = name + rep; if (!texCache.has(k)) texCache.set(k, repeated(textures()[name], rep)); return texCache.get(k); }

const matCache = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  let m = matCache.get(key);
  if (!m) {
    const tx = opts.tex ? texSet(opts.tex, opts.rep || 1) : {};
    m = new THREE.MeshStandardMaterial({ color, roughness: opts.tex ? 1 : opts.rough ?? 0.75, metalness: opts.metal ?? 0.05, flatShading: !opts.tex, emissive: opts.emissive ?? 0x000000, emissiveIntensity: opts.ei ?? 1, transparent: !!opts.transparent, opacity: opts.opacity ?? 1, ...tx });
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

// ------------------------------------------------------------------ humanoids

const SKIN = [0xc79a7a, 0x8d5f45, 0xe2b896, 0x6a4632, 0xb07d5a, 0xd9a988];
const ROBES = [0x8a6a4a, 0x6b4f3a, 0x9c7b56, 0x5d6b62, 0x7a5148, 0x8b7f6a, 0x5e4a5a];

export class Humanoid {
  constructor(type, opts = {}) {
    this.type = type;
    this.root = new THREE.Group();
    this.phase = 0;
    this.swingT = 9;
    this.swingVar = 0;
    this.lastSwing = 0;
    this.deadT = -1;
    this.blendCrouch = 0;
    this.yawOffset = 0;
    this.bladeOn = 0;
    const rng = mulberry32((opts.variant || 1) * 7919 + 13);
    this.build(type, opts, rng);
  }

  build(type, o, rng) {
    let body, limb, head, accent, boots;
    const skin = SKIN[Math.floor(rng() * SKIN.length)];
    if (type === 'lancer' || type === 'officer') {
      body = mat(type === 'officer' ? 0x2a2a32 : 0x4a5162, { metal: 0.5, tex: 'plate', rep: 1 });
      limb = mat(type === 'officer' ? 0x1e1e24 : 0x2e323d, { metal: 0.1, tex: 'cloth', rep: 2 });
      head = mat(type === 'officer' ? 0x2a2a32 : 0xd6d9e0, { metal: 0.45, tex: 'plate', rep: 1 });
      accent = mat(type === 'officer' ? 0xc9a24a : 0xa3243a, { metal: 0.4, rough: 0.4 });
      boots = mat(0x15161a);
    } else if (type === 'player') {
      body = mat(0x6a5644, { tex: 'cloth', rep: 2 }); limb = mat(0x463c34, { tex: 'cloth', rep: 2 }); head = mat(skin); accent = mat(o.color, { tex: 'cloth', rep: 2 }); boots = mat(0x2a221c, { tex: 'plate', rep: 1 });
    } else if (type === 'prisoner') {
      body = mat(0xc4682e, { tex: 'cloth', rep: 2 }); limb = mat(0xb35d2a, { tex: 'cloth', rep: 2 }); head = mat(skin); accent = mat(0x403028); boots = mat(0x2a221c);
    } else {
      const robe = ROBES[Math.floor(rng() * ROBES.length)];
      body = mat(robe, { tex: 'cloth', rep: 2 }); limb = mat(ROBES[Math.floor(rng() * ROBES.length)], { tex: 'cloth', rep: 2 }); head = mat(skin);
      accent = mat([0xa84432, 0x3f7f8a, 0xc98d2e, 0x6b5b8a][Math.floor(rng() * 4)], { tex: 'cloth', rep: 2 }); boots = mat(0x3a2c22);
    }
    const R = this.root;
    const pelvis = this.pelvis = joint(R, 0, 0.95, 0);
    pelvis.add(mesh(boxG(0.34, 0.16, 0.2), limb, 0, 0, 0));
    const spine = this.spine = joint(pelvis, 0, 0.08, 0);
    const chest = mesh(boxG(0.42, 0.5, 0.24), body, 0, 0.27, 0);
    spine.add(chest);
    spine.add(mesh(boxG(0.44, 0.06, 0.26), accent, 0, 0.04, 0)); // belt
    const neckJ = this.head = joint(spine, 0, 0.56, 0);
    const shL = this.shL = joint(spine, -0.27, 0.46, 0), shR = this.shR = joint(spine, 0.27, 0.46, 0);
    const mkArm = (sh, side) => {
      sh.add(mesh(boxG(0.12, 0.3, 0.13), body, 0, -0.14, 0));
      const el = joint(sh, 0, -0.29, 0);
      el.add(mesh(boxG(0.1, 0.27, 0.11), limb, 0, -0.13, 0));
      const hand = joint(el, 0, -0.28, 0);
      hand.add(mesh(boxG(0.09, 0.09, 0.09), type === 'lancer' || type === 'officer' ? limb : head, 0, -0.02, 0));
      return [el, hand];
    };
    [this.elL, this.handL] = mkArm(shL, -1);
    [this.elR, this.handR] = mkArm(shR, 1);
    const mkLeg = (x) => {
      const hip = joint(pelvis, x, -0.04, 0);
      hip.add(mesh(boxG(0.15, 0.44, 0.16), limb, 0, -0.22, 0));
      const kn = joint(hip, 0, -0.44, 0);
      kn.add(mesh(boxG(0.13, 0.42, 0.14), type === 'lancer' ? body : limb, 0, -0.21, 0));
      kn.add(mesh(boxG(0.14, 0.08, 0.24), boots, 0, -0.44, -0.04));
      return [hip, kn];
    };
    [this.hipL, this.knL] = mkLeg(-0.1);
    [this.hipR, this.knR] = mkLeg(0.1);
    // Heads & silhouettes
    if (type === 'lancer') {
      neckJ.add(mesh(boxG(0.26, 0.28, 0.28), head, 0, 0.14, 0));
      neckJ.add(mesh(boxG(0.2, 0.05, 0.02), glowMat(0xff2a3a, 3), 0, 0.15, -0.145, false));
      neckJ.add(mesh(boxG(0.3, 0.06, 0.3), limb, 0, 0.27, 0));
      shL.add(mesh(boxG(0.18, 0.12, 0.2), head, -0.02, 0.02, 0));
      shR.add(mesh(boxG(0.18, 0.12, 0.2), head, 0.02, 0.02, 0));
      spine.add(mesh(boxG(0.3, 0.32, 0.12), limb, 0, 0.3, 0.17)); // pack
      chest.material = body;
      spine.add(mesh(boxG(0.36, 0.22, 0.03), head, 0, 0.36, -0.13)); // chest plate
    } else if (type === 'officer') {
      neckJ.add(mesh(boxG(0.22, 0.25, 0.24), mat(skin), 0, 0.13, 0));
      neckJ.add(mesh(boxG(0.28, 0.07, 0.3), head, 0, 0.29, 0.0));
      neckJ.add(mesh(boxG(0.3, 0.02, 0.16), head, 0, 0.26, -0.16));
      spine.add(mesh(boxG(0.1, 0.06, 0.02), accent, -0.12, 0.42, -0.13));
      const cape = mesh(boxG(0.46, 0.85, 0.03), mat(0x5a1520), 0, 0.05, 0.15);
      spine.add(cape);
      this.cape = cape;
    } else if (type === 'player') {
      neckJ.add(mesh(boxG(0.22, 0.25, 0.24), head, 0, 0.13, 0));
      neckJ.add(mesh(boxG(0.25, 0.1, 0.26), mat([0x2a1d14, 0x5a3a20, 0x111111, 0x8a6a3a][o.colorIdx || 0]), 0, 0.27, 0.01)); // hair
      spine.add(mesh(boxG(0.44, 0.1, 0.26), accent, 0, 0.46, 0)); // shoulder band in crew colour
      spine.add(mesh(boxG(0.06, 0.42, 0.25), accent, 0.12, 0.25, 0));
      const coat = mesh(boxG(0.44, 0.4, 0.26), body, 0, -0.22, 0.01);
      pelvis.add(coat);
      this.coat = coat;
      spine.add(mesh(boxG(0.28, 0.36, 0.08), mat(0x3a3028), 0, 0.28, 0.15));
    } else if (type === 'prisoner') {
      neckJ.add(mesh(boxG(0.22, 0.25, 0.24), head, 0, 0.13, 0));
      neckJ.add(mesh(boxG(0.25, 0.14, 0.26), mat(0x1a1210), 0, 0.25, 0.03));
    } else if (type === 'critterless') {
      // unused
    } else {
      // townsfolk: hood/headwrap and robe skirt
      neckJ.add(mesh(boxG(0.22, 0.25, 0.24), head, 0, 0.13, 0));
      if (rng() < 0.6) neckJ.add(mesh(boxG(0.28, 0.3, 0.3), body, 0, 0.17, 0.03));
      else neckJ.add(mesh(boxG(0.26, 0.08, 0.27), accent, 0, 0.25, 0));
      const skirt = mesh(cylG(0.24, 0.34, 0.6, 7), body, 0, -0.3, 0);
      pelvis.add(skirt);
      this.skirt = skirt;
      if (type === 'merchant') { spine.add(mesh(boxG(0.36, 0.5, 0.04), mat(0x6e4a30), 0, 0.15, -0.14)); this.root.scale.setScalar(1.06); }
      if (type === 'bartender') spine.add(mesh(boxG(0.36, 0.5, 0.04), mat(0xd8d0c0), 0, 0.15, -0.14));
      if (type === 'informant') neckJ.add(mesh(boxG(0.32, 0.06, 0.32), mat(0x3a2a20), 0, 0.3, 0));
    }
    // weapons
    const cls = o.cls || 'soldier';
    this.cls = cls;
    this.weaponKind = type === 'player' ? ({ warden: 'blade', gunslinger: 'pistols', soldier: 'blaster', medic: 'pistol', spy: 'knives' }[cls]) : (type === 'lancer' || type === 'officer' ? 'blaster' : null);
    if (type === 'lancer' || type === 'officer' || (type === 'player' && this.weaponKind === 'blaster')) {
      this.rifle = makeRifle();
      this.rifle.rotation.x = -Math.PI / 2;
      this.rifle.position.set(0, -0.04, -0.02);
      this.handR.add(this.rifle);
    }
    if (type === 'player' && (this.weaponKind === 'pistols' || this.weaponKind === 'pistol')) {
      this.pistolR = makePistol(); this.pistolR.rotation.x = -Math.PI / 2; this.pistolR.position.set(0, -0.05, -0.01); this.handR.add(this.pistolR);
      if (this.weaponKind === 'pistols') { this.pistolL = makePistol(); this.pistolL.rotation.x = -Math.PI / 2; this.pistolL.position.set(0, -0.05, -0.01); this.handL.add(this.pistolL); }
    }
    if (type === 'player' && this.weaponKind === 'knives') {
      this.knifeR = makeKnife(); this.knifeR.rotation.x = -Math.PI / 2 - 0.3; this.knifeR.position.set(0, -0.05, 0); this.handR.add(this.knifeR);
      this.knifeL = makeKnife(); this.knifeL.rotation.x = Math.PI / 2 + 0.6; this.knifeL.position.set(0, -0.05, 0); this.handL.add(this.knifeL);
    }
    if (type === 'player') this.dressClass(cls, o, accent, body);
    if (type === 'player' && this.weaponKind === 'blade') {
      this.blade = makeBlade(o.bladeColor || '#4fc8ff');
      this.blade.rotation.x = -Math.PI / 2;
      this.blade.position.set(0, -0.03, 0);
      this.handR.add(this.blade);
      this.blade.visible = false;
      // holstered hilt on the belt
      this.holster = makeBlade(o.bladeColor);
      this.holster.userData.beam.visible = false;
      this.holster.position.set(-0.22, -0.02, -0.02);
      this.holster.rotation.z = 0.3;
      pelvis.add(this.holster);
    }
    this.root.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  }

  // Class silhouettes so crewmates can tell each other apart at a glance
  dressClass(cls, o, accent, body) {
    const N = this.head, S = this.spine, P = this.pelvis;
    const darkCloth = mat(0x2a2430, { tex: 'cloth', rep: 2 });
    if (cls === 'warden') {
      const robe = mesh(cylG(0.26, 0.42, 0.75, 8), mat(0x6b5440, { tex: 'cloth', rep: 2 }), 0, -0.38, 0);
      P.add(robe); this.skirt = robe;
      N.add(mesh(boxG(0.3, 0.32, 0.32), mat(0x5a4636, { tex: 'cloth', rep: 2 }), 0, 0.17, 0.04)); // hood
      S.add(mesh(boxG(0.08, 0.52, 0.27), accent, 0.06, 0.25, 0).rotateZ(0.5)); // sash
    } else if (cls === 'gunslinger') {
      N.add(mesh(cylG(0.3, 0.3, 0.03, 12), mat(0x3a2a1e, { tex: 'cloth', rep: 1 }), 0, 0.27, 0)); // brim
      N.add(mesh(cylG(0.14, 0.16, 0.14, 10), mat(0x3a2a1e, { tex: 'cloth', rep: 1 }), 0, 0.34, 0));
      const coat = mesh(boxG(0.46, 0.7, 0.28), mat(0x5a3e2a, { tex: 'cloth', rep: 2 }), 0, -0.35, 0.02);
      P.add(coat); this.coat = coat;
      P.add(mesh(boxG(0.06, 0.14, 0.1), mat(0x2a1e16), -0.2, -0.06, 0)); P.add(mesh(boxG(0.06, 0.14, 0.1), mat(0x2a1e16), 0.2, -0.06, 0)); // holsters
    } else if (cls === 'soldier') {
      N.add(mesh(boxG(0.28, 0.16, 0.3), mat(0x4a5040, { tex: 'plate', rep: 1, metal: 0.4 }), 0, 0.25, 0)); // helmet
      N.add(mesh(boxG(0.22, 0.04, 0.02), glowMat(0xffb04a, 1.2), 0, 0.17, -0.14, false)); // visor strip
      S.add(mesh(boxG(0.46, 0.34, 0.3), mat(0x4a5040, { tex: 'plate', rep: 1, metal: 0.4 }), 0, 0.3, 0)); // chest rig
      S.add(mesh(boxG(0.34, 0.4, 0.16), mat(0x3a3a30, { tex: 'cloth', rep: 2 }), 0, 0.28, 0.2)); // pack
      for (const x of [-0.12, 0, 0.12]) S.add(mesh(boxG(0.08, 0.1, 0.06), mat(0x2e3228), x, 0.08, -0.15));
    } else if (cls === 'medic') {
      S.add(mesh(boxG(0.44, 0.12, 0.27), mat(0xe8e2d4, { tex: 'cloth', rep: 2 }), 0, 0.46, 0));
      this.shL.add(mesh(boxG(0.14, 0.1, 0.15), mat(0xe8e2d4), 0, -0.08, 0));
      this.shL.add(mesh(boxG(0.15, 0.03, 0.05), glowMat(0x4ae0a0, 1.4), 0, -0.08, -0.07, false));
      this.shL.add(mesh(boxG(0.05, 0.08, 0.05), glowMat(0x4ae0a0, 1.4), 0, -0.08, -0.071, false));
      P.add(mesh(boxG(0.16, 0.2, 0.12), mat(0x7a5a3a, { tex: 'cloth', rep: 1 }), 0.2, -0.12, 0.08)); // satchel
    } else if (cls === 'spy') {
      N.add(mesh(boxG(0.29, 0.31, 0.31), darkCloth, 0, 0.16, 0.04)); // hood
      N.add(mesh(boxG(0.2, 0.05, 0.03), glowMat(0x6aff9a, 1.6), 0, 0.15, -0.13, false)); // goggles
      S.add(mesh(boxG(0.44, 0.5, 0.25), darkCloth, 0, 0.27, 0));
      S.add(mesh(boxG(0.1, 0.12, 0.08), mat(0x3a4048, { metal: 0.6 }), 0.16, 0.06, 0.13)); // cloak emitter
    }
    this.root.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  }

  setShroud(on, opacity = 0.16) {
    if (on === this._shroud && opacity === this._shroudOp) return;
    this._shroud = on;
    this._shroudOp = opacity;
    if (on) { if (!this.shroudMat) this.shroudMat = SHROUD_MAT.clone(); this.shroudMat.opacity = opacity; }
    this.root.traverse((m) => {
      if (!m.isMesh || m.material.blending === THREE.AdditiveBlending) return;
      if (on) {
        if (!m.userData.origMat) m.userData.origMat = m.material;
        m.material = this.shroudMat;
        m.castShadow = false;
      } else if (m.userData.origMat) { m.material = m.userData.origMat; m.castShadow = true; }
    });
  }

  // s: {speed, crouch, pitch, weapon:'blaster'|'blade'|null, block, swing (counter), downed, dead, driving, talk, work, flee, stagger, air, aim, sit}
  update(dt, s, t) {
    const sp = s.speed || 0;
    const moving = sp > 0.35;
    this.blendCrouch = lerp(this.blendCrouch, s.crouch || s.sit ? 1 : 0, Math.min(1, dt * 10));
    const cr = this.blendCrouch;
    const stride = moving ? sp * (s.crouch ? 2.6 : 1.55) : 0;
    this.phase += dt * stride;
    const amp = moving ? clamp(sp / 5, 0.25, 1) * (sp > 7 ? 0.95 : 0.65) * (s.crouch ? 0.7 : 1) : 0;
    const ph = this.phase;
    const sw = Math.sin(ph), cw = Math.cos(ph);
    const R = this.root;
    const armed = !(s.dead || s.downed || s.driving);
    for (const w of [this.pistolR, this.pistolL, this.knifeR, this.knifeL]) if (w) w.visible = armed;

    // ---- death / downed poses
    if (s.dead) {
      if (this.deadT < 0) { this.deadT = 0; this.deadDir = Math.random() < 0.5 ? 1 : -1; }
      this.deadT += dt;
      const f = clamp(this.deadT / 0.55, 0, 1);
      const ease = f * f;
      R.rotation.x = this.deadDir * 1.5 * ease;
      this.pelvis.position.y = lerp(0.95, 0.3, ease);
      this.shL.rotation.set(-1.2 * ease, 0, -0.6 * ease);
      this.shR.rotation.set(-1.0 * ease, 0, 0.7 * ease);
      this.hipL.rotation.x = 0.4 * ease; this.hipR.rotation.x = -0.2 * ease;
      this.knL.rotation.x = -0.4 * ease; this.knR.rotation.x = -0.2;
      this.spine.rotation.set(0, 0, 0);
      if (this.blade) this.blade.visible = false;
      return;
    }
    this.deadT = -1;
    if (s.downed) {
      R.rotation.x = lerp(R.rotation.x, 1.35, Math.min(1, dt * 6));
      this.pelvis.position.y = 0.3;
      this.shL.rotation.set(0.4 + Math.sin(t * 2) * 0.1, 0, -0.3);
      this.shR.rotation.set(1.2, 0, 0.6);
      this.elR.rotation.x = 1.4;
      this.hipL.rotation.x = 0.5; this.knL.rotation.x = -0.9; this.hipR.rotation.x = 0.1; this.knR.rotation.x = -0.2;
      this.head.rotation.x = 0.5;
      if (this.blade) this.blade.visible = false;
      return;
    }
    R.rotation.x = lerp(R.rotation.x, 0, Math.min(1, dt * 8));
    R.rotation.z = 0;

    // ---- driving pose
    if (s.driving) {
      this.pelvis.position.y = 0.5;
      this.hipL.rotation.set(1.5, 0, -0.15); this.hipR.rotation.set(1.5, 0, 0.15);
      this.knL.rotation.x = -1.6; this.knR.rotation.x = -1.6;
      this.spine.rotation.set(-0.35, 0, 0);
      this.shL.rotation.set(1.1, 0, 0.2); this.shR.rotation.set(1.1, 0, -0.2);
      this.elL.rotation.x = 0.4; this.elR.rotation.x = 0.4;
      this.head.rotation.x = 0.35;
      if (this.rifle) this.rifle.visible = false;
      if (this.blade) this.blade.visible = false;
      if (this.holster) this.holster.visible = true;
      return;
    }

    // ---- locomotion
    const pelvisY = lerp(0.95, s.sit ? 0.5 : 0.62, cr) + (moving ? Math.abs(cw) * 0.04 * amp : 0);
    this.pelvis.position.y = pelvisY;
    const crouchHip = s.sit ? 1.45 : 1.05;
    this.hipL.rotation.set(sw * amp + cr * crouchHip, 0, -0.03);
    this.hipR.rotation.set(-sw * amp + cr * crouchHip, 0, 0.03);
    this.knL.rotation.x = -Math.max(0, -cw) * amp * 1.3 - cr * (s.sit ? 1.45 : 1.75);
    this.knR.rotation.x = -Math.max(0, cw) * amp * 1.3 - cr * (s.sit ? 1.45 : 1.75);
    if (s.air) { this.hipL.rotation.x = 0.6; this.knL.rotation.x = -1.0; this.hipR.rotation.x = -0.2; this.knR.rotation.x = -0.5; }
    let lean = -cr * (s.sit ? 0.05 : 0.45) - (sp > 7 ? 0.18 : moving ? 0.06 : 0);
    if (s.flee) lean -= 0.2;
    this.spine.rotation.set(lean, 0, moving ? sw * 0.04 : 0);
    const pitch = s.pitch || 0;
    this.head.rotation.set(clamp(pitch * 0.6, -0.5, 0.5) - lean * 0.6, 0, 0);
    if (this.coat) this.coat.rotation.x = cr * -0.9;
    if (this.skirt) this.skirt.scale.y = 1 - cr * 0.3;
    if (this.cape) this.cape.rotation.x = 0.1 + (moving ? 0.2 * amp : 0) + Math.sin(t * 2) * 0.03;

    // ---- arms
    const armsIdle = () => {
      this.shL.rotation.set(-sw * amp * 0.8 + 0.05, 0, -0.08);
      this.shR.rotation.set(sw * amp * 0.8 + 0.05, 0, 0.08);
      this.elL.rotation.x = 0.25 + (moving ? 0.25 : 0); this.elR.rotation.x = 0.25 + (moving ? 0.25 : 0);
    };
    const weapon = s.weapon;
    if (this.rifle) this.rifle.visible = weapon === 'blaster';
    if (this.blade) { this.blade.visible = weapon === 'blade'; this.holster.visible = weapon !== 'blade'; }
    if (this.blade && weapon === 'blade') {
      this.bladeOn = Math.min(1, this.bladeOn + dt * 6);
      this.blade.userData.beam.scale.y = this.bladeOn;
    } else this.bladeOn = 0;
    if (s.swing !== undefined && s.swing !== this.lastSwing) {
      this.lastSwing = s.swing;
      this.swingT = 0;
      this.swingVar = (this.swingVar + 1) % 3;
    }
    this.swingT += dt;
    if (weapon === 'blaster') {
      const aimF = s.aim ? 1 : 0.8;
      this.shR.rotation.set(Math.PI / 2 * aimF + pitch * aimF, 0, 0.05);
      this.elR.rotation.set(0.15, 0, 0);
      this.shL.rotation.set(Math.PI / 2 * aimF + pitch * aimF - 0.05, 0, 0.75);
      this.elL.rotation.set(0.55, 0, 0);
      this.handR.rotation.set(0, 0, 0);
      this.spine.rotation.y = -0.25;
      this.head.rotation.y = 0.25;
    } else if (weapon === 'pistols' || weapon === 'pistol') {
      const aimF = 1;
      const kick = Math.max(0, 0.15 - this.swingT) * 2;
      this.shR.rotation.set(Math.PI / 2 * aimF + pitch + kick, 0, weapon === 'pistols' ? -0.12 : 0.02);
      this.elR.rotation.set(0.05, 0, 0);
      this.handR.rotation.set(0, 0, 0);
      if (weapon === 'pistols') { this.shL.rotation.set(Math.PI / 2 + pitch + kick * 0.6, 0, 0.12); this.elL.rotation.set(0.05, 0, 0); }
      else { this.shL.rotation.set(-sw * amp * 0.6 + 0.1, 0, -0.1); this.elL.rotation.x = 0.4; }
      this.spine.rotation.y = weapon === 'pistol' ? -0.2 : 0;
      this.head.rotation.y = weapon === 'pistol' ? 0.2 : 0;
    } else if (weapon === 'knives') {
      this.spine.rotation.y = 0; this.head.rotation.y = 0;
      const st = this.swingT / 0.3;
      if (st < 1) {
        const e = Math.sin(Math.min(1, st * 1.3) * Math.PI / 2);
        const right = this.swingVar % 2 === 0;
        const sh = right ? this.shR : this.shL, other = right ? this.shL : this.shR;
        sh.rotation.set(0.6 + e * 1.4, 0, (right ? 1 : -1) * (0.9 - e * 1.6));
        other.rotation.set(0.9, 0, right ? -0.5 : 0.5);
        this.elR.rotation.x = 0.4; this.elL.rotation.x = 0.4;
        this.spine.rotation.y = (right ? 1 : -1) * (0.5 - e);
      } else {
        this.shR.rotation.set(0.9 + sw * amp * 0.1, 0, 0.35); this.elR.rotation.x = 1.3;
        this.shL.rotation.set(0.9 - sw * amp * 0.1, 0, -0.35); this.elL.rotation.x = 1.3;
      }
    } else if (weapon === 'blade') {
      this.spine.rotation.y = 0; this.head.rotation.y = 0;
      const st = this.swingT / 0.42;
      if (st < 1) {
        // swing keyframes: [shoulderX, shoulderZ, spineY, handZ]
        const K = [
          [[2.7, -0.7, -0.5, 0.2], [1.3, 0.2, 0.2, 0.9], [0.5, 0.9, 0.6, 1.4]],
          [[1.9, 1.0, 0.5, -0.4], [1.4, 0.1, 0.0, -1.1], [1.0, -0.9, -0.5, -1.6]],
          [[3.1, 0.1, 0.0, 0.0], [1.8, 0.0, 0.0, 0.2], [0.4, 0.1, 0.1, 0.5]],
        ][this.swingVar];
        let a, b, f;
        if (st < 0.25) { a = K[0]; b = K[0]; f = 1; }
        else if (st < 0.6) { a = st < 0.42 ? K[0] : K[1]; b = st < 0.42 ? K[1] : K[2]; f = st < 0.42 ? (st - 0.25) / 0.17 : (st - 0.42) / 0.18; }
        else { a = K[2]; b = [0.5, -0.2, 0, 0]; f = (st - 0.6) / 0.4; }
        f = f * f * (3 - 2 * f);
        this.shR.rotation.set(lerp(a[0], b[0], f), 0, lerp(a[1], b[1], f));
        this.spine.rotation.y = lerp(a[2], b[2], f);
        this.handR.rotation.set(0, 0, lerp(a[3], b[3], f));
        this.elR.rotation.x = 0.2;
        this.shL.rotation.set(0.5, 0, -0.4); this.elL.rotation.x = 0.6;
      } else if (s.block) {
        this.shR.rotation.set(1.35, 0, 0.75); this.elR.rotation.x = 0.6; this.handR.rotation.set(0, 0, 1.25);
        this.shL.rotation.set(0.9, 0, -0.2); this.elL.rotation.x = 0.8;
        this.spine.rotation.y = 0.2;
      } else {
        this.shR.rotation.set(0.55 + sw * amp * 0.2, 0, -0.15); this.elR.rotation.x = 0.7; this.handR.rotation.set(0.35, 0, 0.15);
        this.shL.rotation.set(-sw * amp * 0.6 + 0.2, 0, -0.15); this.elL.rotation.x = 0.4;
      }
    } else {
      this.spine.rotation.y = 0; this.head.rotation.y = 0;
      armsIdle();
      if (s.talk) {
        this.shR.rotation.set(0.7 + Math.sin(t * 3.1) * 0.35, 0, -0.2 + Math.sin(t * 2.3) * 0.2);
        this.elR.rotation.x = 1.0 + Math.sin(t * 4) * 0.3;
        this.head.rotation.y = Math.sin(t * 0.9) * 0.2;
      }
      if (s.work) {
        this.shL.rotation.set(0.9 + Math.sin(t * 2.2) * 0.15, 0, 0.2); this.elL.rotation.x = 0.9;
        this.shR.rotation.set(0.9 + Math.cos(t * 2.2) * 0.15, 0, -0.2); this.elR.rotation.x = 0.9;
        this.head.rotation.x = -0.35;
        this.spine.rotation.x -= 0.15;
      }
      if (s.flee) { this.shL.rotation.set(2.6, 0, -0.3); this.shR.rotation.set(2.6, 0, 0.3); this.elL.rotation.x = 1.2; this.elR.rotation.x = 1.2; }
      if (s.cower) { this.shL.rotation.set(2.2, 0, 0.5); this.shR.rotation.set(2.2, 0, -0.5); this.elL.rotation.x = 1.9; this.elR.rotation.x = 1.9; this.head.rotation.x = -0.5; }
    }
    if (s.stagger) {
      this.spine.rotation.x += 0.5;
      this.shL.rotation.set(-0.8, 0, -1.0); this.shR.rotation.set(-0.8, 0, 1.0);
    }
    // lancer holding rifle when not in combat: low ready
    if (weapon === 'blaster' && s.lowReady) {
      this.shR.rotation.set(0.6 + sw * amp * 0.1, 0, 0.1);
      this.shL.rotation.set(0.75, 0, 0.7);
      this.elL.rotation.x = 0.9; this.elR.rotation.x = 0.4;
      this.spine.rotation.y = 0; this.head.rotation.y = 0;
      this.handR.rotation.set(-0.6, 0, 0);
    } else if (weapon === 'blaster') this.handR.rotation.set(0, 0, 0);
  }

  bladeWorld(base, tip) {
    if (!this.blade || !this.blade.visible) return false;
    this.blade.updateWorldMatrix(true, false);
    base.copy(this.blade.userData.baseLocal).applyMatrix4(this.blade.matrixWorld);
    tip.copy(this.blade.userData.tipLocal).applyMatrix4(this.blade.matrixWorld);
    return true;
  }
  muzzleWorld(out, left) {
    const gun = left && this.pistolL ? this.pistolL : this.rifle || this.pistolR;
    if (!gun) return false;
    gun.userData.muzzle.updateWorldMatrix(true, false);
    out.setFromMatrixPosition(gun.userData.muzzle.matrixWorld);
    return true;
  }
}

const SHROUD_MAT = new THREE.MeshStandardMaterial({ color: 0x8fb8d8, transparent: true, opacity: 0.16, roughness: 0.2, metalness: 0.6, emissive: 0x2a4a6a, emissiveIntensity: 0.6, depthWrite: false });

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

export function makeSpeeder() {
  const g = new THREE.Group();
  const hull = mat(0x8a7a64, { metal: 0.35, rough: 0.55 }), dark = mat(0x2e2c30, { metal: 0.5 }), red = mat(0x9a3a2c);
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
