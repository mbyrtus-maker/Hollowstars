// The Wayfarer: the crew's Kestrel-class light freighter. Faces -Z, boarding ramp at the rear (+Z).
// Origin sits on the ground at the centre of the hull, matching placeShip() in shared/world.js.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mat, glowMat } from './models.js';
import { textures, repeated } from './textures.js';
import { Assets } from './assets.js';
import { kitModel } from './props.js';

// The Wayfarer wears the Challenger hull from Quaternius's Ultimate Spaceships Pack (CC0) when the
// models are loaded: raised on landing legs, with the crew's lit hatch, boarding ramp and engine glow
// fitted to the back of the hull. Same footprint and API as the procedural ship below.
function makePackWayfarer() {
  const g = new THREE.Group();
  const lift = 0.55;
  const hull = kitModel('SHIP_Challenger', 11.2, true);
  if (!hull) return null;
  hull.position.y = lift;
  g.add(hull);
  g.updateMatrixWorld(true);
  const dark = mat(0x2c2e34, { metal: 0.55, rough: 0.6 }), panel = mat(0x7a7468, { metal: 0.5, rough: 0.7 });
  const add = (geo, m, x, y, z, rx = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.x = rx; o.castShadow = true; g.add(o); return o; };
  // landing legs
  for (const [x, z] of [[-2.2, 2.8], [2.2, 2.8], [0, -3.2]]) {
    add(new THREE.CylinderGeometry(0.13, 0.15, lift + 0.3, 6), dark, x, (lift + 0.3) / 2, z);
    add(new THREE.CylinderGeometry(0.45, 0.5, 0.1, 10), dark, x, 0.05, z);
  }
  // The boarding hatch is the hull's own rear door plate: its triangles are lifted out of the hull
  // mesh and hinged at their bottom edge, so it swings down as the ramp with the hull's texture on the
  // outside. Behind it sits a lit airlock built into the housing, a tread plate on its inner face,
  // a lip that slides out to reach the ground, and a pair of hydraulic rams.
  const bay = makeHatch(hull, lift);
  // engine glow: the dark half-moon exhaust faces either side of the hatch light up (see makeHatch)
  const engines = bay.exhaust;
  return {
    group: g,
    setRamp(t) { bay.set(t); },
    setThrust(v) { engines.material.opacity = 0.07 + Math.min(1, v) * 0.85; },
  };
}

// The Challenger's rear housing, in the model's own frame (it faces +Z, so the back is -Z): a door
// plate 1.02 wide, slanted from its bottom edge at (y -0.173, z -3.052) to its top at (y 0.829, z -2.722).
const DOOR = { x: 0.509, y0: -0.173, z0: -3.052, y1: 0.829, z1: -2.722, back: -2.02, floorY: -0.82 };

