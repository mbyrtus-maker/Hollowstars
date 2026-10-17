// Static props from the CC0 packs, drawn with instancing: every placement of a model shares
// one InstancedMesh per part, so a few hundred crates and plants cost a handful of draw calls.
import * as THREE from 'three';
import { Assets } from './assets.js';

const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3();

export class ModelBatch {
  constructor() { this.items = new Map(); }

  // place a model with a full matrix
  addMatrix(name, matrix) {
    if (!Assets.has(name)) return false;
    if (!this.items.has(name)) this.items.set(name, []);
    this.items.get(name).push(matrix.clone());
    return true;
  }

  // place a model standing on (x, y, z), turned by yaw, at a uniform scale
  add(name, x, y, z, yaw = 0, scale = 1) {
    e.set(0, yaw, 0); q.setFromEuler(e);
    return this.addMatrix(name, m4.compose(v.set(x, y, z), q, s.setScalar(scale)));
  }

  // stretch a model to fill an axis-aligned box (crates and the like)
  fit(name, cx, minY, cz, w, h, d, yaw = 0) {
    const b = Assets.bounds(name);
    if (!b) return false;
    const size = b.getSize(new THREE.Vector3());
    const turned = Math.abs(Math.sin(yaw)) > 0.7;
    const sx = (turned ? d : w) / Math.max(size.x, 1e-3), sz = (turned ? w : d) / Math.max(size.z, 1e-3), sy = h / Math.max(size.y, 1e-3);
    const c = b.getCenter(new THREE.Vector3());
    e.set(0, yaw, 0); q.setFromEuler(e);
    const place = new THREE.Matrix4().compose(v.set(cx, minY, cz), q, s.set(1, 1, 1));
    const shape = new THREE.Matrix4().makeScale(sx, sy, sz).multiply(new THREE.Matrix4().makeTranslation(-c.x, -b.min.y, -c.z));
    return this.addMatrix(name, place.multiply(shape));
  }

  build() {
    const g = new THREE.Group();
    for (const [name, mats] of this.items) {
      const src = Assets.models.get(name);
      src.updateMatrixWorld(true);
      src.traverse((o) => {
        if (!o.isMesh || o.isSkinnedMesh) return;
        const inst = new THREE.InstancedMesh(o.geometry, o.material, mats.length);
        mats.forEach((mm, i) => inst.setMatrixAt(i, m4.multiplyMatrices(mm, o.matrixWorld)));
        inst.instanceMatrix.needsUpdate = true;
        inst.castShadow = true; inst.receiveShadow = true;
        inst.computeBoundingSphere();
        g.add(inst);
      });
    }
    return g;
  }
}

// Animated props (aliens in their tanks, parked mechs): their own copy and mixer
export function animatedProp(name, clip) {
  const o = Assets.instance(name);
  if (!o) return null;
  o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.frustumCulled = false; } });
  const mixer = new THREE.AnimationMixer(o);
  const c = Assets.clip(clip);
  if (c) mixer.clipAction(c).play();
  return { object: o, mixer };
}

// deterministic pick from a list
export const pick = (list, seed) => list[Math.abs(Math.floor(seed)) % list.length];
export const hash = (x, z) => { const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return h - Math.floor(h); };

// One copy of a model, centred over its base and scaled so its largest side is `size` metres
export function kitModel(name, size, faceZ = false) {
  const o = Assets.instance(name);
  if (!o) return null;
  const b = new THREE.Box3().setFromObject(o), sz = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
  const inner = new THREE.Group();
  inner.scale.setScalar(size / Math.max(sz.x, sz.y, sz.z, 1e-3));
  if (faceZ) inner.rotation.y = Math.PI; // the packs face +Z, the game faces -Z
  o.position.set(-c.x, -b.min.y, -c.z);
  inner.add(o);
  o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  const g = new THREE.Group();
  g.add(inner);
  g.userData.inner = inner;
  g.userData.model = o;
  return g;
}

// A model that plays one of its clips forever
export function kitAnimated(name, size, clip, faceZ = true) {
  const g = kitModel(name, size, faceZ);
  if (!g) return null;
  g.traverse((m) => { if (m.isMesh) m.frustumCulled = false; });
  const mixer = new THREE.AnimationMixer(g.userData.model);
  const c = Assets.clip(clip);
  if (c) mixer.clipAction(c).play();
  g.userData.mixer = mixer;
  return g;
}
