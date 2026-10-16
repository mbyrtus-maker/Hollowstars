// Low-poly sculpted humanoids. Each character is assembled from shaped parts attached
// to a bone rig, then baked into one skinned mesh per material (a few draw calls per
// character). Bones are animated procedurally; weapons stay as separate meshes that move
// between the hands and holsters.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clamp, lerp, mulberry32 } from '../../shared/math.js';
import { textures, repeated } from './textures.js';
import { makeRifle, makeBlade, makePistol, makeKnife, glowMat } from './models.js';

// ------------------------------------------------------------------ shared materials

const texCache = new Map();
function texSet(name, rep) { const k = name + rep; if (!texCache.has(k)) texCache.set(k, repeated(textures()[name], rep)); return texCache.get(k); }
let MATS = null;
function mats() {
  if (MATS) return MATS;
  MATS = {
    cloth: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, ...texSet('cloth', 3) }),
    plate: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.12, ...texSet('plate', 1.5) }),
    skin: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0 }),
    leather: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05 }),
  };
  return MATS;
}

// ------------------------------------------------------------------ geometry helpers

const V2 = (x, y) => new THREE.Vector2(x, y);
// A limb segment hanging down from its joint: radius r0 at the joint, r1 at the far end
function limb(r0, r1, len, segs = 9) {
  const g = new THREE.CylinderGeometry(r1, r0, len, segs, 2);
  g.translate(0, -len / 2, 0);
  return g;
}
function ball(r, w = 9, h = 7) { return new THREE.SphereGeometry(r, w, h); }
function ellipsoid(rx, ry, rz, w = 12, h = 9) { const g = new THREE.SphereGeometry(1, w, h); g.scale(rx, ry, rz); return g; }
function lathe(pts, segs = 12, depth = 1) { const g = new THREE.LatheGeometry(pts.map(([r, y]) => V2(r, y)), segs); if (depth !== 1) g.scale(1, 1, depth); return g; }
function rbox(w, h, d, r = 0.018) { return new RoundedBoxGeometry(w, h, d, 2, Math.min(r, Math.min(w, h, d) * 0.45)); }

// ------------------------------------------------------------------ palettes

const SKIN = [0xd9a888, 0x9c6a4e, 0xeec3a2, 0x6e4a35, 0xb88462, 0xc9946e, 0x5a3a2a];
const HAIR = [0x1e1410, 0x3a2416, 0x5a3a20, 0x111111, 0x8a6a3a, 0x6a5a50, 0xa8a090];
const ROBES = [0x8a6a4a, 0x6b4f3a, 0x9c7b56, 0x5d6b62, 0x7a5148, 0x8b7f6a, 0x5e4a5a, 0x7a6a3a];
const ACCENTS = [0xa84432, 0x3f7f8a, 0xc98d2e, 0x6b5b8a, 0x8a3a5a];