function makeHatch(hull, lift) {
  const model = hull.userData.model;
  model.updateMatrixWorld(true);
  const toModel = new THREE.Matrix4().copy(model.matrixWorld).invert();
  let mesh = null;
  model.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
  const rel = new THREE.Matrix4().multiplyMatrices(toModel, mesh.matrixWorld);
  // this ship's own copy of the hull geometry, with the door plate cut out of it
  const geo = mesh.geometry.clone();
  mesh.geometry = geo;
  const P = geo.attributes.position, N = geo.attributes.normal, UV = geo.attributes.uv, I = geo.index;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  const pos = [], nor = [], uvs = [];
  const nrm = new THREE.Matrix3().getNormalMatrix(rel);
  for (let t = 0; t < I.count; t += 3) {
    const ids = [I.getX(t), I.getX(t + 1), I.getX(t + 2)];
    a.fromBufferAttribute(P, ids[0]).applyMatrix4(rel); b.fromBufferAttribute(P, ids[1]).applyMatrix4(rel); c.fromBufferAttribute(P, ids[2]).applyMatrix4(rel);
    n.subVectors(b, a).cross(c.clone().sub(a)).normalize();
    const inDoor = [a, b, c].every((v) => Math.abs(v.x) <= DOOR.x + 0.01 && v.y >= DOOR.y0 - 0.01 && v.y <= DOOR.y1 + 0.01 && v.z <= DOOR.z1 + 0.01);
    if (!inDoor || n.z > -0.85) continue;
    for (const id of ids) {
      const v = new THREE.Vector3().fromBufferAttribute(P, id).applyMatrix4(rel);
      pos.push(v.x, v.y, v.z);
      const nn = new THREE.Vector3().fromBufferAttribute(N, id).applyMatrix3(nrm).normalize();
      nor.push(nn.x, nn.y, nn.z);
      uvs.push(UV.getX(id), UV.getY(id));
    }
    I.setX(t + 1, ids[0]); I.setX(t + 2, ids[0]); // collapse it out of the hull
  }
  I.needsUpdate = true;

  // ---- the exhausts: copies of the hull's own rear engine faces, drawn just behind them in glow
  const ex = [];
  for (let t = 0; t < I.count; t += 3) {
    const ids = [I.getX(t), I.getX(t + 1), I.getX(t + 2)];
    if (ids[1] === ids[0] && ids[2] === ids[0]) continue;
    a.fromBufferAttribute(P, ids[0]).applyMatrix4(rel); b.fromBufferAttribute(P, ids[1]).applyMatrix4(rel); c.fromBufferAttribute(P, ids[2]).applyMatrix4(rel);
    n.subVectors(b, a).cross(c.clone().sub(a)).normalize();
    const onFace = [a, b, c].every((v) => Math.abs(v.z + 2.055) < 0.03 && Math.abs(v.x) >= 0.3 && Math.abs(v.x) <= 1.85 && v.y <= 0.8);
    if (onFace && n.z < -0.9) for (const v of [a, b, c]) ex.push(v.x, Math.max(v.y, -0.15), v.z - 0.012);
  }
  const exGeo = new THREE.BufferGeometry();
  exGeo.setAttribute('position', new THREE.Float32BufferAttribute(ex, 3));
  const exhaust = new THREE.Mesh(exGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0x6ad8ff).multiplyScalar(1.6), transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
  model.add(exhaust);

  // ---- the door: hinged on its bottom edge
  const hinge = new THREE.Group();
  hinge.position.set(0, DOOR.y0, DOOR.z0);
  model.add(hinge);
  const plate = new THREE.BufferGeometry();
  plate.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  plate.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  plate.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  plate.translate(0, -DOOR.y0, -DOOR.z0);
  const outer = new THREE.Mesh(plate, mesh.material);
  outer.castShadow = true; outer.receiveShadow = true;
  hinge.add(outer);
  // in the door's frame: `along` runs up the plate (closed) / out to the ground (open), `inward` into the ship
  const dy = DOOR.y1 - DOOR.y0, dz = DOOR.z1 - DOOR.z0, len = Math.hypot(dy, dz);
  const slope = Math.atan2(dz, dy); // lean of the closed plate, from vertical toward +Z
  const frame = new THREE.Group();
  frame.rotation.x = slope;
  hinge.add(frame);
  const W = DOOR.x * 2;
  const metal = mat(0x3a3c44, { metal: 0.6, rough: 0.45 }), dark = mat(0x22242a, { metal: 0.5, rough: 0.6 });
  const accent = mat(0xc98d2e, { metal: 0.4, rough: 0.5 });
  const box = (w, h, d, m, x, y, z, parent) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o; };
  // inner skin: the plate's thickness, a tread deck and side rails (what you walk up)
  box(W - 0.02, len, 0.05, dark, 0, len / 2, 0.035, frame);
  for (let k = 0; k < 5; k++) box(W - 0.16, 0.035, 0.03, metal, 0, 0.14 + k * (len - 0.24) / 4, 0.075, frame);
  for (const sx of [-1, 1]) box(0.05, len, 0.06, accent, sx * (DOOR.x - 0.03), len / 2, 0.08, frame);
  // the lip that slides out of the top edge once the door is down
  const LIP = 0.62;
  const lip = new THREE.Group();
  frame.add(lip);
  box(W - 0.14, LIP, 0.035, metal, 0, LIP / 2, 0.06, lip);
  for (let k = 0; k < 3; k++) box(W - 0.22, 0.03, 0.025, dark, 0, 0.12 + k * 0.2, 0.09, lip);
  box(W - 0.14, 0.04, 0.05, accent, 0, LIP - 0.02, 0.06, lip);

  // ---- the airlock behind it: walls, deck, a lit ceiling strip and the inner door
  const lock = new THREE.Group();
  model.add(lock);
  const wall = mat(0x2e3036, { metal: 0.45, rough: 0.55 });
  const quad = (pts, m) => {
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute('position', new THREE.Float32BufferAttribute([...pts[0], ...pts[1], ...pts[2], ...pts[0], ...pts[2], ...pts[3]], 3));
    g2.computeVertexNormals();
    const o = new THREE.Mesh(g2, m); o.receiveShadow = true; lock.add(o); return o;
  };
  const X = DOOR.x - 0.005, y0 = DOOR.y0 + 0.005, y1 = DOOR.y1 - 0.005, z0 = DOOR.z0 + 0.01, z1 = DOOR.z1 + 0.01, zb = DOOR.back;
  quad([[-X, y0, z0], [X, y0, z0], [X, y0, zb], [-X, y0, zb]], dark);                // deck (faces up)
  quad([[-X, y1, zb], [X, y1, zb], [X, y1, z1], [-X, y1, z1]], wall);                // ceiling (faces down)
  quad([[X, y0, z0], [X, y1, z1], [X, y1, zb], [X, y0, zb]], wall);                  // right wall (faces -x)
  quad([[-X, y0, zb], [-X, y1, zb], [-X, y1, z1], [-X, y0, z0]], wall);              // left wall (faces +x)
  quad([[-X, y0, zb], [X, y0, zb], [X, y1, zb], [-X, y1, zb]], wall);                // back wall (faces -z)
  for (let k = 0; k < 4; k++) box(W - 0.1, 0.02, 0.05, metal, 0, y0 + 0.012, z0 + 0.15 + k * 0.22, lock); // deck grating
  box(0.7, 0.62, 0.03, metal, 0, y0 + 0.36, zb - 0.02, lock);                       // inner door
  box(0.02, 0.6, 0.035, dark, 0, y0 + 0.36, zb - 0.025, lock);
  const strip = box(W - 0.2, 0.025, 0.12, glowMat(0xffd8a0, 2.2), 0, y1 - 0.02, (z1 + zb) / 2, lock);
  strip.castShadow = false;
  const panelGlow = box(0.12, 0.08, 0.02, glowMat(0x6ad8ff, 1.6), DOOR.x - 0.12, y0 + 0.5, zb - 0.03, lock);
  panelGlow.castShadow = false;
  const light = new THREE.PointLight(0xffd0a0, 0, 5.5, 1.6);
  light.position.set(0, y1 - 0.15, (z0 + zb) / 2 - 0.2);
  lock.add(light);

  // ---- hydraulic rams from the airlock walls to the door's inner face
  const rams = [-1, 1].map((sx) => {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.34, 8), dark);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1, 6), metal);
    barrel.castShadow = rod.castShadow = true;
    lock.add(barrel, rod);
    return { sx, barrel, rod, A: new THREE.Vector3(sx * (DOOR.x - 0.07), DOOR.y0 + 0.62, DOOR.back - 0.05 - 0.45) };
  });
  const tmp = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion();
  const place = (o, from, to, length) => {
    tmp.subVectors(to, from); const d = tmp.length();
    o.position.copy(from).addScaledVector(tmp, (length ?? d) / (2 * d));
    o.quaternion.copy(q.setFromUnitVectors(up, tmp.normalize()));
    if (length == null) o.scale.y = d;
  };

  // open: the door swings out and down until the lip's end touches the ground
  const s = hull.userData.inner.scale.x;
  const hingeY = lift + (DOOR.y0 - DOOR.floorY) * s;
  const reach = (len + LIP * 0.92) * s;
  const below = Math.asin(Math.min(0.98, hingeY / reach)); // angle of the lowered ramp below horizontal
  const openBeta = Math.atan2(-Math.cos(below), -Math.sin(below)); // direction from +Y toward +Z, model frame
  const openAngle = openBeta - slope;
  const B = new THREE.Vector3();
  const set = (t) => {
    const swing = Math.min(1, t / 0.75), ext = THREE.MathUtils.smoothstep(t, 0.7, 1);
    hinge.rotation.x = openAngle * (swing * swing * (3 - 2 * swing));
    lip.position.y = len - 0.04 - LIP + ext * (LIP * 0.92);
    lip.visible = ext > 0.001;
    light.intensity = 5 * Math.min(1, t * 1.6);
    strip.material.color.setHex(0xffd8a0).multiplyScalar(0.4 + 1.8 * Math.min(1, t * 1.6));
    model.updateMatrixWorld(true);
    for (const r of rams) {
      // the ram's far end rides on the door's inner face, 40% of the way up
      B.set(r.sx * (DOOR.x - 0.07), len * 0.4, 0.06);
      frame.localToWorld(B); lock.worldToLocal(B);
      place(r.barrel, r.A, B, 0.34);
      place(r.rod, r.A, B);
    }
  };
  set(1);
  return { set, exhaust };
}

