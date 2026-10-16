// The locally controlled crew member: predicted movement, camera, aiming, viewmodel.
import * as THREE from 'three';
import { PLAYER, WEAPONS, POWERS, BLADE_COLORS, F, CLASSES, DEFAULT_CLASS } from '../shared/config.js';
import { clamp, lerp, dirFromYawPitch, wrapAngle } from '../shared/math.js';
import { moveBody, canStand, raycast, terrainHeight } from '../shared/world.js';
import { stepSpeeder, SPEEDER } from '../shared/vehicles.js';
import { makeRifle, makeBlade, makePistol, makeKnife } from './render/models.js';

const v3 = new THREE.Vector3();

export class LocalPlayer {
  constructor(world, id, pos, yaw, color, cls) {
    this.world = world;
    this.id = id;
    this.color = color;
    this.cls = CLASSES[cls] ? cls : DEFAULT_CLASS;
    this.C = CLASSES[this.cls];
    this.body = { x: pos[0], y: pos[1], z: pos[2], vx: 0, vy: 0, vz: 0, r: PLAYER.radius, h: PLAYER.height, onGround: false };
    this.yaw = yaw; this.pitch = 0;
    this.crouch = false; this.sprint = false; this.blocking = false; this.aiming = false;
    this.weapon = this.C.weapon;
    this.ranged = ['blaster', 'pistols', 'pistol'].includes(this.weapon);
    this.tp = 1;
    this.shotSide = 1;
    this.drawn = false;
    this.firstPerson = false;
    this.speed = 0;
    this.swingCount = 0;
    this.lastShot = -9; this.lastSwing = -9;
    this.heat = 0; this.overheated = false;
    this.leapCharge = -1;
    this.vehicle = null; this.vehicleId = 0;
    this.downed = false;
    this.camPos = new THREE.Vector3(pos[0], pos[1] + 3, pos[2] + 4);
    this.camDist = 3.6;
    this.recoil = 0;
    this.time = 0;
    this.state = { x: pos[0], y: pos[1], z: pos[2], yaw, flags: 0 };
    this.vehicleState = null;
  }

  teleport(p, seq) {
    this.body.x = p[0]; this.body.y = p[1]; this.body.z = p[2];
    this.body.vx = this.body.vy = this.body.vz = 0;
    this.tp = seq;
  }
  impulse(v) { this.body.vx += v[0]; this.body.vy = Math.max(this.body.vy, v[1]); this.body.vz += v[2]; this.body.onGround = false; }

  enterVehicle(id, s) {
    if (id) {
      this.vehicleId = id;
      this.vehicle = { x: s[0], y: s[1], z: s[2], yaw: s[3], vx: s[4], vy: 0, vz: s[5], onGround: false };
      this.crouch = false;
      this.drawn = false;
      this.yaw = s[3];
    } else { this.vehicleId = 0; this.vehicle = null; this.vehicleState = null; }
  }

