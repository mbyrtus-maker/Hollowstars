// Characters built on the Quaternius Universal Base Characters and animated with the Universal
// Animation Library (both CC0). The outfits, armour and class looks still come from the
// procedural dresser in humanoid.js: its "bones" become virtual bones that ride on the
// asset skeleton, so every class, advanced class and branch keeps its look. Bare bodies
// are clothed by a shader that paints shirt, sleeves, trousers, gloves and boots onto the
// skin by body region.
import * as THREE from 'three';
import { Humanoid } from './humanoid.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Assets } from './assets.js';
import { clamp, lerp, mulberry32, smoothstep } from '../../shared/math.js';

const BODY = { m: 'Superhero_Male_FullBody', f: 'Superhero_Female_FullBody' };
const HAIR = {
  m: { short: ['Hair_SimpleParted', 'Hair_Buzzed'], long: ['Hair_Long'], beard: ['Hair_Buzzed', 'Hair_Beard'], bun: ['Hair_Buns'] },
  f: { short: ['Hair_BuzzedFemale', 'Hair_Buns'], long: ['Hair_Long'], beard: ['Hair_Long'], bun: ['Hair_Buns'] },
};
// nominal ground speed of each locomotion clip (m/s), used to keep feet from skating
const GAIT = { Walk_Loop: 1.45, Jog_Fwd_Loop: 3.7, Sprint_Loop: 6.4, Crouch_Fwd_Loop: 1.6, Walk_Formal_Loop: 1.3 };
// where the first foot lands in each locomotion clip (fraction of the loop; the other lands half a loop
// later), measured from the clips' foot heights, so footstep sounds land with the feet
const STEP0 = { Walk_Loop: -0.016, Jog_Fwd_Loop: 0.016, Sprint_Loop: 0, Crouch_Fwd_Loop: -0.016, Walk_Formal_Loop: -0.023 };

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), m1 = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0), RIGHT = new THREE.Vector3(1, 0, 0), DOWN = new THREE.Vector3(0, -1, 0);

export const assetsReady = () => Assets.ready && Assets.has(BODY.m) && !!Assets.clip('Idle_Loop');

// ------------------------------------------------------------------ clothing shader

// body region per vertex from the bind pose: 0 head, 1 torso, 2 upper arm, 3 forearm, 4 hand, 5 leg
function regions(geo) {
  if (geo.userData.hsRegion) return geo.userData.hsRegion;
  const p = geo.attributes.position;
  geo.computeBoundingBox();
  const H = geo.boundingBox.max.y;
  const a = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = Math.abs(p.getX(i)), y = p.getY(i) / H;
    let r;
    if (y > 0.848 && x < 0.16 * H) r = 0;
    else if (x > 0.372 * H) r = 4;
    else if (x > 0.252 * H) r = 3;
    else if (x > 0.118 * H && y > 0.72) r = 2;
    else if (y < 0.535) r = 5;
    else r = 1;
    a[i * 2] = r; a[i * 2 + 1] = y;
  }
  const attr = new THREE.BufferAttribute(a, 2);
  geo.setAttribute('aRegion', attr);
  geo.userData.hsRegion = attr;
  return attr;
}

function clothedMaterial(base, skinTex) {
  const m = base.clone();
  if (skinTex) m.map = skinTex;
  m.normalScale = new THREE.Vector2(0.8, 0.8);
  const u = {
    uCloth: { value: Array.from({ length: 6 }, () => new THREE.Color()) },
    uCover: { value: [0, 0, 0, 0, 0, 0] },
    uBoot: { value: 0.12 },
    uBootCol: { value: new THREE.Color(0x2a221c) },
  };
  m.userData.cloth = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aRegion;\nvarying vec2 vRegion;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRegion = aRegion;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uCloth[6];\nuniform float uCover[6];\nuniform float uBoot;\nuniform vec3 uBootCol;\nvarying vec2 vRegion;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        int hsR = int(vRegion.x + 0.5);
        float hsCov = uCover[hsR];
        vec3 hsCol = uCloth[hsR];
        if (hsR == 5 && vRegion.y < uBoot) { hsCov = 1.0; hsCol = uBootCol; }
        // keep a little of the body's shading so folds and muscle still read through the cloth
        float hsShade = clamp(dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11)) * 1.6 + 0.35, 0.75, 1.1);
        diffuseColor.rgb = mix(diffuseColor.rgb, hsCol * hsShade, hsCov);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.88, hsCov);')
      .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale * (1.0 - 0.8 * hsCov);'));
  };
  m.customProgramCacheKey = () => 'hs-clothed';
  return m;
}

