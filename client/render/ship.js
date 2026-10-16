// The Wayfarer: the crew's Kestrel-class light freighter. Faces -Z, boarding ramp at the rear (+Z).
// Origin sits on the ground at the centre of the hull, matching placeShip() in shared/world.js.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mat, glowMat } from './models.js';
import { textures, repeated } from './textures.js';

export function makeWayfarer() {
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