export function makeWayfarer() {
  if (Assets.ready) { const w = makePackWayfarer(); if (w) return w; }
  const T = textures();
  const g = new THREE.Group();
  const hullTex = repeated(T.metal, 1.4);
  const hull = new THREE.MeshStandardMaterial({ color: 0xcfc6b6, metalness: 0.35, roughness: 1, ...hullTex });
  const panel = new THREE.MeshStandardMaterial({ color: 0x8c8a86, metalness: 0.5, roughness: 1, ...hullTex });
  const dark = mat(0x2c2e34, { metal: 0.55, rough: 0.6 });
  const stripe = mat(0xe8742c, { rough: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0e2a36, metalness: 0.9, roughness: 0.08, emissive: 0x0a3a4a, emissiveIntensity: 0.6 });
  const add = (geo, m, x, y, z, rx = 0, ry = 0, rz = 0, shadow = true) => {
    const o = new THREE.Mesh(geo, m);
    o.position.set(x, y, z); o.rotation.set(rx, ry, rz);
    o.castShadow = shadow; o.receiveShadow = true;
    g.add(o);
    return o;
  };

  // fuselage, with a darker belly and a crew-orange stripe
  add(new RoundedBoxGeometry(4.2, 2.3, 9.4, 3, 0.55), hull, 0, 1.95, 0.5);
  add(new RoundedBoxGeometry(3.6, 0.5, 8.6, 2, 0.2), panel, 0, 0.82, 0.6);
  add(new THREE.BoxGeometry(4.26, 0.28, 6.4), stripe, 0, 2.25, 1.2);
  // tapered nose
  const noseG = new THREE.CylinderGeometry(0.35, 2.1, 3.4, 4, 1);
  noseG.rotateY(Math.PI / 4);
  noseG.rotateX(-Math.PI / 2);
  noseG.scale(1, 0.62, 1);
  add(noseG, hull, 0, 1.85, -5.9);
  // cockpit glazing wrapped over the nose
  const canopy = add(new RoundedBoxGeometry(2.5, 0.7, 2.1, 2, 0.25), glass, 0, 2.95, -3.7, -0.32);
  canopy.castShadow = false;
  add(new THREE.BoxGeometry(0.12, 0.75, 2.1), dark, 0, 3.0, -3.7, -0.32);
  // dorsal spine, sensor dish and comms blade
  add(new RoundedBoxGeometry(1.2, 0.5, 5.2, 2, 0.18), panel, 0, 3.2, 1.6);
  const dish = add(new THREE.SphereGeometry(0.7, 14, 6, 0, Math.PI * 2, 0, 1.1), mat(0xd8d4cc, { metal: 0.4, rough: 0.5 }), 0, 3.75, 2.9, -0.4);
  dish.material.side = THREE.DoubleSide;
  add(new THREE.BoxGeometry(0.08, 1.1, 0.7), dark, 0, 3.9, 0.4, 0, 0, 0);
  // swept wings and engine nacelles
  const engines = [];
  for (const side of [-1, 1]) {
    const wing = add(new RoundedBoxGeometry(3.4, 0.32, 4.2, 2, 0.12), hull, side * 3.55, 1.2, 1.5, 0, side * 0.12, side * -0.06);
    add(new THREE.BoxGeometry(3.2, 0.1, 0.5), stripe, side * 3.65, 1.39, 0.1, 0, side * 0.12, side * -0.06);
    const nac = add(new THREE.CylinderGeometry(0.82, 0.92, 4.6, 16), panel, side * 3.0, 1.25, 3.6, Math.PI / 2);
    add(new THREE.TorusGeometry(0.82, 0.12, 6, 16), dark, side * 3.0, 1.25, 1.3);
    add(new THREE.CylinderGeometry(0.7, 0.7, 0.3, 16), dark, side * 3.0, 1.25, 1.3, Math.PI / 2);
    add(new THREE.CylinderGeometry(0.95, 0.8, 0.6, 16), dark, side * 3.0, 1.25, 6.0, Math.PI / 2);
    const glow = add(new THREE.CircleGeometry(0.68, 18), glowMat(0x6ad8ff, 0.8), side * 3.0, 1.25, 6.31, 0, 0, 0, false);
    engines.push(glow);
    // wingtip lights
    add(new THREE.SphereGeometry(0.09, 6, 4), glowMat(side < 0 ? 0xff3040 : 0x40ff70, 3), side * 5.2, 1.3, 1.9, 0, 0, 0, false);
    nac.castShadow = true;
  }
  // landing gear: two rear legs, one nose leg
  for (const [x, z] of [[-1.6, 3.6], [1.6, 3.6], [0, -3.4]]) {
    add(new THREE.CylinderGeometry(0.12, 0.14, 0.9, 6), dark, x, 0.45, z);
    add(new THREE.CylinderGeometry(0.42, 0.48, 0.1, 10), dark, x, 0.05, z);
  }
  // rear hatch: lit interior and a ramp hinged at the top of the opening
  add(new THREE.BoxGeometry(2.3, 2.0, 0.1), dark, 0, 1.8, 5.18, 0, 0, 0, false);
  add(new THREE.BoxGeometry(1.7, 1.6, 0.1), glowMat(0xffc890, 0.35), 0, 1.75, 5.22, 0, 0, 0, false);
  const rampPivot = new THREE.Group();
  rampPivot.position.set(0, 0.8, 5.25);
  g.add(rampPivot);
  const rampLen = 2.3;
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.14, rampLen), panel);
  ramp.position.set(0, 0, rampLen / 2);
  ramp.castShadow = true; ramp.receiveShadow = true;
  rampPivot.add(ramp);
  for (let i = 0; i < 4; i++) {
    const rung = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.05, 0.08), dark);
    rung.position.set(0, 0.09, 0.4 + i * 0.5);
    rampPivot.add(rung);
  }
  const lowered = Math.asin(0.8 / rampLen); // ramp foot touches the ground
  rampPivot.rotation.x = lowered;
  const light = new THREE.PointLight(0xffd0a0, 6, 7, 1.6);
  light.position.set(0, 2, 6);
  g.add(light);

  return {
    group: g,
    setRamp(t) { rampPivot.rotation.x = -Math.PI / 2 + (lowered + Math.PI / 2) * t; light.intensity = 6 * t; },
    setThrust(v) { for (const e of engines) { e.material.color.setHex(0x6ad8ff).multiplyScalar(0.8 + v * 4); e.scale.setScalar(1 + v * 0.25); } },
  };
}