// ------------------------------------------------------------------ the character

export class AssetHumanoid extends Humanoid {
  // ---------------- rig: the asset skeleton plus virtual bones where the procedural rig had joints
  buildRig(rng, o) {
    this.bones = [];
    this.assetMeshes = [];
    this.ab = {};
    const pr = mulberry32(((o.variant || 1) * 9301 + 49297) >>> 0);
    this.pr = pr;
    this.sex = this.type === 'lancer' ? (pr() < 0.25 ? 'f' : 'm') : pr() < 0.5 ? 'f' : 'm';
    this.build = 1;
    const body = Assets.instance(BODY[this.sex]);
    body.rotation.y = Math.PI; // the packs face +Z; the game faces -Z
    this.asset = body;
    this.root.add(body);
    body.traverse((n) => {
      if (n.isBone || (n.name && !this.ab[n.name] && !n.isMesh)) this.ab[n.name] = n;
      if (n.isSkinnedMesh) { this.assetMeshes.push(n); n.frustumCulled = false; n.castShadow = true; n.receiveShadow = true; }
    });
    this.armature = this.ab.root ? this.ab.root.parent : body;
    // clothe the body mesh (the largest one); eyes and brows keep their materials
    this.bodyMesh = this.assetMeshes.reduce((a, b) => (b.geometry.attributes.position.count > a.geometry.attributes.position.count ? b : a));
    regions(this.bodyMesh.geometry);
    this.root.updateMatrixWorld(true);
    const W = (n) => new THREE.Vector3().setFromMatrixPosition(this.ab[n].matrixWorld);
    const hold = (name, bone, pos, quat = new THREE.Quaternion(), scale = new THREE.Vector3(1, 1, 1)) => {
      const hb = new THREE.Bone();
      hb.name = 'hs_' + name;
      const parent = this.ab[bone];
      parent.add(hb);
      m1.copy(parent.matrixWorld).invert().multiply(new THREE.Matrix4().compose(pos, quat, scale));
      m1.decompose(hb.position, hb.quaternion, hb.scale);
      hb.updateMatrixWorld(true);
      this.bones.push(hb);
      return hb;
    };
    const limbQ = (a, b) => new THREE.Quaternion().setFromUnitVectors(DOWN, v1.copy(W(b)).sub(W(a)).normalize());
    const len = (a, b) => W(a).distanceTo(W(b));
    const pel = W('pelvis'), neck = W('neck_01'), head = W('Head');
    const shoulderX = Math.abs(W('upperarm_l').x);
    this.rootBone = hold('root', 'root', new THREE.Vector3(0, 0, 0));
    this.pelvis = hold('pelvis', 'pelvis', pel, undefined, new THREE.Vector3(1.15, 1, 1.3));
    const spineAt = new THREE.Vector3(0, pel.y + 0.08, pel.z * 0.5);
    this.spine = hold('spine', 'spine_02', spineAt, undefined, new THREE.Vector3(shoulderX / 0.185 * 1.06, (neck.y - spineAt.y) / 0.56, 1.32));
    this.head = hold('head', 'Head', new THREE.Vector3(0, head.y + 0.1 - 0.14, head.z + 0.012), undefined, new THREE.Vector3(1.06, 1.04, 1.08));
    this.shL = hold('shL', 'upperarm_l', W('upperarm_l'), limbQ('upperarm_l', 'lowerarm_l'), new THREE.Vector3(1.18, len('upperarm_l', 'lowerarm_l') / 0.29, 1.18));
    this.shR = hold('shR', 'upperarm_r', W('upperarm_r'), limbQ('upperarm_r', 'lowerarm_r'), new THREE.Vector3(1.18, len('upperarm_r', 'lowerarm_r') / 0.29, 1.18));
    this.elL = hold('elL', 'lowerarm_l', W('lowerarm_l'), limbQ('lowerarm_l', 'hand_l'), new THREE.Vector3(1.12, len('lowerarm_l', 'hand_l') / 0.27, 1.12));
    this.elR = hold('elR', 'lowerarm_r', W('lowerarm_r'), limbQ('lowerarm_r', 'hand_r'), new THREE.Vector3(1.12, len('lowerarm_r', 'hand_r') / 0.27, 1.12));
    this.handL = hold('handL', 'hand_l', W('hand_l'), limbQ('lowerarm_l', 'hand_l'));
    this.handR = hold('handR', 'hand_r', W('hand_r'), limbQ('lowerarm_r', 'hand_r'));
    this.hipL = hold('hipL', 'thigh_l', W('thigh_l'), limbQ('thigh_l', 'calf_l'), new THREE.Vector3(1.18, len('thigh_l', 'calf_l') / 0.44, 1.18));
    this.hipR = hold('hipR', 'thigh_r', W('thigh_r'), limbQ('thigh_r', 'calf_r'), new THREE.Vector3(1.18, len('thigh_r', 'calf_r') / 0.44, 1.18));
    this.knL = hold('knL', 'calf_l', W('calf_l'), limbQ('calf_l', 'foot_l'), new THREE.Vector3(1.05, len('calf_l', 'foot_l') / 0.425, 1.05));
    this.knR = hold('knR', 'calf_r', W('calf_r'), limbQ('calf_r', 'foot_r'), new THREE.Vector3(1.05, len('calf_r', 'foot_r') / 0.425, 1.05));
    const child = (parent, name, x, y, z) => { const b = new THREE.Bone(); b.name = 'hs_' + name; b.position.set(x, y, z); parent.add(b); this.bones.push(b); return b; };
    this.coatBone = child(this.pelvis, 'coat', 0, -0.02, 0);
    this.capeBone = child(this.spine, 'cape', 0, 0.5, 0.13);
    // weapon mounts, as on the procedural rig
    this.mBack = new THREE.Group(); this.mBack.position.set(0.02, 0.3, 0.21); this.mBack.rotation.set(Math.PI / 2, 0, 0.65); this.spine.add(this.mBack);
    this.mHipR = new THREE.Group(); this.mHipR.position.set(0.22, -0.06, 0.03); this.mHipR.rotation.set(-Math.PI / 2 + 0.15, 0, 0); this.pelvis.add(this.mHipR);
    this.mHipL = new THREE.Group(); this.mHipL.position.set(-0.22, -0.06, 0.03); this.mHipL.rotation.set(-Math.PI / 2 + 0.15, 0, 0); this.pelvis.add(this.mHipL);
    this.mSheathR = new THREE.Group(); this.mSheathR.position.set(0.2, 0.0, -0.01); this.mSheathR.rotation.set(0.12, 0, Math.PI - 0.12); this.pelvis.add(this.mSheathR);
    this.mSheathL = new THREE.Group(); this.mSheathL.position.set(-0.2, 0.0, -0.01); this.mSheathL.rotation.set(0.12, 0, -Math.PI + 0.12); this.pelvis.add(this.mSheathL);
  }

