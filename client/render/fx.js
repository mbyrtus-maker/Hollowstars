// Visual effects: blaster bolts, particles (sparks, fire, smoke, dust), scorch marks,
// explosions, blade trails, Current waves, pings.
import * as THREE from 'three';
import { makeKnife } from './models.js';

const tmpV = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

class Particles {
  constructor(scene, max, additive) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.base = new Float32Array(max * 4);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('color', this.aCol);
    g.setAttribute('size', this.aSize);
    g.setDrawRange(0, 0);
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uScale: { value: window.innerHeight / 2 } },
      vertexShader: `attribute float size; attribute vec4 color; varying vec4 vC; uniform float uScale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec4 vC; void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); if (d > 0.5) discard; float a = smoothstep(0.5, ${additive ? '0.0' : '0.15'}, d); gl_FragColor = vec4(vC.rgb, vC.a * a); }`,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 5 : 4;
    scene.add(this.points);
  }
  emit(x, y, z, vx, vy, vz, life, size, r, g, b, a, opts = {}) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.base.set([r, g, b, a], i * 4);
    this.life[i] = life; this.maxLife[i] = life;
    this.size[i] = size;
    this.grow[i] = opts.grow || 0;
    this.drag[i] = opts.drag ?? 1.5;
    this.grav[i] = opts.grav ?? 0;
  }
  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const j = --this.n;
        if (i !== j) {
          for (let k = 0; k < 3; k++) { this.pos[i * 3 + k] = this.pos[j * 3 + k]; this.vel[i * 3 + k] = this.vel[j * 3 + k]; }
          for (let k = 0; k < 4; k++) this.base[i * 4 + k] = this.base[j * 4 + k];
          this.life[i] = this.life[j]; this.maxLife[i] = this.maxLife[j]; this.size[i] = this.size[j];
          this.grow[i] = this.grow[j]; this.drag[i] = this.drag[j]; this.grav[i] = this.grav[j];
        }
        continue;
      }
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= d; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt; this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      const f = this.life[i] / this.maxLife[i];
      this.col[i * 4] = this.base[i * 4]; this.col[i * 4 + 1] = this.base[i * 4 + 1]; this.col[i * 4 + 2] = this.base[i * 4 + 2];
      this.col[i * 4 + 3] = this.base[i * 4 + 3] * Math.min(1, f * 2.2);
      i++;
    }
    this.points.geometry.setDrawRange(0, this.n);
    this.aPos.needsUpdate = true; this.aCol.needsUpdate = true; this.aSize.needsUpdate = true;
  }
}