// ------------------------------------------------------------------ NPC traders
// Three designs that come and go from each town's spaceport (shared/spaceport.js).
// All face -Z with their origin on the ground at the centre of the hull.

function parts(g) {
  return (geo, m, x, y, z, rx = 0, ry = 0, rz = 0, shadow = true) => {
    const o = new THREE.Mesh(geo, m);
    o.position.set(x, y, z); o.rotation.set(rx, ry, rz);
    o.castShadow = shadow; o.receiveShadow = true;
    g.add(o);
    return o;
  };
}
function engineGlows(list) {
  return (v) => { for (const e of list) { e.material.color.setHex(0x7fd8ff).multiplyScalar(0.7 + v * 4); e.scale.setScalar(1 + v * 0.3); } };
}

// Mulehorn bulk hauler: a long spine with cargo pods slung either side
function makeBulkHauler() {
  const T = textures();
  const g = new THREE.Group(), add = parts(g);
  const tex = repeated(T.metal, 2);
  const hull = new THREE.MeshStandardMaterial({ color: 0xa8784e, metalness: 0.35, roughness: 1, ...tex });
  const grey = new THREE.MeshStandardMaterial({ color: 0x6e7076, metalness: 0.5, roughness: 1, ...tex });
  const dark = mat(0x2a2b30, { metal: 0.5, rough: 0.6 });
  add(new RoundedBoxGeometry(3.4, 3.0, 20, 2, 0.5), grey, 0, 4.2, 0);
  add(new THREE.SphereGeometry(2.4, 16, 10), hull, 0, 4.4, -10.4).scale.set(1, 0.8, 1.2);
  add(new RoundedBoxGeometry(2.2, 0.7, 1.4, 2, 0.25), new THREE.MeshStandardMaterial({ color: 0x0e2a36, metalness: 0.9, roughness: 0.08, emissive: 0x0a3a4a, emissiveIntensity: 0.6 }), 0, 5.3, -12.4, -0.35);
  for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
    const pod = add(new RoundedBoxGeometry(2.8, 2.6, 5.2, 2, 0.2), i % 2 ? hull : grey, side * 3.3, 3.6, -5.6 + i * 5.8);
    pod.castShadow = true;
    add(new THREE.BoxGeometry(0.4, 0.3, 4.8), dark, side * 1.9, 4.6, -5.6 + i * 5.8);
  }
  const glows = [];
  for (const [x, y] of [[-1.3, 3.4], [1.3, 3.4], [-1.3, 5.1], [1.3, 5.1]]) {
    add(new THREE.CylinderGeometry(0.75, 0.9, 2.2, 14), dark, x, y, 10.8, Math.PI / 2);
    glows.push(add(new THREE.CircleGeometry(0.62, 14), glowMat(0x7fd8ff, 0.8), x, y, 11.92, 0, 0, 0, false));
  }
  for (const [x, z] of [[-2.6, -7], [2.6, -7], [-2.6, 7], [2.6, 7]]) {
    add(new THREE.CylinderGeometry(0.16, 0.2, 2.6, 6), dark, x, 1.3, z);
    add(new THREE.CylinderGeometry(0.55, 0.6, 0.14, 10), dark, x, 0.07, z);
  }
  for (const s of [-1, 1]) add(new THREE.SphereGeometry(0.12, 6, 4), glowMat(s < 0 ? 0xff3040 : 0x40ff70, 3), s * 4.8, 5, -1, 0, 0, 0, false);
  return { group: g, setRamp() {}, setThrust: engineGlows(glows), height: 6.5 };
}