  // ---------------- the body itself comes from the asset; this only decides what it wears
  body(o, rng, look) {
    this.look = look;
    const lum = (hex) => { const c = new THREE.Color(hex); return c.r * 0.3 + c.g * 0.59 + c.b * 0.11; };
    const dark = lum(look.skin) < 0.22;
    const tex = dark ? null : Assets.textures.get(this.sex === 'f' ? 'skin_female_light' : 'skin_male_light');
    const mat = clothedMaterial(this.bodyMesh.material, tex);
    // a light tint toward the chosen skin tone gives more than two complexions
    const tone = new THREE.Color(look.skin);
    const ref = new THREE.Color(dark ? 0x7a5038 : 0xd9a888);
    mat.color.setRGB(clamp(0.55 + 0.45 * tone.r / ref.r, 0.6, 1.25), clamp(0.55 + 0.45 * tone.g / ref.g, 0.6, 1.25), clamp(0.55 + 0.45 * tone.b / ref.b, 0.6, 1.25));
    const u = mat.userData.cloth;
    const set = (i, hex, cov = 1) => { if (hex == null) { u.uCover.value[i] = 0; return; } u.uCloth.value[i].setHex(hex); u.uCover.value[i] = cov; };
    set(1, look.top);
    set(2, look.sleeve ?? look.top);
    set(3, (look.forearmMat === 'cloth' || look.forearm != null && look.forearmMat !== 'skin') ? (look.forearm ?? look.top) : null);
    set(4, look.gloves ?? null);
    set(5, look.legs);
    u.uBoot.value = look.boots != null ? (this.type === 'lancer' || this.type === 'officer' ? 0.2 : 0.14 + this.pr() * 0.08) : 0.04;
    u.uBootCol.value.setHex(look.boots ?? 0x2a221c);
    this.bodyMesh.material = mat;
  }