  // Called every frame. Returns actions to send.
  update(dt, input, pv, act) {
    this.time += dt;
    const sens = 0.0022 * input.sens;
    this.yaw = wrapAngle(this.yaw - input.mouse.dx * sens);
    this.pitch = clamp(this.pitch - input.mouse.dy * sens * (input.invertY ? -1 : 1), -1.45, 1.4);
    this.downed = !!(pv && pv.dn);
    const b = this.body;
    if (input.hit('KeyV')) this.firstPerson = !this.firstPerson;

    // ---------------- vehicle
    if (this.vehicle) {
      const s = this.vehicle;
      const inp = {
        throttle: (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0),
        steer: (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0),
        targetYaw: this.yaw, boost: input.down('ShiftLeft') || input.down('ShiftRight'), hop: input.hit('Space'),
      };
      let rem = dt;
      while (rem > 1e-4) { const h = Math.min(rem, 1 / 60); stepSpeeder(this.world, s, inp, h); rem -= h; }
      b.x = s.x; b.y = s.y; b.z = s.z; b.vx = s.vx; b.vz = s.vz;
      this.speed = s.speed || 0;
      this.vehicleState = { x: s.x, y: s.y, z: s.z, yaw: s.yaw, flags: 0 };
      if (input.mouse.l && this.time - this.lastShot > WEAPONS.speederCannon.fireInterval) {
        this.lastShot = this.time;
        act.vfire = true;
      }
      this.state = { x: s.x, y: s.y, z: s.z, yaw: s.yaw, flags: F.DRIVING };
      return;
    }

    // ---------------- on foot
    if (input.hit('KeyR') || (input.hit('Digit1') && !this.drawn)) { this.drawn = !this.drawn; act.draw = this.drawn ? 'draw' : 'holster'; }
    if (input.hit('KeyC') || input.hit('ControlLeft')) {
      if (this.crouch) { if (canStand(this.world, b.x, b.y, b.z, b.r, PLAYER.height)) this.crouch = false; }
      else this.crouch = true;
    }
    const fw = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0);
    const rt = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0);
    this.sprint = (input.down('ShiftLeft') || input.down('ShiftRight')) && fw > 0 && !this.crouch;
    if (this.sprint && this.crouch) this.crouch = false;
    this.blocking = this.drawn && this.weapon === 'blade' && input.mouse.r && !this.downed;
    this.aiming = this.drawn && this.ranged && input.mouse.r && !this.downed;
    if (!this.drawn && (input.mouse.lPressed || input.mouse.rPressed) && !this.downed) act.needDraw = true;
    if (this.sprint) { this.aiming = false; }
    let spd = this.crouch ? PLAYER.crouchSpeed : this.sprint ? PLAYER.sprint : PLAYER.walk;
    if (this.blocking) spd = Math.min(spd, PLAYER.blockSpeed);
    if (this.aiming) spd = Math.min(spd, 3.8);
    if (this.downed) spd = 0.9;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    let wx = -sy * fw + cy * rt, wz = -cy * fw - sy * rt;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }
    const acc = (b.onGround ? PLAYER.accelGround : PLAYER.accelAir) * dt;
    const tvx = wx * spd, tvz = wz * spd;
    const dvx = tvx - b.vx, dvz = tvz - b.vz;
    const dl = Math.hypot(dvx, dvz);
    // air control keeps momentum from leaps; ground control is snappy
    if ((b.onGround || wl > 0) && !(this.rollT > 0.15)) {
      const f = dl > acc ? acc / dl : 1;
      if (b.onGround || Math.hypot(b.vx, b.vz) < spd + 0.5) { b.vx += dvx * f; b.vz += dvz * f; }
    }
    // jump / leap charge
    if (!this.downed && b.onGround && !this.C.leap && input.hit('Space')) { b.vy = PLAYER.jump; b.onGround = false; }
    if (!this.downed && b.onGround && this.C.leap) {
      if (input.hit('Space')) this.leapCharge = 0;
      if (this.leapCharge >= 0 && input.down('Space')) this.leapCharge = Math.min(PLAYER.leapChargeTime, this.leapCharge + dt);
      if (this.leapCharge >= 0 && !input.down('Space')) {
        const cost = POWERS.leap.cost * (pv && pv.up && pv.up.includes('attune') ? 0.75 : 1);
        const charged = this.leapCharge > 0.16 && pv && pv.fo >= cost;
        if (charged) {
          const f = this.leapCharge / PLAYER.leapChargeTime;
          b.vy = lerp(PLAYER.jump * 1.25, PLAYER.leapMax, f);
          const lf = PLAYER.leapForward * f;
          if (wl > 0) { b.vx += wx * lf; b.vz += wz * lf; } else { b.vx += -sy * lf * 0.6; b.vz += -cy * lf * 0.6; }
          act.leap = true;
        } else b.vy = PLAYER.jump;
        b.onGround = false;
        if (this.crouch && canStand(this.world, b.x, b.y, b.z, b.r, PLAYER.height)) this.crouch = false;
        this.leapCharge = -1;
      }
    } else if (!input.down('Space')) this.leapCharge = -1;
    b.h = this.crouch || this.downed ? PLAYER.crouchHeight : PLAYER.height;
    let rem = dt;
    while (rem > 1e-4) { const h = Math.min(rem, 1 / 90); moveBody(this.world, b, h); rem -= h; }
    if (b.y < terrainHeight(b.x, b.z) - 1) b.y = terrainHeight(b.x, b.z) + 0.1;
    this.speed = Math.hypot(b.vx, b.vz);

    // ---------------- actions
    if (!this.downed) {
      if (this.drawn && this.ranged && input.mouse.l) {
        const cyc = pv && pv.up && pv.up.includes('cyclic');
        const sup = pv && pv.ab && pv.ab.q && this.cls === 'soldier' && pv.ab.q[2] > 0;
        const interval = WEAPONS[this.weapon].fireInterval * (cyc ? 0.65 : 1) * (sup ? 0.55 : 1);
        this.overheated = pv ? !!pv.oh : false;
        if (!this.overheated && this.time - this.lastShot >= interval) {
          this.lastShot = this.time;
          act.fire = true;
          this.recoil = 1;
        }
      }
      if (this.drawn && (this.weapon === 'blade' || this.weapon === 'knives') && input.mouse.lPressed && this.time - this.lastSwing > WEAPONS[this.weapon].swingTime * 0.9) {
        this.lastSwing = this.time;
        this.swingCount = (this.swingCount + 1) % 1000;
        act.melee = true;
      }
      if (input.hit('KeyG')) act.grenade = true;
      for (const [code, k] of [['KeyQ', 'q'], ['KeyF', 'f'], ['KeyX', 'x']]) {
        if (!input.hit(code) || !this.C.abilities[k]) continue;
        act.ab = k;
        if ((this.C.abilities[k].id === 'execute' || this.C.abilities[k].id === 'fan') && !this.drawn) { this.drawn = true; act.draw = 'draw'; }
        // The dodge roll is movement, so it is predicted here
        if (this.C.abilities[k].id === 'roll' && pv && pv.ab && pv.ab[k] && pv.ab[k][0] <= 0) {
          let rx = wx, rz = wz;
          if (wl === 0) { rx = Math.sin(this.yaw); rz = Math.cos(this.yaw); }
          b.vx = rx * 15; b.vz = rz * 15; b.vy = Math.max(b.vy, 2.5);
          this.rollT = 0.45;
        }
      }
      if (input.hit('KeyH')) act.med = true;
      if (input.hit('KeyT') || input.mouse.mPressed) act.ping = true;
    }
    this.recoil = Math.max(0, this.recoil - dt * 8);
    this.rollT = Math.max(0, (this.rollT || 0) - dt);
    let fl = 0;
    if (this.crouch || (this.leapCharge > 0.1) || this.rollT > 0) fl |= F.CROUCH;
    if (this.blocking) fl |= F.BLOCK;
    if (this.weapon === 'blade' || this.weapon === 'knives') fl |= F.BLADE;
    if (this.drawn) fl |= F.DRAWN;
    if (this.downed) fl |= F.DOWNED;
    if (!b.onGround) fl |= F.AIR;
    if (pv && pv.shr > 0) fl |= F.SHROUD;
    this.state = { x: b.x, y: b.y, z: b.z, yaw: this.yaw, flags: fl };
  }

  inputMsg() {
    const b = this.body;
    let f = 0;
    if (this.crouch) f |= 1;
    if (this.sprint) f |= 2;
    if (this.blocking) f |= 4;
    if (b.onGround) f |= 8;
    if (this.drawn && !this.vehicle) f |= 16;
    const m = { t: 'in', tp: this.tp, p: [r3(b.x), r3(b.y), r3(b.z)], v: [r3(b.vx), r3(b.vy), r3(b.vz)], yw: r3(this.yaw), pt: r3(this.pitch), f, w: this.weapon === 'blade' ? 1 : 0 };
    if (this.vehicle) { const s = this.vehicle; m.vh = [r3(s.x), r3(s.y), r3(s.z), r3(s.yaw), r3(s.vx), r3(s.vz)]; }
    return m;
  }

  // ---------------- camera
  updateCamera(camera, dt, fov, shake) {
    const b = this.body;
    const targetFov = this.aiming ? fov * 0.62 : this.vehicle ? fov + Math.min(14, this.speed * 0.3) : this.sprint ? fov + 4 : fov;
    camera.fov = lerp(camera.fov, targetFov, Math.min(1, dt * 10));
    camera.updateProjectionMatrix();
    const dir = dirFromYawPitch(this.yaw, this.pitch);
    const sx = (Math.random() - 0.5) * shake * 0.3, sy = (Math.random() - 0.5) * shake * 0.3;
    if (this.firstPerson && !this.vehicle && !this.downed) {
      const eye = (this.crouch ? PLAYER.crouchHeight : PLAYER.height) - 0.15;
      const ey = b.y + eye;
      this._eyeY = lerp(this._eyeY ?? ey, ey, Math.min(1, dt * 14));
      camera.position.set(b.x + sx, this._eyeY + sy, b.z);
      camera.lookAt(b.x + dir.x * 10, this._eyeY + dir.y * 10, b.z + dir.z * 10);
      return;
    }
    let pivotY = b.y + (this.downed ? 0.6 : this.crouch ? 1.15 : 1.6);
    let back = this.aiming ? 2.0 : 3.6, right = this.aiming ? 0.62 : 0.72;
    if (this.vehicle) { back = 6 + Math.min(3, this.speed * 0.06); right = 0; pivotY = b.y + 1.8; }
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const px = b.x + rx * right, pz = b.z + rz * right;
    let cx = px - dir.x * back, cy = pivotY - dir.y * back + 0.25, cz = pz - dir.z * back;
    // keep the camera out of walls
    const dx = cx - b.x, dy = cy - pivotY, dz = cz - b.z;
    const dl = Math.hypot(dx, dy, dz);
    const hit = raycast(this.world, b.x, pivotY, b.z, dx / dl, dy / dl, dz / dl, dl, { terrainStep: 0.5 });
    let tgtDist = dl;
    if (hit) tgtDist = Math.max(0.4, hit.t - 0.3);
    this.camDist = tgtDist < this.camDist ? tgtDist : lerp(this.camDist, tgtDist, Math.min(1, dt * 5));
    const f = this.camDist / dl;
    cx = b.x + dx * f; cy = pivotY + dy * f; cz = b.z + dz * f;
    const th = terrainHeight(cx, cz) + 0.3;
    if (cy < th) cy = th;
    camera.position.set(cx + sx, cy + sy, cz);
    camera.lookAt(cx + dir.x * 10, cy + dir.y * 10, cz + dir.z * 10);
  }

  // Aim point: what's under the crosshair
  aimPoint(camera, entities) {
    camera.getWorldDirection(v3);
    const o = camera.position;
    const hit = raycast(this.world, o.x, o.y, o.z, v3.x, v3.y, v3.z, 400, { terrainStep: 1.5 });
    let t = hit ? hit.t : 400;
    const eh = entities.rayEntities(o, v3, t, this.id);
    let target = null;
    if (eh) { t = eh.t; target = eh.view; }
    return { x: o.x + v3.x * t, y: o.y + v3.y * t, z: o.z + v3.z * t, target, dir: v3.clone() };
  }
}