// ------------------------------------------------------------------ the humanoid

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
    this.bladeOn = 0;
    this.drawn = type !== 'player';
    this.drawT = 9;
    this.parts = [];
    const rng = mulberry32((opts.variant || 1) * 7919 + 13);
    this.rng = rng;
    this.buildRig(rng, opts);
    this.dress(type, opts, rng);
    this.bake();
    this.arm(type, opts);
    this.setDrawn(this.drawn, true);
  }

  // ---------------- rig
  buildRig(rng, o) {
    const B = () => new THREE.Bone();
    const at = (parent, x, y, z) => { const b = B(); b.position.set(x, y, z); parent.add(b); this.bones.push(b); return b; };
    this.bones = [];
    const rootBone = B(); this.root.add(rootBone); this.bones.push(rootBone); this.rootBone = rootBone;
    const build = this.type === 'player' || this.type === 'lancer' ? 1 : 0.92 + rng() * 0.16;
    this.build = build;
    const sh = 0.185 * (this.type === 'lancer' ? 1.06 : build);
    this.pelvis = at(rootBone, 0, 0.95, 0);
    this.spine = at(this.pelvis, 0, 0.08, 0);
    this.head = at(this.spine, 0, 0.56, 0);
    this.shL = at(this.spine, -sh, 0.47, 0); this.shR = at(this.spine, sh, 0.47, 0);
    this.elL = at(this.shL, 0, -0.29, 0); this.elR = at(this.shR, 0, -0.29, 0);
    this.handL = at(this.elL, 0, -0.27, 0); this.handR = at(this.elR, 0, -0.27, 0);
    this.hipL = at(this.pelvis, -0.095, -0.05, 0); this.hipR = at(this.pelvis, 0.095, -0.05, 0);
    this.knL = at(this.hipL, 0, -0.44, 0); this.knR = at(this.hipR, 0, -0.44, 0);
    this.coatBone = at(this.pelvis, 0, -0.02, 0);
    this.capeBone = at(this.spine, 0, 0.5, 0.13);
    this.mBack = new THREE.Group(); this.mBack.position.set(0.02, 0.3, 0.19); this.mBack.rotation.set(Math.PI / 2, 0, 0.65); this.spine.add(this.mBack);
    this.mHipR = new THREE.Group(); this.mHipR.position.set(0.2, -0.06, 0.03); this.mHipR.rotation.set(-Math.PI / 2 + 0.15, 0, 0); this.pelvis.add(this.mHipR);
    this.mHipL = new THREE.Group(); this.mHipL.position.set(-0.2, -0.06, 0.03); this.mHipL.rotation.set(-Math.PI / 2 + 0.15, 0, 0); this.pelvis.add(this.mHipL);
    this.mSheathR = new THREE.Group(); this.mSheathR.position.set(0.09, 0.02, 0.17); this.mSheathR.rotation.set(0, 0, Math.PI - 0.55); this.pelvis.add(this.mSheathR);
    this.mSheathL = new THREE.Group(); this.mSheathL.position.set(-0.09, 0.02, 0.17); this.mSheathL.rotation.set(0, 0, -Math.PI + 0.55); this.pelvis.add(this.mSheathL);
  }

  // add a shaped part to a bone with a material key and colour
  part(bone, geo, mat, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    this.parts.push({ bone, geo, mat, color, x, y, z, rx, ry, rz });
  }
  glowPart(bone, geo, color, x, y, z) {
    const m = new THREE.Mesh(geo, glowMat(color, 1.6));
    m.position.set(x, y, z);
    bone.add(m);
  }

  // ---------------- body
  body(o, rng, look) {
    const { skin, top, legs, boots, gloves } = look;
    const P = this.pelvis, S = this.spine, H = this.head;
    const w = this.build * 1.07;
    // torso: waist, chest and shoulder line from a lathe profile, flattened front-to-back
    this.part(S, lathe([[0.001, -0.02], [0.13 * w, 0.0], [0.133 * w, 0.12], [0.158 * w, 0.28], [0.178 * w, 0.4], [0.19 * w, 0.46], [0.15, 0.52], [0.06, 0.56], [0.001, 0.565]], 14, 0.66), look.topMat || 'cloth', top);
    // hips
    this.part(P, lathe([[0.001, -0.13], [0.11 * w, -0.12], [0.145 * w, -0.04], [0.14 * w, 0.06], [0.13 * w, 0.1], [0.001, 0.11]], 12, 0.72), 'cloth', legs);
    // neck and head
    this.part(H, limb(0.048, 0.052, 0.09), 'skin', skin, 0, 0.07, 0);
    const head = ellipsoid(0.1, 0.122, 0.112, 14, 11);
    // shape the jaw: taper the lower half and push the chin forward a touch
    const hp = head.attributes.position;
    for (let i = 0; i < hp.count; i++) {
      const y = hp.getY(i);
      if (y < 0) { const t = -y / 0.122; hp.setX(i, hp.getX(i) * (1 - t * 0.22)); hp.setZ(i, hp.getZ(i) * (1 - t * 0.12) - t * 0.012); }
    }
    head.computeVertexNormals();
    this.part(H, head, 'skin', skin, 0, 0.14, 0);
    this.part(H, new THREE.ConeGeometry(0.018, 0.045, 5).rotateX(-Math.PI / 2 + 0.25), 'skin', skin, 0, 0.13, -0.115);
    for (const s of [-1, 1]) {
      this.part(H, ellipsoid(0.016, 0.03, 0.012, 6, 5), 'skin', skin, s * 0.1, 0.14, 0.005);
      this.part(H, ball(0.011, 6, 5), 'leather', 0x1a1410, s * 0.037, 0.155, -0.098);
      this.part(H, rbox(0.035, 0.008, 0.01), 'leather', look.hair, s * 0.037, 0.178, -0.1);
    }
    // arms
    for (const [sh, el, hand] of [[this.shL, this.elL, this.handL], [this.shR, this.elR, this.handR]]) {
      this.part(sh, ellipsoid(0.062, 0.058, 0.06, 9, 7), look.sleeveMat || 'cloth', look.sleeve ?? top, 0, -0.01, 0);
      this.part(sh, limb(0.058, 0.047, 0.29), look.sleeveMat || 'cloth', look.sleeve ?? top);
      this.part(el, ball(0.044), look.sleeveMat || 'cloth', look.sleeve ?? top);
      this.part(el, limb(0.049, 0.037, 0.26), look.forearmMat || 'skin', look.forearm ?? skin);
      this.part(hand, ellipsoid(0.04, 0.055, 0.022, 8, 6), gloves ? 'leather' : 'skin', gloves ?? skin, 0, -0.045, 0);
      this.part(hand, ellipsoid(0.013, 0.03, 0.013, 5, 4), gloves ? 'leather' : 'skin', gloves ?? skin, 0.032, -0.025, -0.014, 0, 0, 0.6);
    }
    // legs
    for (const [hip, kn] of [[this.hipL, this.knL], [this.hipR, this.knR]]) {
      this.part(hip, limb(0.09 * w, 0.064, 0.44), 'cloth', legs);
      this.part(kn, ball(0.056), 'cloth', legs);
      this.part(kn, limb(0.061, 0.044, 0.4), look.shinMat || 'cloth', look.shin ?? legs);
      const shoe = ellipsoid(0.052, 0.04, 0.115, 9, 6);
      shoe.translate(0, 0, -0.035);
      this.part(kn, shoe, 'leather', boots, 0, -0.425, 0);
    }
  }

  hair(rng, color, style) {
    const H = this.head;
    if (style === 'none') return;
    const cap = new THREE.SphereGeometry(0.112, 14, 9, 0, Math.PI * 2, 0, Math.PI * 0.6);
    this.part(H, cap, 'cloth', color, 0, 0.148, 0.004, 0.2);
    this.part(H, ellipsoid(0.104, 0.07, 0.06, 10, 6), 'cloth', color, 0, 0.13, 0.06);
    if (style === 'long') this.part(H, rbox(0.17, 0.2, 0.05), 'cloth', color, 0, 0.07, 0.085);
    if (style === 'beard') this.part(H, ellipsoid(0.075, 0.05, 0.05, 8, 6), 'cloth', color, 0, 0.065, -0.07);
    if (style === 'bun') this.part(H, ball(0.045), 'cloth', color, 0, 0.21, 0.08);
  }

  // ---------------- outfits
  dress(type, o, rng) {
    const pick = (a) => a[Math.floor(rng() * a.length)];
    const skin = pick(SKIN), hairC = pick(HAIR);
    const S = this.spine, P = this.pelvis, H = this.head;
    const hairStyles = ['short', 'short', 'long', 'beard', 'bun', 'none'];
    if (type === 'lancer' || type === 'officer') {
      const off = type === 'officer';
      const suit = off ? 0x1c1c22 : 0x2c3039, plate = off ? 0x2c2c34 : 0xd2d5dc, trim = off ? 0xc9a24a : 0xa3243a;
      this.body(o, rng, { skin, top: suit, legs: suit, boots: 0x15161a, gloves: 0x1c1c22, hair: hairC, forearmMat: 'cloth', forearm: suit });
      if (!off) {
        // armoured shell
        this.part(S, lathe([[0.15, 0.18], [0.185, 0.3], [0.195, 0.4], [0.18, 0.48], [0.11, 0.53]], 12, 0.74), 'plate', plate);
        this.part(S, rbox(0.3, 0.12, 0.06), 'plate', plate, 0, 0.1, -0.1);
        for (const [shb, s] of [[this.shL, -1], [this.shR, 1]]) {
          this.part(shb, new THREE.SphereGeometry(0.095, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), 'plate', plate, s * 0.01, 0.02, 0, 0, 0, s * -0.3);
          this.part(shb, limb(0.066, 0.06, 0.12), 'plate', plate, 0, -0.1, 0);
        }
        for (const kn of [this.knL, this.knR]) this.part(kn, limb(0.068, 0.054, 0.26), 'plate', plate, 0, -0.04, -0.008);
        for (const hp of [this.hipL, this.hipR]) this.part(hp, limb(0.096, 0.08, 0.2), 'plate', plate, 0, -0.04, 0);
        // helmet with a brow and a glowing visor slit
        const helm = ellipsoid(0.128, 0.145, 0.138, 14, 10);
        this.part(H, helm, 'plate', plate, 0, 0.15, 0.004);
        this.part(H, rbox(0.2, 0.05, 0.06), 'plate', 0x3a3e48, 0, 0.13, -0.11);
        this.part(H, rbox(0.12, 0.07, 0.05), 'plate', 0x3a3e48, 0, 0.06, -0.105);
        this.glowPart(H, new THREE.BoxGeometry(0.16, 0.022, 0.02), 0xff2a3a, 0, 0.135, -0.142);
        this.part(S, rbox(0.26, 0.3, 0.12, 0.04), 'cloth', 0x2a2e36, 0, 0.3, 0.17); // pack
        this.part(P, new THREE.TorusGeometry(0.135, 0.018, 6, 16).rotateX(Math.PI / 2).scale(1, 1, 0.75), 'leather', trim, 0, 0.06, 0);
      } else {
        this.hair(rng, hairC, 'short');
        this.part(H, new THREE.CylinderGeometry(0.115, 0.11, 0.07, 14), 'cloth', suit, 0, 0.235, 0.005);
        this.part(H, new THREE.CylinderGeometry(0.13, 0.13, 0.012, 14, 1, false, -Math.PI * 0.75, Math.PI * 1.5).scale(1, 1, 1.1), 'leather', 0x111114, 0, 0.205, -0.03);
        this.part(H, rbox(0.06, 0.03, 0.01), 'leather', trim, 0, 0.245, -0.115);
        this.part(S, rbox(0.33, 0.04, 0.03), 'leather', trim, 0, 0.36, -0.105);
        for (const shb of [this.shL, this.shR]) this.part(shb, rbox(0.12, 0.025, 0.1), 'leather', trim, 0, 0.06, 0);
        this.part(this.capeBone, rbox(0.4, 0.92, 0.025), 'cloth', 0x5a1520, 0, -0.45, 0.02);
        this.part(P, new THREE.TorusGeometry(0.135, 0.018, 6, 16).rotateX(Math.PI / 2).scale(1, 1, 0.75), 'leather', 0x111114, 0, 0.06, 0);
      }
      return;
    }
    if (type === 'player') {
      const accent = new THREE.Color(o.color || '#3fb6ff').getHex();
      const cls = o.cls || 'soldier';
      const looks = {
        warden: { top: 0x6b5644, legs: 0x4a3c30, boots: 0x2a1e16 },
        gunslinger: { top: 0x8a6a4a, legs: 0x3a3040, boots: 0x3a2416, gloves: 0x3a2416 },
        soldier: { top: 0x4a5040, legs: 0x3a4034, boots: 0x22241e, gloves: 0x2a2c26 },
        medic: { top: 0xd8d2c4, legs: 0x4a5058, boots: 0x2a2a2e, gloves: 0x6ac8a0 },
        spy: { top: 0x26222e, legs: 0x1e1c24, boots: 0x141218, gloves: 0x141218 },
      }[cls];
      this.body(o, rng, { skin, hair: hairC, ...looks, forearm: cls === 'spy' || cls === 'soldier' ? looks.top : undefined, forearmMat: cls === 'spy' || cls === 'soldier' ? 'cloth' : undefined });
      // crew colour: a scarf and a stripe so friends are readable at a distance
      this.part(H, new THREE.TorusGeometry(0.066, 0.02, 6, 14).rotateX(Math.PI / 2), 'cloth', accent, 0, 0.035, 0);
      this.part(S, rbox(0.036, 0.3, 0.012), 'cloth', accent, 0.09, 0.33, -0.116);
      this.part(P, new THREE.TorusGeometry(0.135, 0.02, 6, 16).rotateX(Math.PI / 2).scale(1, 1, 0.75), 'leather', 0x2a1e16, 0, 0.06, 0);
      if (cls === 'warden') {
        this.hair(rng, hairC, 'short');
        this.part(this.coatBone, lathe([[0.15, 0.04], [0.2, -0.2], [0.27, -0.55], [0.3, -0.72]], 12, 0.85), 'cloth', 0x5e4a38);
        this.part(H, new THREE.SphereGeometry(0.135, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), 'cloth', 0x4e3e30, 0, 0.13, 0.03, -0.35);
        this.part(S, rbox(0.06, 0.55, 0.012), 'cloth', 0x3a2a20, 0.02, 0.25, -0.118, 0, 0, 0.55);
        this.coatSwing = 0.6;
      } else if (cls === 'gunslinger') {
        this.hair(rng, hairC, 'long');
        this.part(H, new THREE.CylinderGeometry(0.29, 0.29, 0.018, 16), 'leather', 0x3a2a1e, 0, 0.23, 0);
        this.part(H, new THREE.CylinderGeometry(0.11, 0.125, 0.12, 12), 'leather', 0x3a2a1e, 0, 0.29, 0);
        this.part(this.coatBone, lathe([[0.15, 0.06], [0.19, -0.15], [0.22, -0.55], [0.24, -0.7]], 12, 0.8), 'cloth', 0x5a3e2a);
        this.part(S, lathe([[0.16, 0.2], [0.18, 0.4], [0.17, 0.48], [0.1, 0.53]], 12, 0.72), 'cloth', 0x5a3e2a);
        this.coatSwing = 0.7;
      } else if (cls === 'soldier') {
        this.part(H, new THREE.SphereGeometry(0.135, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), 'plate', 0x4a5040, 0, 0.15, 0.006);
        this.part(H, rbox(0.24, 0.02, 0.13), 'plate', 0x3a4034, 0, 0.17, -0.07);
        this.glowPart(H, new THREE.BoxGeometry(0.17, 0.025, 0.02), 0xffb04a, 0, 0.15, -0.135);
        this.part(S, lathe([[0.15, 0.16], [0.185, 0.3], [0.19, 0.42], [0.16, 0.5]], 12, 0.78), 'plate', 0x5a6250);
        this.part(S, rbox(0.3, 0.36, 0.14, 0.04), 'cloth', 0x3a3a30, 0, 0.3, 0.19);
        for (const x of [-0.1, 0, 0.1]) this.part(S, rbox(0.08, 0.1, 0.05), 'leather', 0x2e3228, x, 0.13, -0.13);
        for (const shb of [this.shL, this.shR]) this.part(shb, new THREE.SphereGeometry(0.085, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), 'plate', 0x5a6250, 0, 0.02, 0);
      } else if (cls === 'medic') {
        this.hair(rng, hairC, pick(['short', 'bun', 'long']));
        this.part(this.shL, limb(0.064, 0.064, 0.08), 'cloth', 0xe8e2d4, 0, -0.06, 0);
        this.glowPart(this.shL, new THREE.BoxGeometry(0.03, 0.08, 0.02), 0x4ae0a0, 0, -0.1, -0.062);
        this.glowPart(this.shL, new THREE.BoxGeometry(0.03, 0.03, 0.08), 0x4ae0a0, -0.062, -0.1, 0);
        this.part(P, rbox(0.15, 0.18, 0.11, 0.03), 'leather', 0x7a5a3a, 0.21, -0.08, 0.06);
        this.part(S, rbox(0.03, 0.55, 0.012), 'leather', 0x7a5a3a, -0.02, 0.27, -0.118, 0, 0, -0.6);
        this.part(S, rbox(0.03, 0.55, 0.012), 'leather', 0x7a5a3a, -0.02, 0.27, 0.118, 0, 0, 0.6);
      } else if (cls === 'spy') {
        this.part(H, new THREE.SphereGeometry(0.13, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.64), 'cloth', 0x1e1c24, 0, 0.13, 0.025, -0.3);
        this.part(H, rbox(0.16, 0.08, 0.04), 'cloth', 0x1e1c24, 0, 0.07, -0.095);
        this.glowPart(H, new THREE.BoxGeometry(0.15, 0.03, 0.02), 0x6aff9a, 0, 0.155, -0.113);
        this.part(S, rbox(0.1, 0.12, 0.08), 'plate', 0x3a4048, 0.15, 0.08, 0.13);
      }
      return;
    }
    // townsfolk, merchants, the prisoner
    const robe = pick(ROBES), accent = pick(ACCENTS);
    if (type === 'prisoner') {
      this.body(o, rng, { skin, top: 0xc4682e, legs: 0xb35d2a, boots: 0x2a221c, hair: hairC, sleeve: 0xc4682e });
      this.hair(rng, 0x1a1210, 'bun');
      this.part(P, new THREE.TorusGeometry(0.135, 0.016, 6, 16).rotateX(Math.PI / 2).scale(1, 1, 0.75), 'leather', 0x3a2a20, 0, 0.06, 0);
      return;
    }
    this.body(o, rng, { skin, top: robe, legs: pick(ROBES), boots: 0x3a2c22, hair: hairC });
    const style = pick(hairStyles);
    if (rng() < 0.45) this.part(H, new THREE.SphereGeometry(0.13, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), 'cloth', robe, 0, 0.13, 0.03, -0.35);
    else { this.hair(rng, hairC, style); if (rng() < 0.4) this.part(H, new THREE.TorusGeometry(0.105, 0.025, 6, 14).rotateX(Math.PI / 2), 'cloth', accent, 0, 0.215, 0); }
    this.part(this.coatBone, lathe([[0.14, 0.05], [0.2, -0.2], [0.26, -0.5], [0.28, -0.66]], 12, 0.85), 'cloth', robe);
    this.part(S, rbox(0.05, 0.5, 0.012), 'cloth', accent, -0.02, 0.26, -0.117, 0, 0, -0.5);
    this.coatSwing = 0.5;
    if (type === 'merchant') { this.part(S, rbox(0.3, 0.5, 0.03), 'leather', 0x6e4a30, 0, 0.18, -0.11); this.root.scale.setScalar(1.05); }
    if (type === 'bartender') this.part(S, rbox(0.3, 0.5, 0.03), 'cloth', 0xd8d0c0, 0, 0.18, -0.11);
    if (type === 'informant') this.part(H, new THREE.CylinderGeometry(0.17, 0.17, 0.015, 14), 'leather', 0x3a2a20, 0, 0.24, 0);
  }

  // ---------------- bake all parts into skinned meshes (one per material)
  bake() {
    this.root.updateMatrixWorld(true);
    const groups = new Map();
    const m = new THREE.Matrix4(), e = new THREE.Euler(), q = new THREE.Quaternion(), c = new THREE.Color();
    for (const p of this.parts) {
      let g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      if (!g.attributes.normal) g.computeVertexNormals();
      e.set(p.rx, p.ry, p.rz); q.setFromEuler(e);
      m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(1, 1, 1));
      m.premultiply(p.bone.matrixWorld);
      g.applyMatrix4(m);
      const n = g.attributes.position.count;
      const bi = this.bones.indexOf(p.bone);
      const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), col = new Float32Array(n * 3);
      c.setHex(p.color);
      for (let i = 0; i < n; i++) { si[i * 4] = bi; sw[i * 4] = 1; col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
      g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      if (!groups.has(p.mat)) groups.set(p.mat, []);
      groups.get(p.mat).push(g);
    }
    this.skeleton = new THREE.Skeleton(this.bones);
    this.meshes = [];
    const M = mats();
    for (const [key, list] of groups) {
      const geo = mergeGeometries(list, false);
      const sm = new THREE.SkinnedMesh(geo, M[key]);
      sm.castShadow = true;
      sm.receiveShadow = true;
      sm.frustumCulled = false; // skinned bounds follow the animation, not the bind pose
      this.root.add(sm);
      sm.bind(this.skeleton, new THREE.Matrix4());
      this.meshes.push(sm);
    }
    this.parts = null;
  }

  // ---------------- weapons and holsters
  arm(type, o) {
    const cls = o.cls || 'soldier';
    this.cls = cls;
    this.weaponKind = type === 'player' ? ({ warden: 'blade', gunslinger: 'pistols', soldier: 'blaster', medic: 'pistol', spy: 'knives' }[cls]) : (type === 'lancer' || type === 'officer' ? 'blaster' : null);
    this.slots = [];
    const slot = (obj, hand, hp, hr, mount, mp, mr) => { this.slots.push({ obj, hand, hp, hr, mount, mp, mr }); };
    if (this.weaponKind === 'blaster') {
      this.rifle = makeRifle();
      slot(this.rifle, this.handR, [0, -0.04, -0.02], [-Math.PI / 2, 0, 0], this.mBack, [0, 0, 0], [0, 0, 0]);
    }
    if (this.weaponKind === 'pistols' || this.weaponKind === 'pistol') {
      this.pistolR = makePistol();
      slot(this.pistolR, this.handR, [0, -0.06, -0.01], [-Math.PI / 2, 0, 0], this.mHipR, [0, 0, 0], [0, 0, 0]);
      if (this.weaponKind === 'pistols') { this.pistolL = makePistol(); slot(this.pistolL, this.handL, [0, -0.06, -0.01], [-Math.PI / 2, 0, 0], this.mHipL, [0, 0, 0], [0, 0, 0]); }
    }
    if (this.weaponKind === 'knives') {
      this.knifeR = makeKnife(); this.knifeL = makeKnife();
      slot(this.knifeR, this.handR, [0, -0.05, 0], [-Math.PI / 2 - 0.3, 0, 0], this.mSheathR, [0, 0, 0], [0, 0, 0]);
      slot(this.knifeL, this.handL, [0, -0.05, 0], [Math.PI / 2 + 0.6, 0, 0], this.mSheathL, [0, 0, 0], [0, 0, 0]);
    }
    if (this.weaponKind === 'blade') {
      this.blade = makeBlade(o.bladeColor || '#4fc8ff');
      slot(this.blade, this.handR, [0, -0.03, 0], [-Math.PI / 2, 0, 0], this.pelvis, [-0.2, 0.0, -0.06], [0, 0, 0.3]);
    }
    for (const s of this.slots) s.obj.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  }

  setDrawn(drawn, instant) {
    if (drawn === this.drawn && !instant) return;
    if (!instant) this.drawT = 0;
    this.drawn = drawn;
    for (const s of this.slots) {
      const [parent, p, r] = drawn ? [s.hand, s.hp, s.hr] : [s.mount, s.mp, s.mr];
      parent.add(s.obj);
      s.obj.position.set(...p);
      s.obj.rotation.set(...r);
    }
    if (this.blade) this.blade.userData.beam.visible = drawn;
  }

  setShroud(on, opacity = 0.16) {
    if (on === this._shroud && opacity === this._shroudOp) return;
    this._shroud = on;
    this._shroudOp = opacity;
    if (on && !this.shroudMats) {
      this.shroudMats = this.meshes.map(() => new THREE.MeshStandardMaterial({ color: 0x8fb8d8, transparent: true, opacity, roughness: 0.2, metalness: 0.6, emissive: 0x2a4a6a, emissiveIntensity: 0.6, depthWrite: false }));
    }
    this.meshes.forEach((m, i) => {
      if (!m.userData.origMat) m.userData.origMat = m.material;
      if (on) { this.shroudMats[i].opacity = opacity; m.material = this.shroudMats[i]; m.castShadow = false; }
      else { m.material = m.userData.origMat; m.castShadow = true; }
    });
    for (const s of this.slots) s.obj.visible = !on || opacity > 0.12;
  }

  bladeWorld(base, tip) {
    if (!this.blade || !this.drawn) return false;
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

  // ---------------- animation
  // s: {speed, crouch, sit, pitch, weapon, drawn, block, swing, downed, dead, driving, talk, work, flee, stagger, air, aim, lowReady, cower}
  update(dt, s, t) {
    if (s.drawn !== undefined && s.drawn !== this.drawn) this.setDrawn(s.drawn);
    this.drawT += dt;
    const sp = s.speed || 0;
    const moving = sp > 0.35;
    this.blendCrouch = lerp(this.blendCrouch, s.crouch || s.sit ? 1 : 0, Math.min(1, dt * 10));
    const cr = this.blendCrouch;
    this.phase += dt * (moving ? sp * (s.crouch ? 2.6 : 1.55) : 0);
    const amp = moving ? clamp(sp / 5, 0.25, 1) * (sp > 7 ? 0.95 : 0.65) * (s.crouch ? 0.7 : 1) : 0;
    const sw = Math.sin(this.phase), cw = Math.cos(this.phase);
    const R = this.rootBone;
    const breathe = Math.sin(t * 1.7) * 0.012;
    if (this.blade) { this.bladeOn = this.drawn ? Math.min(1, this.bladeOn + dt * 6) : 0; this.blade.userData.beam.scale.y = Math.max(0.001, this.bladeOn); }
    if (s.dead) {
      if (this.deadT < 0) { this.deadT = 0; this.deadDir = Math.random() < 0.5 ? 1 : -1; }
      this.deadT += dt;
      const f = clamp(this.deadT / 0.55, 0, 1), ease = f * f;
      R.rotation.x = this.deadDir * 1.5 * ease;
      this.pelvis.position.y = lerp(0.95, 0.25, ease);
      this.shL.rotation.set(-1.2 * ease, 0, -0.6 * ease); this.shR.rotation.set(-1.0 * ease, 0, 0.7 * ease);
      this.hipL.rotation.x = 0.4 * ease; this.hipR.rotation.x = -0.2 * ease;
      this.knL.rotation.x = -0.4 * ease; this.knR.rotation.x = -0.2;
      this.spine.rotation.set(0, 0, 0); this.head.rotation.set(0.3 * ease * this.deadDir, 0.4 * ease, 0);
      return;
    }
    this.deadT = -1;
    if (s.downed) {
      R.rotation.x = lerp(R.rotation.x, 1.35, Math.min(1, dt * 6));
      this.pelvis.position.y = 0.28;
      this.shL.rotation.set(0.4 + Math.sin(t * 2) * 0.1, 0, -0.3); this.shR.rotation.set(1.2, 0, 0.6);
      this.elR.rotation.x = 1.4; this.elL.rotation.x = 0.3;
      this.hipL.rotation.x = 0.5; this.knL.rotation.x = -0.9; this.hipR.rotation.x = 0.1; this.knR.rotation.x = -0.2;
      this.head.rotation.set(0.5, 0, 0);
      return;
    }
    R.rotation.x = lerp(R.rotation.x, 0, Math.min(1, dt * 8));
    if (s.driving) {
      this.pelvis.position.y = 0.5;
      this.hipL.rotation.set(1.5, 0, -0.15); this.hipR.rotation.set(1.5, 0, 0.15);
      this.knL.rotation.x = -1.6; this.knR.rotation.x = -1.6;
      this.spine.rotation.set(-0.35, 0, 0);
      this.shL.rotation.set(1.1, 0, 0.2); this.shR.rotation.set(1.1, 0, -0.2);
      this.elL.rotation.x = 0.4; this.elR.rotation.x = 0.4;
      this.head.rotation.set(0.35, 0, 0);
      this.coatBone.rotation.x = -1.2;
      return;
    }
    // legs and hips
    this.pelvis.position.y = lerp(0.95, s.sit ? 0.5 : 0.62, cr) + (moving ? Math.abs(cw) * 0.04 * amp : 0);
    this.pelvis.rotation.y = moving ? sw * 0.08 * amp : 0;
    const crouchHip = s.sit ? 1.45 : 1.05;
    this.hipL.rotation.set(sw * amp + cr * crouchHip, 0, -0.03);
    this.hipR.rotation.set(-sw * amp + cr * crouchHip, 0, 0.03);
    this.knL.rotation.x = -Math.max(0, -cw) * amp * 1.3 - cr * (s.sit ? 1.45 : 1.75);
    this.knR.rotation.x = -Math.max(0, cw) * amp * 1.3 - cr * (s.sit ? 1.45 : 1.75);
    if (s.air) { this.hipL.rotation.x = 0.6; this.knL.rotation.x = -1.0; this.hipR.rotation.x = -0.2; this.knR.rotation.x = -0.5; }
    let lean = -cr * (s.sit ? 0.05 : 0.45) - (sp > 7 ? 0.18 : moving ? 0.06 : 0);
    if (s.flee) lean -= 0.2;
    this.spine.rotation.set(lean + breathe, -this.pelvis.rotation.y * 0.8, moving ? sw * 0.04 : 0);
    this.spine.position.y = 0.08 + breathe;
    const pitch = s.pitch || 0;
    this.head.rotation.set(clamp(pitch * 0.6, -0.5, 0.5) - lean * 0.6, 0, 0);
    // coats and capes trail the legs
    const cs = this.coatSwing || 0;
    this.coatBone.rotation.x = -cr * 1.0 + (moving ? -0.1 * amp : 0) * cs;
    this.coatBone.scale.y = 1 - cr * 0.25;
    this.capeBone.rotation.x = 0.08 + (moving ? 0.25 * amp : 0) + Math.sin(t * 2) * 0.03;
    // arms
    const weapon = s.weapon;
    const armed = this.drawn && weapon && !s.stagger;
    if (s.swing !== undefined && s.swing !== this.lastSwing) { this.lastSwing = s.swing; this.swingT = 0; this.swingVar = (this.swingVar + 1) % 3; }
    this.swingT += dt;
    this.handR.rotation.set(0, 0, 0); this.handL.rotation.set(0, 0, 0);
    this.head.rotation.y = 0;
    const idleArms = () => {
      this.shL.rotation.set(-sw * amp * 0.8 + 0.05, 0, -0.1);
      this.shR.rotation.set(sw * amp * 0.8 + 0.05, 0, 0.1);
      this.elL.rotation.x = 0.25 + (moving ? 0.25 : 0); this.elR.rotation.x = 0.25 + (moving ? 0.25 : 0);
    };
    if (!armed) {
      idleArms();
      if (s.talk) { this.shR.rotation.set(0.7 + Math.sin(t * 3.1) * 0.35, 0, -0.2 + Math.sin(t * 2.3) * 0.2); this.elR.rotation.x = 1.0 + Math.sin(t * 4) * 0.3; this.head.rotation.y = Math.sin(t * 0.9) * 0.2; }
      if (s.work) {
        this.shL.rotation.set(0.9 + Math.sin(t * 2.2) * 0.15, 0, 0.2); this.elL.rotation.x = 0.9;
        this.shR.rotation.set(0.9 + Math.cos(t * 2.2) * 0.15, 0, -0.2); this.elR.rotation.x = 0.9;
        this.head.rotation.x = -0.35; this.spine.rotation.x -= 0.15;
      }
      if (s.flee) { this.shL.rotation.set(2.6, 0, -0.3); this.shR.rotation.set(2.6, 0, 0.3); this.elL.rotation.x = 1.2; this.elR.rotation.x = 1.2; }
      if (s.cower) { this.shL.rotation.set(2.2, 0, 0.5); this.shR.rotation.set(2.2, 0, -0.5); this.elL.rotation.x = 1.9; this.elR.rotation.x = 1.9; this.head.rotation.x = -0.5; }
      // reaching for the holster right after holstering
      if (this.drawT < 0.3 && weapon) { const k = Math.sin((this.drawT / 0.3) * Math.PI); this.shR.rotation.x -= k * 0.6; this.elR.rotation.x += k * 0.8; }
    } else if (weapon === 'blaster') {
      if (s.lowReady) {
        this.shR.rotation.set(0.6 + sw * amp * 0.1, 0, 0.1); this.elR.rotation.x = 0.4; this.handR.rotation.set(-0.6, 0, 0);
        this.shL.rotation.set(0.75, 0, 0.75); this.elL.rotation.x = 0.95;
      } else {
        const a = s.aim ? 1 : 0.85;
        this.shR.rotation.set(Math.PI / 2 * a + pitch * a, 0, 0.05); this.elR.rotation.set(0.15, 0, 0);
        this.shL.rotation.set(Math.PI / 2 * a + pitch * a - 0.05, 0, 0.8); this.elL.rotation.set(0.6, 0, 0);
        this.spine.rotation.y = -0.25; this.head.rotation.y = 0.25;
      }
    } else if (weapon === 'pistols' || weapon === 'pistol') {
      const kick = Math.max(0, 0.15 - this.swingT) * 2;
      this.shR.rotation.set(Math.PI / 2 + pitch + kick, 0, weapon === 'pistols' ? -0.12 : 0.02); this.elR.rotation.set(0.05, 0, 0);
      if (weapon === 'pistols') { this.shL.rotation.set(Math.PI / 2 + pitch + kick * 0.6, 0, 0.12); this.elL.rotation.set(0.05, 0, 0); }
      else { this.shL.rotation.set(-sw * amp * 0.6 + 0.1, 0, -0.1); this.elL.rotation.x = 0.4; }
      this.spine.rotation.y = weapon === 'pistol' ? -0.2 : 0; this.head.rotation.y = weapon === 'pistol' ? 0.2 : 0;
    } else if (weapon === 'knives') {
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
      const st = this.swingT / 0.42;
      if (st < 1) {
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
    }
    if (armed && this.drawT < 0.25) { const k = 1 - this.drawT / 0.25; this.shR.rotation.x -= k * 0.7; }
    if (s.stagger) {
      this.spine.rotation.x += 0.5;
      this.shL.rotation.set(-0.8, 0, -1.0); this.shR.rotation.set(-0.8, 0, 1.0);
    }
  }
}