  // ---------------- fitting the procedural dresser's pieces to the pack head and arms
  // crew colour as an armband on the left upper arm instead of a ring around the neck
  crewMark(color) {
    this.part(this.shL, new THREE.CylinderGeometry(0.06, 0.057, 0.075, 16, 1, true), 'cloth', color, 0, -0.1, 0);
  }

  part(bone, geo, mat, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    // hoods and caps were shaped for the procedural head; the pack head is taller with the face set
    // further back, so they would sit over the eyes. Lift them, open the face and give them room.
    // (only open caps: full spheres are helmets and ellipsoids, and keep their own shape)
    const cap = geo.type === 'SphereGeometry' && geo.parameters.radius < 0.3 && geo.parameters.thetaLength >= Math.PI * 0.49 && geo.parameters.thetaLength < Math.PI * 0.9;
    if (bone === this.head && cap) {
      const r = geo.parameters.radius;
      if (geo.parameters.thetaLength > Math.PI * 0.55) {
        // a hood: a crown, then sides and back that fall to the collar with the face left open
        const face = 1.05; // half-width of the opening, radians around the head
        const crown = new THREE.SphereGeometry(r, 14, 4, 0, Math.PI * 2, 0, Math.PI * 0.3);
        const sides = new THREE.SphereGeometry(r, 14, 6, Math.PI * 1.5 + face, Math.PI * 2 - face * 2, Math.PI * 0.3, Math.PI * 0.46);
        const outer = mergeGeometries([crown.toNonIndexed(), sides.toNonIndexed()]).scale(1.16, 1.16, 1.18);
        // and a lining facing inward, so the inside of the hood isn't see-through around the face
        const inner = outer.clone().scale(0.97, 0.97, 0.97);
        const ip = inner.attributes.position, iu = inner.attributes.uv;
        for (let i = 0; i < ip.count; i += 3) {
          for (const att of [ip, iu]) {
            if (!att) continue;
            for (let k = 0; k < att.itemSize; k++) { const t = att.array[(i + 1) * att.itemSize + k]; att.array[(i + 1) * att.itemSize + k] = att.array[(i + 2) * att.itemSize + k]; att.array[(i + 2) * att.itemSize + k] = t; }
          }
        }
        geo = mergeGeometries([outer, inner]);
        geo.computeVertexNormals();
        y += 0.04; z += 0.03; rx = -0.12;
      } else {
        geo = geo.clone().scale(1.14, 1.12, 1.14);
        y += 0.05; z += 0.012; rx += -0.12;
      }
    }
    super.part(bone, geo, mat, color, x, y, z, rx, ry, rz);
  }