const r3 = (v) => Math.round(v * 1000) / 1000;

// First-person weapon view
export class ViewModel {
  constructor(camera, colorIdx, weapon) {
    this.group = new THREE.Group();
    camera.add(this.group);
    this.weaponKind = weapon;
    this.rifle = makeRifle();
    this.rifle.position.set(0.24, -0.22, -0.42);
    this.blade = weapon === 'knives' ? makeKnife() : makeBlade(BLADE_COLORS[colorIdx]);
    this.bladeHolder = new THREE.Group();
    this.bladeHolder.position.set(0.3, -0.38, -0.5);
    this.bladeHolder.add(this.blade);
    this.pistolR = makePistol(); this.pistolL = makePistol();
    this.pistolR.position.set(0.2, -0.2, -0.38); this.pistolL.position.set(-0.2, -0.2, -0.38);
    this.knifeL = makeKnife(); this.knifeL.position.set(-0.3, -0.36, -0.48); this.knifeL.rotation.set(-0.3, 0, 0.3);
    this.group.add(this.rifle, this.bladeHolder, this.pistolR, this.pistolL, this.knifeL);
    this.group.traverse((m) => { if (m.isMesh) { m.castShadow = false; m.renderOrder = 10; } });
    this.swingT = 9;
    this.lastSwing = 0;
  }
  update(dt, lp, t) {
    const show = lp.firstPerson && !lp.vehicle && !lp.downed && lp.drawn;
    this.group.visible = show;
    if (!show) return;
    this.rifle.visible = lp.weapon === 'blaster';
    this.bladeHolder.visible = lp.weapon === 'blade' || lp.weapon === 'knives';
    this.pistolR.visible = lp.weapon === 'pistols' || lp.weapon === 'pistol';
    this.pistolL.visible = lp.weapon === 'pistols';
    this.knifeL.visible = lp.weapon === 'knives';
    if (this.pistolR.visible) {
      const k = lp.recoil * 0.05;
      this.pistolR.position.set(lp.aiming && lp.weapon === 'pistol' ? 0.0 : 0.2, -0.2 + bob, -0.38 + (lp.shotSide > 0 ? k : 0));
      this.pistolL.position.set(-0.2, -0.2 - bob, -0.38 + (lp.shotSide < 0 ? k : 0));
    }
    const bob = Math.sin(t * 9) * Math.min(1, lp.speed / 6) * 0.015;
    if (lp.weapon === 'blaster') {
      this.rifle.position.set(lp.aiming ? 0.0 : 0.24, (lp.aiming ? -0.16 : -0.22) + bob, -0.42 + lp.recoil * 0.06);
      this.rifle.rotation.x = lp.recoil * 0.08;
    } else if (this.pistolR.visible) {
      // pistols positioned above
    } else {
      if (lp.swingCount !== this.lastSwing) { this.lastSwing = lp.swingCount; this.swingT = 0; this.var = ((this.var || 0) + 1) % 2; }
      this.swingT += dt;
      const s = this.swingT / 0.4;
      const h = this.bladeHolder;
      if (s < 1) {
        const e = Math.sin(Math.min(1, s * 1.4) * Math.PI / 2);
        const dir = this.var ? -1 : 1;
        h.rotation.set(-0.3 - e * 1.1, 0, dir * (0.9 - e * 1.9));
        h.position.set(0.3 - dir * e * 0.4, -0.3, -0.55);
      } else if (lp.blocking) {
        h.rotation.set(0.1, 0, 1.35);
        h.position.set(0.05, -0.25, -0.55);
      } else {
        h.rotation.set(-0.25, 0, -0.25 + bob * 3);
        h.position.set(0.3, -0.38 + bob, -0.5);
      }
    }
  }
}