// Swiftwater courier skiff: an arrowhead with forward-swept wings
function makeCourierSkiff() {
  const T = textures();
  const g = new THREE.Group(), add = parts(g);
  const white = new THREE.MeshStandardMaterial({ color: 0xe4e2dc, metalness: 0.4, roughness: 1, ...repeated(T.metal, 1.4) });
  const blue = mat(0x2f6f9a, { metal: 0.4, rough: 0.45 }), dark = mat(0x26272c, { metal: 0.5, rough: 0.6 });
  const body = new THREE.ConeGeometry(1.8, 11, 6, 1);
  body.rotateX(-Math.PI / 2); body.scale(1.1, 0.55, 1);
  add(body, white, 0, 2.0, -0.6);
  add(new RoundedBoxGeometry(1.4, 0.5, 2.2, 2, 0.2), new THREE.MeshStandardMaterial({ color: 0x0e2a36, metalness: 0.9, roughness: 0.08, emissive: 0x0a3a4a, emissiveIntensity: 0.6 }), 0, 2.75, -1.6, -0.08);
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(4.6, 0.18, 1.8), white, s * 3, 1.85, 1.2, 0, s * -0.45, s * 0.08);
    add(new THREE.BoxGeometry(4.6, 0.2, 0.3), blue, s * 3, 1.95, 0.6, 0, s * -0.45, s * 0.08);
    add(new THREE.BoxGeometry(0.15, 1.6, 1.6), white, s * 1.2, 2.8, 3.6, 0, 0, s * 0.35);
  }
  add(new THREE.CylinderGeometry(0.9, 1.0, 2.0, 16), dark, 0, 2.0, 5.2, Math.PI / 2);
  const glow = add(new THREE.CircleGeometry(0.8, 16), glowMat(0x9fc8ff, 0.8), 0, 2.0, 6.22, 0, 0, 0, false);
  for (const [x, z] of [[-1.2, 2], [1.2, 2], [0, -3.5]]) add(new THREE.CylinderGeometry(0.1, 0.12, 1.5, 6), dark, x, 0.75, z);
  return { group: g, setRamp() {}, setThrust: engineGlows([glow]), height: 3.5 };
}

