// Hover-speeder physics, shared so the driver's client can predict exactly what the
// server would do.

import { clamp, angleDiff, wrapAngle } from './math.js';
import { moveBody, groundAt } from './world.js';

export const SPEEDER = {
  maxSpeed: 34, boostSpeed: 50, reverse: 9, accel: 20, boostAccel: 34, brake: 34,
  turnRate: 2.4, grip: 5.5, hover: 1.05, r: 0.95, h: 1.1, hp: 220,
};

// s: {x,y,z,yaw,vx,vy,vz,onGround}; inp: {throttle, steer, targetYaw, boost, hop}
export function stepSpeeder(W, s, inp, dt) {
  const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
  const rx = -fz, rz = fx;
  let vf = s.vx * fx + s.vz * fz;
  let vr = s.vx * rx + s.vz * rz;
  const thr = inp.throttle || 0;
  const tune = s.tune || 1; // the rider's speeder upgrades
  const top = (inp.boost ? SPEEDER.boostSpeed : SPEEDER.maxSpeed) * tune;
  if (thr > 0) vf += Math.min(top - vf, (inp.boost ? SPEEDER.boostAccel : SPEEDER.accel) * tune * thr * dt) * (vf < top ? 1 : 0);
  else if (thr < 0) vf = vf > 0 ? Math.max(0, vf - SPEEDER.brake * dt) : Math.max(-SPEEDER.reverse, vf - SPEEDER.accel * 0.5 * dt);
  else vf -= vf * Math.min(1, dt * 0.45);
  if (vf > top) vf -= (vf - top) * Math.min(1, dt * 2);
  // Steering: turn toward the camera heading plus A/D
  const speedF = clamp(Math.abs(vf) / 12, 0.25, 1);
  let turn = 0;
  if (inp.targetYaw != null) turn = clamp(angleDiff(s.yaw, inp.targetYaw) * 3, -1, 1);
  turn = clamp(turn - (inp.steer || 0), -1, 1);
  s.yaw = wrapAngle(s.yaw + turn * SPEEDER.turnRate * speedF * dt * (vf < 0 ? -1 : 1));
  s.turn = turn;
  // lateral grip (lets it drift a bit)
  vr -= vr * Math.min(1, SPEEDER.grip * dt);
  const nfx = -Math.sin(s.yaw), nfz = -Math.cos(s.yaw);
  const nrx = -nfz, nrz = nfx;
  s.vx = nfx * vf + nrx * vr;
  s.vz = nfz * vf + nrz * vr;
  // Hover spring
  const g = groundAt(W, s.x, s.z, s.y + 1.2, 0.8);
  const target = g + SPEEDER.hover;
  const err = target - s.y;
  s.vy += (err * 38 - s.vy * 7.5) * dt;
  s.vy -= 6 * dt;
  if (inp.hop && s.y - g < SPEEDER.hover + 0.3) s.vy = 7;
  const before = Math.hypot(s.vx, s.vz);
  s.onGround = false;
  const body = { x: s.x, y: s.y - 0.5, z: s.z, vx: s.vx, vy: s.vy, vz: s.vz, r: SPEEDER.r, h: SPEEDER.h, onGround: true };
  moveBody(W, body, dt, { noGravity: true, noSnap: true, canStep: true });
  s.x = body.x; s.z = body.z; s.vx = body.vx; s.vz = body.vz;
  s.y = Math.max(body.y + 0.5, g + 0.35);
  if (body.y + 0.5 < g + 0.35) s.vy = Math.max(s.vy, 0);
  else s.vy = body.vy;
  const after = Math.hypot(s.vx, s.vz);
  s.impact = body.hitWall ? Math.max(0, before - after) : 0;
  s.speed = after;
  s.pitchVis = clamp(-s.vy * 0.04, -0.3, 0.3);
  return s;
}