  // ---------------- hair from the pack, rebound onto this character's skeleton
  hair(rng, color, style) {
    if (style === 'none') return;
    const names = (HAIR[this.sex][style] || HAIR[this.sex].short);
    const list = style === 'short' ? [names[Math.floor(this.pr() * names.length)]] : names;
    for (const n of list) {
      const h = Assets.instance(n);
      if (!h) continue;
      h.updateMatrixWorld(true);
      h.traverse((o) => {
        if (!o.isSkinnedMesh) return;
        const bones = o.skeleton.bones.map((b) => this.ab[b.name] || b);
        const skel = new THREE.Skeleton(bones, o.skeleton.boneInverses);
        const mesh = new THREE.SkinnedMesh(o.geometry, o.material.clone());
        mesh.material.color.setHex(color).multiplyScalar(1.9);
        mesh.castShadow = true; mesh.frustumCulled = false;
        this.armature.add(mesh);
        mesh.bind(skel, o.bindMatrix);
        this.assetMeshes.push(mesh);
      });
    }
  }

  bake() {
    // procedural parts become one skinned mesh per material on the virtual bones
    this.asset.visible = true;
    super.bake();
    this.meshes = [...this.meshes, ...this.assetMeshes];
    this.mixer = new THREE.AnimationMixer(this.asset);
    this.rest = new Map();
    this.touched = new Map();
    for (const b of Object.values(this.ab)) if (b.isBone) this.rest.set(b, b.quaternion.clone());
    this.layer = { lower: { a: null, name: '' }, upper: { a: null, name: '' } };
    this.play('Idle_Loop', 'lower', 0);
    this.play('Idle_Loop', 'upper', 0);
  }

  // ---------------- animation
  play(name, layer, fade = 0.22, opts = {}) {
    const L = this.layer[layer];
    if (L.name === name && !opts.restart) {
      if (opts.ts != null) L.a.timeScale = opts.ts;
      return L.a;
    }
    const clip = Assets.half(name, layer === 'upper');
    if (!clip) return null;
    const a = this.mixer.clipAction(clip);
    a.reset();
    a.setLoop(opts.once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = !!opts.once;
    a.timeScale = opts.ts ?? 1;
    if (opts.at != null) a.time = opts.at * clip.duration;
    a.enabled = true;
    a.setEffectiveWeight(1);
    if (L.a && fade > 0) { a.play(); a.crossFadeFrom(L.a, fade, false); }
    else { if (L.a) L.a.stop(); a.play(); }
    L.a = a; L.name = name;
    return a;
  }
  both(name, fade, opts) { this.play(name, 'lower', fade, opts); this.play(name, 'upper', fade, opts); }

  // rotate a bone about an axis given in the character's own frame
  turnBone(name, axis, angle) {
    const b = this.ab[name];
    if (!b || !angle) return;
    // remember the clip-free pose: bones a clip doesn't animate would otherwise keep every turn
    if (!this.touched.has(b)) this.touched.set(b, this.rest.get(b) || b.quaternion.clone());
    b.parent.getWorldQuaternion(q1);
    this.root.getWorldQuaternion(q2);
    v2.copy(axis).applyQuaternion(q2);                 // axis in world space
    v2.applyQuaternion(q1.clone().invert());            // ... in the parent's space
    b.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(v2.normalize(), angle));
  }

