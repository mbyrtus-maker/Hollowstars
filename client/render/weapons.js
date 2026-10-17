// Weapons from the CC0 packs (Sci-Fi Essentials guns and the Sci-Fi Gun Pack), turned to the
// game's convention: barrel along -Z, grip at the origin, a `muzzle` marker at the barrel tip.
// Returns null when the models aren't loaded, so callers keep their procedural guns.
import * as THREE from 'three';
import { Assets } from './assets.js';
import { glowMat } from './models.js';

// model, turn about Y, target length in metres
const WEAPONS = {
  rifle: ['Gun_Rifle', -Math.PI / 2, 0.86],
  longlas: ['Gun_Sniper', -Math.PI / 2, 1.3],
  revolver: ['Gun_Revolver', -Math.PI / 2, 0.34],
  pistol: ['Gun_Pistol', -Math.PI / 2, 0.3],
  silenced: ['GP_LongPistol_small', 0, 0.44],
  trooper: ['GP_Rifle', 0, 0.9],
  officer: ['GP_Lightning_Gun', 0, 0.62],
  hunting: ['GP_Sniper_rifle', 0, 1.15],
  raygun: ['GP_Ray_Gun', 0, 0.34],
  longpistol: ['GP_LongPistol', 0, 0.5],
  sidearm: ['GP_Pistol', 0, 0.28],
};

const fits = new Map();
// orientation, scale and the offsets that put the grip on the origin, measured once per model
function fit(key) {
  if (fits.has(key)) return fits.get(key);
  const [name, rotY, len] = WEAPONS[key];
  const src = Assets.models.get(name);
  if (!src) return null;
  const turn = new THREE.Matrix4().makeRotationY(rotY);
  const pts = [];
  src.updateMatrixWorld(true);
  src.traverse((o) => {
    if (!o.isMesh) return;
    const p = o.geometry.attributes.position, v = new THREE.Vector3();
    const m = new THREE.Matrix4().multiplyMatrices(turn, o.matrixWorld);
    const step = Math.max(1, Math.floor(p.count / 3000));
    for (let i = 0; i < p.count; i += step) pts.push(v.fromBufferAttribute(p, i).applyMatrix4(m).clone());
  });
  const box = new THREE.Box3().setFromPoints(pts);
  const size = box.getSize(new THREE.Vector3());
  const scale = len / size.z;
  // barrel tip: the middle of the front-most slice; grip: the lowest points in the back half
  const front = pts.filter((p) => p.z < box.min.z + size.z * 0.06);
  const tip = front.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / Math.max(1, front.length));
  const back = pts.filter((p) => p.z > box.min.z + size.z * 0.45);
  const lowY = Math.min(...back.map((p) => p.y));
  const grip = back.filter((p) => p.y < lowY + size.y * 0.25);
  const gz = grip.reduce((a, p) => a + p.z, 0) / Math.max(1, grip.length);
  const f = { name, rotY, scale, offset: new THREE.Vector3(-tip.x, 0.02 / scale - tip.y, -gz), tip: new THREE.Vector3(0, 0.02, (tip.z - gz) * scale) };
  fits.set(key, f);
  return f;
}

export function assetWeapon(key) {
  if (!Assets.ready || !WEAPONS[key]) return null;
  const f = fit(key);
  if (!f) return null;
  const g = new THREE.Group();
  const m = Assets.instance(f.name);
  const holder = new THREE.Group();
  holder.scale.setScalar(f.scale);
  holder.rotation.y = f.rotY;
  m.position.copy(f.offset).applyAxisAngle(new THREE.Vector3(0, 1, 0), -f.rotY);
  holder.add(m);
  g.add(holder);
  m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  // the emitter glow at the muzzle, as on the procedural guns
  const tip = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.02), glowMat(0x66d0ff, 2));
  tip.position.copy(f.tip);
  g.add(tip);
  g.userData.muzzle = tip;
  g.userData.asset = key;
  return g;
}

// which pack gun a procedural weapon kind becomes, by who carries it
export function weaponKey(kind, who) {
  if (who === 'lancer') return 'trooper';
  if (who === 'officer') return 'officer';
  if (who === 'hunter') return 'hunting';
  return { blaster: 'rifle', longlas: 'longlas', pistols: 'revolver', pistol: 'pistol', silenced: 'silenced' }[kind] || null;
}
