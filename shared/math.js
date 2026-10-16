// Shared math utilities used by both the server simulation and the client.

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const wrapAngle = (a) => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};
export const angleDiff = (a, b) => wrapAngle(b - a);
export const lerpAngle = (a, b, t) => a + angleDiff(a, b) * t;
export const dist2 = (ax, az, bx, bz) => {
  const dx = bx - ax, dz = bz - az;
  return Math.sqrt(dx * dx + dz * dz);
};
export const dist3 = (a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};
// Yaw convention: yaw = 0 faces -Z, positive yaw rotates toward -X (three.js Y rotation).
export const yawTo = (fx, fz, tx, tz) => Math.atan2(-(tx - fx), -(tz - fz));
export const forwardFromYaw = (yaw) => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });
export const dirFromYawPitch = (yaw, pitch) => {
  const c = Math.cos(pitch);
  return { x: -Math.sin(yaw) * c, y: Math.sin(pitch), z: -Math.cos(yaw) * c };
};

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(ix, iz, seed) {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function valueNoise(x, z, seed = 1) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uz) * 2 - 1;
}

export function fbm(x, z, octaves = 4, seed = 1) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, z * freq, seed + i * 17) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

// Distance from point to segment in XZ
export function distPointSegXZ(px, pz, ax, az, bx, bz) {
  const abx = bx - ax, abz = bz - az;
  const l = abx * abx + abz * abz;
  let t = l > 0 ? ((px - ax) * abx + (pz - az) * abz) / l : 0;
  t = clamp(t, 0, 1);
  return dist2(px, pz, ax + abx * t, az + abz * t);
}

// Closest distance between segment P0->P1 and vertical segment (cx, y0..y1, cz).
// Returns {d, t, y} where t is param along P segment.
export function segVsVertical(p0x, p0y, p0z, p1x, p1y, p1z, cx, y0, y1, cz) {
  // Sample-based closest approach in XZ, then clamp Y.
  const dx = p1x - p0x, dz = p1z - p0z;
  const l = dx * dx + dz * dz;
  let t = l > 1e-9 ? ((cx - p0x) * dx + (cz - p0z) * dz) / l : 0;
  t = clamp(t, 0, 1);
  const x = p0x + dx * t, z = p0z + dz * t, y = p0y + (p1y - p0y) * t;
  const dy = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
  const dh = dist2(x, z, cx, cz);
  return { d: Math.sqrt(dh * dh + dy * dy), t, y };
}