  // ---------------- two-handed long guns
  // The animation library only has pistol and sword clips, so rifles are held procedurally: the right
  // hand is placed at the grip in front of the shoulder and turned so the barrel runs along the aim,
  // then the left hand reaches for the fore-end. Both arms are solved with two-bone IK.
  setWorldQuat(b, q) {
    if (!this.touched.has(b)) this.touched.set(b, this.rest.get(b) || b.quaternion.clone());
    b.parent.getWorldQuaternion(q1);
    b.quaternion.copy(q1.invert().multiply(q));
    b.updateMatrixWorld(true);
  }
  // turn bone b (world space) so the direction `from` comes to point along `to`
  swing(b, from, to) {
    b.getWorldQuaternion(q2);
    const d = new THREE.Quaternion().setFromUnitVectors(from.clone().normalize(), to.clone().normalize());
    this.setWorldQuat(b, d.multiply(q2));
  }
  reach(side, target, pole) {
    const a = this.ab['upperarm_' + side], b = this.ab['lowerarm_' + side], c = this.ab['hand_' + side];
    const A = a.getWorldPosition(new THREE.Vector3()), B = b.getWorldPosition(new THREE.Vector3()), C = c.getWorldPosition(new THREE.Vector3());
    const l1 = A.distanceTo(B), l2 = B.distanceTo(C);
    const toT = target.clone().sub(A);
    const d = clamp(toT.length(), Math.abs(l1 - l2) + 0.01, l1 + l2 - 0.002);
    const dir = toT.normalize();
    const pv = pole.clone().sub(A); pv.addScaledVector(dir, -pv.dot(dir)).normalize();
    const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
    const elbow = A.clone().addScaledVector(dir, along).addScaledVector(pv, h);
    this.swing(a, B.clone().sub(A), elbow.clone().sub(A));
    const B2 = b.getWorldPosition(new THREE.Vector3()), C2 = c.getWorldPosition(new THREE.Vector3());
    this.swing(b, C2.clone().sub(B2), A.clone().addScaledVector(dir, d).sub(B2));
  }
  holdRifle(s, pitch, low, kick) {
    const gun = this.rifle;
    if (!gun || !gun.userData.muzzle) return;
    this.root.updateMatrixWorld(true);
    this.root.getWorldQuaternion(q2);
    const p = low ? -0.55 : pitch;
    const fwd = new THREE.Vector3(0, Math.sin(p), -Math.cos(p)).applyQuaternion(q2);
    const up = new THREE.Vector3(0, Math.cos(p), Math.sin(p)).applyQuaternion(q2);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q2);
    const sh = this.ab.upperarm_r.getWorldPosition(new THREE.Vector3());
    // grip: in front of the right shoulder for a shouldered aim, down by the hip at low ready
    const grip = low
      ? sh.clone().addScaledVector(fwd, 0.2).addScaledVector(up, -0.3).addScaledVector(right, -0.06)
      : sh.clone().addScaledVector(fwd, 0.24 - kick * 0.05).addScaledVector(up, -0.11).addScaledVector(right, -0.09);
    this.reach('r', grip, sh.clone().addScaledVector(right, 0.5).addScaledVector(up, -0.6).addScaledVector(fwd, -0.2));
    // turn the hand so the barrel runs along the aim and the gun sits upright
    const hand = this.ab.hand_r;
    gun.updateMatrixWorld(true);
    const at = gun.getWorldPosition(new THREE.Vector3()), muz = gun.userData.muzzle.getWorldPosition(new THREE.Vector3());
    this.swing(hand, muz.clone().sub(at), fwd);
    gun.updateMatrixWorld(true);
    const gunUp = new THREE.Vector3(0, 1, 0).transformDirection(gun.matrixWorld);
    const a1 = gunUp.clone().addScaledVector(fwd, -gunUp.dot(fwd)).normalize(), a2 = up.clone().addScaledVector(fwd, -up.dot(fwd)).normalize();
    this.swing(hand, a1, a2);
    // the off hand on the fore-end, elbow down and out to the left
    gun.updateMatrixWorld(true);
    const g0 = gun.getWorldPosition(new THREE.Vector3()), g1 = gun.userData.muzzle.getWorldPosition(new THREE.Vector3());
    const len = g0.distanceTo(g1);
    const fore = g0.clone().addScaledVector(fwd, clamp(len * 0.45, 0.2, 0.42)).addScaledVector(up, -0.035);
    const shL = this.ab.upperarm_l.getWorldPosition(new THREE.Vector3());
    this.reach('l', fore, shL.clone().addScaledVector(right, -0.35).addScaledVector(up, -0.7));
  }

  update(dt, s, t) {
    for (const [b, q] of this.touched) b.quaternion.copy(q);
    if (s.drawn !== undefined && s.drawn !== this.drawn) this.setDrawn(s.drawn);
    this.drawT += dt;
    this.parryT += dt;
    const sp = s.speed || 0;
    const moving = sp > 0.3;
    // the stride phase still drives footstep sounds
    const run = smoothstep(2.8, 5.8, sp) * (s.crouch ? 0.3 : 1);
    const stride = s.crouch ? 0.5 : lerp(0.68, 1.35, run);
    if (moving) this.phase += (dt * sp / stride) * Math.PI;
    if (this.blade) { this.bladeOn = this.drawn ? Math.min(1, this.bladeOn + dt * 6) : 0; this.blade.userData.beam.scale.y = Math.max(0.001, this.bladeOn); }
    if (s.swing !== undefined && s.swing !== this.lastSwing) { this.lastSwing = s.swing; this.swingT = 0; this.swingVar = (this.swingVar + 1) % 3; this.swingNew = true; }
    this.swingT += dt;
    const weapon = s.weapon;
    const armed = this.drawn && weapon && !s.stagger;

    // ---------------- whole-body states
    let full = null, fullOpts = {};
    if (s.dead) { full = 'Death01'; fullOpts = { once: true }; }
    else if (s.downed) { full = 'Death01'; fullOpts = { once: true, at: 0.62, ts: 0 }; }
    else if (s.driving) full = 'Driving_Loop';
    else if (s.sit) full = s.talk ? 'Sitting_Talking_Loop' : 'Sitting_Idle_Loop';
    else if (s.work && !moving) full = 'Fixing_Kneeling';
    else if (s.cower) full = 'Crouch_Idle_Loop';
    if (full) {
      this.both(full, s.dead ? 0.15 : 0.3, fullOpts);
      this.mixer.update(dt);
      if (s.driving) this.turnBone('spine_02', RIGHT, -0.15);
      return;
    }

    // ---------------- legs
    const fwd = s.fwd ?? 1, side = s.side ?? 0;
    const back = moving && fwd < -0.35;
    let lower;
    if (s.air) lower = 'Jump_Loop';
    else if (s.crouch) lower = moving ? 'Crouch_Fwd_Loop' : 'Crouch_Idle_Loop';
    else if (!moving) lower = s.talk ? 'Idle_Talking_Loop' : 'Idle_Loop';
    else if (sp > 5.4 && !back) lower = 'Sprint_Loop';
    else if (sp > 2.4) lower = 'Jog_Fwd_Loop';
    else lower = this.type === 'officer' ? 'Walk_Formal_Loop' : 'Walk_Loop';
    const gait = GAIT[lower];
    const ts = gait ? clamp(sp / gait, 0.55, 1.7) * (back ? -1 : 1) : 1;
    this.play(lower, 'lower', 0.25, { ts });

    // ---------------- arms
    let upper = lower, uts = ts, uopts = {};
    const gun = weapon === 'blaster' || weapon === 'longlas' || weapon === 'pistol' || weapon === 'pistols' || weapon === 'silenced';
    if (s.flee) upper = 'Sprint_Loop';
    else if (s.talk && !armed) upper = 'Idle_Talking_Loop', uts = 1;
    else if (armed && gun) {
      const firing = this.swingT < 0.25;
      if (s.lowReady) upper = 'Pistol_Idle_Loop', uts = 1;
      else if (firing && this.swingNew && !this.rifle) { upper = 'Pistol_Shoot'; uts = 1.6; uopts = { once: true, restart: true }; }
      else if (firing && this.layer.upper.name === 'Pistol_Shoot') upper = 'Pistol_Shoot', uts = 1.6;
      else upper = 'Pistol_Aim_Neutral', uts = 1;
    } else if (armed && weapon === 'blade') {
      if (this.swingT < 0.42) { upper = 'Sword_Attack'; uts = 1.9; if (this.swingNew) uopts = { once: true, restart: true }; }
      else upper = 'Sword_Idle', uts = 1;
    } else if (armed && weapon === 'knives') {
      if (this.swingT < 0.3) { upper = this.swingVar % 2 ? 'Punch_Cross' : 'Punch_Jab'; uts = 1.8; if (this.swingNew) uopts = { once: true, restart: true }; }
      else upper = 'Sword_Idle', uts = 1;
    }
    if (s.stagger) { upper = 'Hit_Chest'; uts = 1; }
    this.play(upper, 'upper', uopts.restart ? 0.06 : 0.2, { ts: uts, ...uopts });
    this.swingNew = false;
    this.mixer.update(dt);
    // footsteps (entities.js sounds one each time phase passes a multiple of pi) follow the clip's own feet
    const L = this.layer.lower, c0 = STEP0[L.name];
    if (moving && c0 !== undefined && L.a) {
      const base = 2 * Math.PI * (L.a.time / L.a.getClip().duration - c0);
      this.phase = 2 * Math.PI * Math.round((this.phase - base) / (2 * Math.PI)) + base;
    }

    // ---------------- procedural touches on top of the clips
    // strafing: legs turn toward the step, the chest stays on target
    const legYaw = moving && !s.crouch ? clamp(Math.atan2(-side, Math.abs(fwd) + 0.001) * (back ? -1 : 1), -1.0, 1.0) : 0;
    this.legYaw = lerp(this.legYaw || 0, legYaw, Math.min(1, dt * 8));
    if (Math.abs(this.legYaw) > 0.01) { this.turnBone('pelvis', UP, this.legYaw); this.turnBone('spine_01', UP, -this.legYaw * 0.6); this.turnBone('spine_02', UP, -this.legYaw * 0.4); }
    // lean into turns
    this.leanZ = lerp(this.leanZ || 0, clamp((s.turn || 0) * sp * 0.02, -0.25, 0.25), Math.min(1, dt * 5));
    if (Math.abs(this.leanZ) > 0.005) this.turnBone('pelvis', new THREE.Vector3(0, 0, 1), -this.leanZ);
    // aim: bend the chest to the look pitch
    const pitch = clamp(s.pitch || 0, -1.1, 1.1);
    if (armed && gun && pitch) { this.turnBone('spine_02', RIGHT, pitch * 0.35); this.turnBone('spine_03', RIGHT, pitch * 0.35); }
    else if (pitch) this.turnBone('neck_01', RIGHT, pitch * 0.5);
    if (armed && weapon === 'blade' && (s.block || this.parryT < 0.3)) {
      const flick = this.parryT < 0.3 ? Math.sin((this.parryT / 0.3) * Math.PI) : 0;
      this.turnBone('upperarm_r', RIGHT, 0.6 + flick * 0.4);
    }
    const longGun = armed && (weapon === 'blaster' || weapon === 'longlas') && this.rifle && this.drawT > 0.2 && !s.flee;
    if (longGun) this.holdRifle(s, pitch, s.lowReady || (moving && sp > 5.4), Math.max(0, 1 - this.swingT / 0.12));
    else if (armed && this.drawT < 0.25) this.turnBone('upperarm_r', RIGHT, -(1 - this.drawT / 0.25) * 0.6);
    // coats and capes trail the legs
    const go = clamp(sp / 3, 0, 1);
    const cs = this.coatSwing || 0;
    this.coatBone.rotation.set(-(go * 0.12 + run * 0.15) * cs - (s.crouch ? 0.6 : 0), 0, 0);
    this.capeBone.rotation.x = 0.08 + go * (0.2 + run * 0.35) + Math.sin(t * 2) * 0.03;
  }
}