// Pilgrim lander: a domed saucer on three legs with a ring of lit portholes
function makePilgrimLander() {
  const g = new THREE.Group(), add = parts(g);
  const hull = mat(0xc8b48e, { metal: 0.4, rough: 0.5 }), dark = mat(0x2a2b30, { metal: 0.5, rough: 0.6 });
  const saucer = new THREE.SphereGeometry(5, 24, 10);
  saucer.scale(1, 0.32, 1);
  add(saucer, hull, 0, 3.2, 0);
  add(new THREE.SphereGeometry(2.2, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x9fd4e8, transparent: true, opacity: 0.55, metalness: 0.9, roughness: 0.05 }), 0, 4.2, 0).castShadow = false;
  const ring = new THREE.TorusGeometry(4.6, 0.18, 6, 32);
  ring.rotateX(Math.PI / 2);
  add(ring, dark, 0, 3.2, 0);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    add(new THREE.CircleGeometry(0.22, 8), glowMat(0xffd28a, 1.4), Math.sin(a) * 4.62, 3.45, Math.cos(a) * 4.62, 0, a, 0, false);
  }
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    add(new THREE.CylinderGeometry(0.14, 0.18, 3.2, 6), dark, Math.sin(a) * 3.2, 1.5, Math.cos(a) * 3.2, Math.cos(a) * 0.3, 0, -Math.sin(a) * 0.3);
    add(new THREE.CylinderGeometry(0.5, 0.55, 0.12, 10), dark, Math.sin(a) * 3.6, 0.06, Math.cos(a) * 3.6);
  }
  const glow = add(new THREE.CircleGeometry(1.2, 18), glowMat(0x9fe0ff, 0.8), 0, 2.0, 0, Math.PI / 2, 0, 0, false);
  return { group: g, setRamp() {}, setThrust: engineGlows([glow]), height: 5 };
}

export function makeNpcShip(type) {
  return type === 'hauler' ? makeBulkHauler() : type === 'skiff' ? makeCourierSkiff() : makePilgrimLander();
}