export class FX {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.add = new Particles(scene, 3500, true);
    this.smoke = new Particles(scene, 1800, false);
    this.bolts = new Map();
    this.flashes = [];
    this.decals = [];
    this.waves = [];
    this.trails = [];
    this.lines = [];
    this.fires = [];
    this.shake = 0;
    // bolt geometry: an elongated glowing capsule
    this.boltGeo = new THREE.CylinderGeometry(0.035, 0.035, 1.6, 6);
    this.boltGeo.rotateX(Math.PI / 2);
    this.glowGeo = new THREE.CylinderGeometry(0.11, 0.11, 1.9, 8);
    this.glowGeo.rotateX(Math.PI / 2);
    this.coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.boltMats = {
      player: new THREE.MeshBasicMaterial({ color: new THREE.Color(0x40c8ff).multiplyScalar(3), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      enemy: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2a30).multiplyScalar(3), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      speeder: new THREE.MeshBasicMaterial({ color: new THREE.Color(0x60ff90).multiplyScalar(3), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    };
    this.lightPool = [];
    for (let i = 0; i < 6; i++) { const l = new THREE.PointLight(0xffffff, 0, 10, 2); scene.add(l); this.lightPool.push({ l, t: 0, max: 0 }); }
    this.decalGeo = new THREE.CircleGeometry(0.28, 8);
    this.decalMat = new THREE.MeshBasicMaterial({ color: 0x0a0605, transparent: true, opacity: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    this.waveMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9fd8ff).multiplyScalar(1.5), transparent: true, opacity: 0.4, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  }

  flash(x, y, z, color, intensity, dur) {
    let best = this.lightPool[0];
    for (const p of this.lightPool) if (p.t <= 0) { best = p; break; } else if (p.t < best.t) best = p;
    best.l.position.set(x, y, z);
    best.l.color.setHex(color);
    best.max = intensity; best.t = dur; best.dur = dur;
    best.l.distance = intensity > 60 ? 26 : 10;
  }

  // ---- bolts
  spawnBolt(key, x, y, z, vx, vy, vz, kind) {
    const g = new THREE.Group();
    if (kind === 'knife') {
      const k = makeKnife(); k.rotation.x = Math.PI / 2; k.scale.setScalar(1.3);
      const spin = new THREE.Group(); spin.add(k); g.add(spin); g.userData.spin = spin;
    } else {
      const core = new THREE.Mesh(this.boltGeo, this.coreMat);
      const glow = new THREE.Mesh(this.glowGeo, this.boltMats[kind]);
      g.add(core, glow);
    }
    g.position.set(x, y, z);
    tmpV.set(vx, vy, vz).normalize();
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tmpV);
    this.scene.add(g);
    const b = { g, x, y, z, vx, vy, vz, life: 2.4, kind, age: 0 };
    this.bolts.set(key, b);
    if (kind === 'knife') return b;
    // muzzle flash
    const c = kind === 'enemy' ? [1, 0.25, 0.25] : kind === 'speeder' ? [0.4, 1, 0.6] : [0.35, 0.8, 1];
    for (let i = 0; i < 5; i++) this.add.emit(x, y, z, vx * 0.03 + (Math.random() - 0.5) * 2, vy * 0.03 + (Math.random() - 0.5) * 2, vz * 0.03 + (Math.random() - 0.5) * 2, 0.08, 0.25, c[0], c[1], c[2], 1);
    return b;
  }
  rekeyBolt(oldKey, newKey) { const b = this.bolts.get(oldKey); if (b) { this.bolts.delete(oldKey); this.bolts.set(newKey, b); } }
  redirectBolt(key, x, y, z, vx, vy, vz, kind) {
    let b = this.bolts.get(key);
    if (!b) b = this.spawnBolt(key, x, y, z, vx, vy, vz, kind);
    b.x = x; b.y = y; b.z = z; b.vx = vx; b.vy = vy; b.vz = vz; b.life = 2.2;
    if (b.g.children[1]) b.g.children[1].material = this.boltMats[kind];
    tmpV.set(vx, vy, vz).normalize();
    b.g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tmpV);
    this.sparks(x, y, z, 14, [1, 0.9, 0.6], 6);
    this.flash(x, y, z, 0x9fd8ff, 8, 0.1);
  }
  endBolt(key, x, y, z, surface) {
    const b = this.bolts.get(key);
    const kind = b ? b.kind : 'enemy';
    if (b) { this.scene.remove(b.g); this.bolts.delete(key); }
    const c = kind === 'enemy' ? [1, 0.35, 0.25] : kind === 'speeder' ? [0.5, 1, 0.6] : kind === 'knife' ? [0.9, 0.9, 0.85] : [0.45, 0.85, 1];
    this.sparks(x, y, z, surface === 1 ? 6 : kind === 'knife' ? 4 : 10, c, 4);
    if (surface === 0) {
      this.smoke.emit(x, y, z, 0, 0.6, 0, 1.2, 0.35, 0.3, 0.26, 0.24, 0.5, { grow: 0.6 });
      this.decal(x, y, z, b);
    }
    this.flash(x, y, z, kind === 'enemy' ? 0xff4030 : 0x40c0ff, 8, 0.08);
  }
  decal(x, y, z, b) {
    if (!b) return;
    // find a surface normal by raycasting backward along the bolt
    const sp = Math.hypot(b.vx, b.vy, b.vz) || 1;
    const dx = b.vx / sp, dy = b.vy / sp, dz = b.vz / sp;
    const n = this._normalAt(x - dx * 0.4, y - dy * 0.4, z - dz * 0.4, dx, dy, dz);
    if (!n) return;
    const m = new THREE.Mesh(this.decalGeo, this.decalMat);
    m.position.set(n.x + n.nx * 0.02, n.y + n.ny * 0.02, n.z + n.nz * 0.02);
    m.lookAt(n.x + n.nx, n.y + n.ny, n.z + n.nz);
    m.scale.setScalar(0.7 + Math.random() * 0.6);
    this.scene.add(m);
    this.decals.push({ m, t: 25 });
    if (this.decals.length > 80) { const d = this.decals.shift(); this.scene.remove(d.m); }
  }
  setRaycaster(fn) { this._normalAt = fn; }

  sparks(x, y, z, n, c, speed) {
    for (let i = 0; i < n; i++) {
      this.add.emit(x, y, z, (Math.random() - 0.5) * speed * 2, Math.random() * speed, (Math.random() - 0.5) * speed * 2, 0.25 + Math.random() * 0.3, 0.07 + Math.random() * 0.06, c[0], c[1], c[2], 1, { grav: 9, drag: 2 });
    }
  }

  explosion(x, y, z, r) {
    this.flash(x, y + 1, z, 0xff8a3a, 140, 0.5);
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI - 0.3, s = 4 + Math.random() * r * 1.6;
      this.add.emit(x, y, z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + 2, Math.sin(a) * Math.cos(e) * s, 0.35 + Math.random() * 0.5, 0.6 + Math.random() * 1.2, 1, 0.55 + Math.random() * 0.3, 0.2, 1, { drag: 3, grow: 1.5 });
    }
    for (let i = 0; i < 40; i++) this.sparks(x, y, z, 1, [1, 0.8, 0.4], 14);
    for (let i = 0; i < 30; i++) {
      this.smoke.emit(x + (Math.random() - 0.5) * r * 0.6, y + Math.random() * 1.5, z + (Math.random() - 0.5) * r * 0.6, (Math.random() - 0.5) * 4, 1.5 + Math.random() * 3, (Math.random() - 0.5) * 4, 2.5 + Math.random() * 2.5, 1.2 + Math.random() * 1.5, 0.2, 0.17, 0.16, 0.75, { grow: 1.6, drag: 1.2 });
    }
    // shockwave ring
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 1.0, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc080).multiplyScalar(2), transparent: true, opacity: 0.7, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, y + 0.2, z);
    this.scene.add(ring);
    this.waves.push({ m: ring, t: 0, dur: 0.45, scale: r * 1.4 });
  }
  burn(x, y, z, dur = 40) { this.fires.push({ x, y, z, t: dur }); }

  bladeTrail(owner, base, tip, color) {
    let tr = this.trails.find((t) => t.owner === owner);
    if (!tr) {
      const geo = new THREE.BufferGeometry();
      const N = 12;
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
      geo.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(N * 2), 1));
      const idx = [];
      for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      geo.setIndex(idx);
      const m = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        uniforms: { uC: { value: new THREE.Color(color).multiplyScalar(1.0) } },
        vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'uniform vec3 uC; varying float vA; void main(){ gl_FragColor = vec4(uC, vA * 0.32); }',
      });
      const mesh = new THREE.Mesh(geo, m);
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      tr = { owner, mesh, pts: [], N };
      this.trails.push(tr);
    }
    tr.pts.unshift([base.x, base.y, base.z, tip.x, tip.y, tip.z]);
    if (tr.pts.length > tr.N) tr.pts.length = tr.N;
    tr.active = true;
  }
  _updateTrails() {
    for (const tr of this.trails) {
      if (!tr.active) tr.pts.shift();
      tr.active = false;
      const pos = tr.mesh.geometry.attributes.position, al = tr.mesh.geometry.attributes.alpha;
      for (let i = 0; i < tr.N; i++) {
        const p = tr.pts[Math.min(i, tr.pts.length - 1)];
        if (!p) { al.setX(i * 2, 0); al.setX(i * 2 + 1, 0); continue; }
        pos.setXYZ(i * 2, p[0], p[1], p[2]);
        pos.setXYZ(i * 2 + 1, p[3], p[4], p[5]);
        const f = i < tr.pts.length ? 1 - i / tr.N : 0;
        al.setX(i * 2, f * 0.2); al.setX(i * 2 + 1, f);
      }
      pos.needsUpdate = true; al.needsUpdate = true;
    }
  }

  pushWave(x, y, z, yaw) {
    const geo = new THREE.ConeGeometry(4.5, 10, 24, 1, true);
    geo.translate(0, -5, 0);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, this.waveMat.clone());
    m.position.set(x, y, z);
    m.rotation.y = yaw;
    this.scene.add(m);
    this.waves.push({ m, t: 0, dur: 0.4, scale: 1.4, cone: true });
    for (let i = 0; i < 30; i++) {
      const a = yaw + (Math.random() - 0.5) * 1.2, s = 8 + Math.random() * 10;
      this.smoke.emit(x, y - 1, z, -Math.sin(a) * s, Math.random() * 2, -Math.cos(a) * s, 0.8, 0.5, 0.75, 0.62, 0.45, 0.35, { grow: 2, drag: 3 });
    }
  }
  pullLine(ax, ay, az, bx, by, bz) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(ax, ay, az), new THREE.Vector3(bx, by, bz)]);
    const m = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: new THREE.Color(0xb0e0ff).multiplyScalar(2), transparent: true, opacity: 0.9, toneMapped: false }));
    this.scene.add(m);
    this.lines.push({ m, t: 0.35 });
    for (let i = 0; i < 16; i++) {
      const f = Math.random();
      this.add.emit(ax + (bx - ax) * f, ay + (by - ay) * f, az + (bz - az) * f, 0, 0.5, 0, 0.4, 0.15, 0.6, 0.85, 1, 0.8);
    }
  }
  ping(x, y, z) {
    const geo = new THREE.CylinderGeometry(0.15, 0.15, 30, 6, 1, true);
    geo.translate(0, 15, 0);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd27a).multiplyScalar(2), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    m.position.set(x, y, z);
    this.scene.add(m);
    this.lines.push({ m, t: 4, fade: 4 });
  }
  ring(x, y, z, color, scale = 10, dur = 0.6) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 1.0, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.6), transparent: true, opacity: 0.7, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, y + 0.15, z);
    this.scene.add(ring);
    this.waves.push({ m: ring, t: 0, dur, scale });
  }
  beam(ax, ay, az, bx, by, bz, color) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(ax, ay, az), new THREE.Vector3(bx, by, bz)]);
    const m = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2), transparent: true, opacity: 0.9, toneMapped: false }));
    this.scene.add(m);
    this.lines.push({ m, t: 0.4 });
  }
  heal(x, y, z, n = 18) {
    for (let i = 0; i < n; i++) this.add.emit(x + (Math.random() - 0.5) * 0.8, y + Math.random() * 1.6, z + (Math.random() - 0.5) * 0.8, 0, 1 + Math.random() * 1.5, 0, 0.9, 0.12, 0.35, 1, 0.6, 0.9, { drag: 1 });
  }
  dust(x, y, z, n, s = 1) {
    for (let i = 0; i < n; i++) this.smoke.emit(x + (Math.random() - 0.5) * s, y + 0.1, z + (Math.random() - 0.5) * s, (Math.random() - 0.5) * 2, 0.5 + Math.random(), (Math.random() - 0.5) * 2, 1 + Math.random(), 0.5 + Math.random() * 0.5, 0.72, 0.56, 0.4, 0.35, { grow: 1.2, drag: 1 });
  }

  update(dt) {
    for (const [k, b] of this.bolts) {
      b.age += dt;
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      b.g.position.set(b.x, b.y, b.z);
      if (b.g.userData.spin) b.g.userData.spin.rotation.x += dt * 22;
      b.life -= dt;
      if (b.life <= 0) { this.scene.remove(b.g); this.bolts.delete(k); }
    }
    for (const p of this.lightPool) {
      if (p.t > 0) { p.t -= dt; p.l.intensity = p.max * Math.max(0, p.t / p.dur); } else p.l.intensity = 0;
    }
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      d.t -= dt;
      if (d.t < 3) d.m.material = this.decalMat; // shared; fade by scale
      if (d.t <= 0) { this.scene.remove(d.m); this.decals.splice(i, 1); }
    }
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.t += dt;
      const f = w.t / w.dur;
      if (w.cone) { w.m.scale.set(0.4 + f * w.scale, 0.4 + f * w.scale, 0.3 + f * w.scale); }
      else w.m.scale.setScalar(1 + f * w.scale);
      w.m.material.opacity = 0.6 * (1 - f);
      if (f >= 1) { this.scene.remove(w.m); this.waves.splice(i, 1); }
    }
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const l = this.lines[i];
      l.t -= dt;
      l.m.material.opacity = Math.max(0, l.t / (l.fade || 0.35)) * 0.8;
      if (l.t <= 0) { this.scene.remove(l.m); this.lines.splice(i, 1); }
    }
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.t -= dt;
      if (Math.random() < dt * 30) this.add.emit(f.x + (Math.random() - 0.5) * 2, f.y + Math.random(), f.z + (Math.random() - 0.5) * 2, 0, 2 + Math.random() * 2, 0, 0.6, 0.6 + Math.random() * 0.5, 1, 0.5, 0.15, 0.8, { grow: -0.4, drag: 0.5 });
      if (Math.random() < dt * 12) this.smoke.emit(f.x, f.y + 2, f.z, (Math.random() - 0.5), 3, (Math.random() - 0.5), 4, 1.2, 0.12, 0.1, 0.1, 0.5, { grow: 1.5, drag: 0.2 });
      if (f.t <= 0) this.fires.splice(i, 1);
    }
    this._updateTrails();
    this.add.update(dt);
    this.smoke.update(dt);
    this.shake = Math.max(0, this.shake - dt * 2.5);
  }

  clearBolts() { for (const b of this.bolts.values()) this.scene.remove(b.g); this.bolts.clear(); }
}
