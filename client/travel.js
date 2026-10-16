// Client side of flying the Wayfarer: the lift-off shot, the hyperspace overlay, the touchdown,
// and the orbiting camera while the crew waits aboard.
import { PLANETS, SHIP } from '../shared/planets.js';
import { clamp, lerp, smoothstep } from '../shared/math.js';

const $ = (id) => document.getElementById(id);
const ease = (t) => t * t * (3 - 2 * t);

export class Travel {
  constructor() {
    this.phase = null; // 'launch' | 'jump' | 'arrive'
    this.t = 0;
    this.orbit = 0.6;
    this.cv = $('jump-cv');
    this.ctx = this.cv.getContext('2d');
    this.stars = Array.from({ length: 340 }, () => this.newStar(true));
    this.speed = 0;
    this.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  newStar(anyDepth) { return { x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 2, z: anyDepth ? Math.random() : 1, pz: 1 }; }

  get busy() { return !!this.phase && this.phase !== 'arrive'; }

  launch(from, to) {
    this.phase = 'launch';
    this.t = 0;
    this.to = to;
    $('jump-label').innerHTML = `Jumping to<b>${PLANETS[to].name}</b>`;
  }

  // Called once the new world is built
  arrive(id, hud) {
    this.phase = 'arrive';
    this.t = 0;
    $('jump').classList.remove('on');
    const P = PLANETS[id];
    hud.big(P.name, P.arrival);
  }

  // Ship animation; returns true when the travel camera owns the view
  update(dt, scene, camera, lp, aboard, input) {
    const ship = scene.ship;
    this.t += dt;
    if (this.phase === 'launch') {
      const t = this.t;
      if (ship) {
        ship.setRamp(1 - clamp(t / 0.7, 0, 1));
        ship.setThrust(clamp((t - 0.4) / 0.8, 0, 1));
        const lift = Math.max(0, t - 0.7);
        ship.group.position.y = ship.base.y + lift * lift * 5.5 + smoothstep(0.7, 1.5, t) * 1.2;
        ship.group.position.z = ship.base.z - Math.max(0, t - 1.6) ** 3 * 9;
        ship.group.rotation.x = smoothstep(1.2, 2.6, t) * 0.22;
        this.shipCam(camera, ship, 0.7 + t * 0.12, 16 + t * 2, 3 + t * 1.5);
      }
      if (t > 2.3) $('jump').classList.add('on');
      if (t > 2.9) { this.phase = 'jump'; this.t = 0; this.speed = 0; }
      return true;
    }
    if (this.phase === 'jump') {
      this.drawJump(dt);
      if (ship) this.shipCam(camera, ship, 0.9, 20, 6);
      return true;
    }
    if (this.phase === 'arrive') {
      const t = this.t;
      if (ship) {
        const k = 1 - ease(clamp(t / 3.2, 0, 1));
        ship.group.position.set(ship.base.x, ship.base.y + k * 46, ship.base.z + k * 30);
        ship.group.rotation.x = -k * 0.25;
        ship.setThrust(k > 0.02 ? 0.4 + k * 0.6 : 0);
        ship.setRamp(smoothstep(3.0, 3.8, t));
      }
      if (t < 0.6) this.drawJump(dt);
      if (t > 4) { this.phase = null; if (ship) { ship.group.position.copy(ship.base); ship.group.rotation.x = 0; ship.setRamp(1); ship.setThrust(0); } }
      return false;
    }
    if (aboard && ship) {
      this.orbit -= (input.mouse.dx || 0) * 0.003 * (input.sens || 1);
      this.orbit += dt * 0.05;
      this.shipCam(camera, ship, this.orbit, 15, 5);
      return true;
    }
    return false;
  }

  shipCam(camera, ship, a, dist, h) {
    const p = ship.group.position;
    const yaw = ship.yaw || 0;
    camera.position.set(ship.base.x + Math.sin(a + yaw) * dist, ship.base.y + h, ship.base.z + Math.cos(a + yaw) * dist);
    camera.lookAt(p.x, p.y + 2, p.z);
  }

  drawJump(dt) {
    const cv = this.cv, ctx = this.ctx;
    const w = Math.round(innerWidth * 0.6), h = Math.round(innerHeight * 0.6);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    this.speed = lerp(this.speed, this.reduced ? 0.25 : 1.6, Math.min(1, dt * 1.5));
    ctx.fillStyle = 'rgba(4,3,10,0.38)';
    ctx.fillRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2, sc = Math.max(w, h) * 0.5;
    ctx.lineCap = 'round';
    for (const s of this.stars) {
      s.pz = s.z;
      s.z -= dt * this.speed;
      if (s.z <= 0.02) { Object.assign(s, this.newStar(false)); continue; }
      const x0 = cx + (s.x / s.pz) * sc, y0 = cy + (s.y / s.pz) * sc;
      const x1 = cx + (s.x / s.z) * sc, y1 = cy + (s.y / s.z) * sc;
      const b = clamp(1 - s.z, 0, 1);
      ctx.strokeStyle = `rgba(${170 + b * 85 | 0},${210 + b * 45 | 0},255,${0.25 + b * 0.75})`;
      ctx.lineWidth = 0.6 + b * 2;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
  }

  aboardTip(show) {
    const e = $('aboard-tip');
    e.classList.toggle('hidden', !show);
    if (show) e.textContent = `Aboard the ${SHIP.name}`;
  }
}
