// Procedural, tileable PBR textures generated at load time: albedo, normal and roughness
// maps for sand, rock, adobe plaster, panelled metal, concrete, wood, crates, cloth and
// armour plate. No image files ship with the game.
import * as THREE from 'three';
import { mulberry32 } from '../../shared/math.js';

// ------------------------------------------------------------------ tileable noise

function hashGrid(cells, rng) {
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  return g;
}
// Periodic value noise sampled across a size×size tile; cx/cy cells per tile (can differ = stretch)
function noise(size, cx, cy, seed) {
  const rng = mulberry32(seed);
  const gw = Math.max(cx, cy);
  const g = hashGrid(gw, rng);
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * cy;
    const iy = Math.floor(fy), ty = fy - iy;
    const sy = ty * ty * (3 - 2 * ty);
    const y0 = iy % cy, y1 = (iy + 1) % cy;
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cx;
      const ix = Math.floor(fx), tx = fx - ix;
      const sx = tx * tx * (3 - 2 * tx);
      const x0 = ix % cx, x1 = (ix + 1) % cx;
      const a = g[y0 * gw + x0], b = g[y0 * gw + x1], c = g[y1 * gw + x0], d = g[y1 * gw + x1];
      out[y * size + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
  }
  return out;
}
function fbm(size, cx, cy, oct, seed, gain = 0.5) {
  const out = new Float32Array(size * size);
  let amp = 1, norm = 0;
  for (let o = 0; o < oct; o++) {
    const n = noise(size, cx << o, cy << o, seed + o * 101);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    norm += amp;
    amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}
// Periodic Worley noise: returns {f1, f2} distances in cell units
function worley(size, cells, seed) {
  const rng = mulberry32(seed);
  const pts = new Float32Array(cells * cells * 2);
  for (let i = 0; i < cells * cells; i++) { pts[i * 2] = rng(); pts[i * 2 + 1] = rng(); }
  const f1 = new Float32Array(size * size), f2 = new Float32Array(size * size), id = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * cells;
    const cy = Math.floor(fy);
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells;
      const cx = Math.floor(fx);
      let d1 = 9, d2 = 9, best = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const gx = (cx + ox + cells) % cells, gy = (cy + oy + cells) % cells;
        const k = gy * cells + gx;
        const px = cx + ox + pts[k * 2], py = cy + oy + pts[k * 2 + 1];
        const d = Math.hypot(px - fx, py - fy);
        if (d < d1) { d2 = d1; d1 = d; best = k; } else if (d < d2) d2 = d;
      }
      const i = y * size + x;
      f1[i] = d1; f2[i] = d2; id[i] = (best * 0.618034) % 1;
    }
  }
  return { f1, f2, id };
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------ packing

function normalFromHeight(H, size, strength) {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const xl = (x - 1 + size) % size, xr = (x + 1) % size, yd = (y - 1 + size) % size, yu = (y + 1) % size;
    const dx = (H[y * size + xr] - H[y * size + xl]) * strength;
    const dy = (H[yu * size + x] - H[yd * size + x]) * strength;
    let nx = -dx, ny = -dy, nz = 1;
    const l = Math.hypot(nx, ny, nz);
    const i = (y * size + x) * 4;
    out[i] = ((nx / l) * 0.5 + 0.5) * 255;
    out[i + 1] = ((ny / l) * 0.5 + 0.5) * 255;
    out[i + 2] = ((nz / l) * 0.5 + 0.5) * 255;
    out[i + 3] = 255;
  }
  return out;
}

function dataTex(data, size, srgb, repeat = 1) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = ANISO;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(repeat, repeat);
  t.needsUpdate = true;
  return t;
}
let ANISO = 4;
export function setAnisotropy(a) { ANISO = Math.min(8, a || 4); }

function pack(size, fill) {
  // fill(i, x, y) -> [r,g,b,height,rough]
  const alb = new Uint8Array(size * size * 4), rough = new Uint8Array(size * size * 4), H = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const [r, g, b, h, ro] = fill(i, x, y);
    alb[i * 4] = Math.max(0, Math.min(255, r * 255)); alb[i * 4 + 1] = Math.max(0, Math.min(255, g * 255)); alb[i * 4 + 2] = Math.max(0, Math.min(255, b * 255)); alb[i * 4 + 3] = 255;
    const rv = Math.max(0, Math.min(255, ro * 255));
    rough[i * 4] = rv; rough[i * 4 + 1] = rv; rough[i * 4 + 2] = rv; rough[i * 4 + 3] = 255;
    H[i] = h;
  }
  return { alb, rough, H };
}

function finish({ alb, rough, H }, size, strength) {
  return { map: dataTex(alb, size, true), normalMap: dataTex(normalFromHeight(H, size, strength), size, false), roughnessMap: dataTex(rough, size, false) };
}

// ------------------------------------------------------------------ recipes

function sand() {
  const S = 512;
  const base = fbm(S, 6, 6, 5, 11);
  const warp = fbm(S, 3, 3, 3, 23);
  const grain = noise(S, 160, 160, 37);
  const grain2 = noise(S, 64, 64, 41);
  const peb = worley(S, 22, 53);
  return finish(pack(S, (i, x, y) => {
    const rip = Math.sin(((y / S) * 18 + warp[i] * 3.2 + base[i] * 0.8) * Math.PI * 2);
    const ripple = Math.pow(rip * 0.5 + 0.5, 2.2);
    const pebble = 1 - smooth(0.05, 0.16, peb.f1[i]);
    const pebbleOn = peb.id[i] > 0.82 ? 1 : 0;
    const l = 0.86 + (base[i] - 0.5) * 0.22 + (grain[i] - 0.5) * 0.12 + (grain2[i] - 0.5) * 0.06 - pebble * pebbleOn * 0.25 + ripple * 0.04;
    const h = ripple * 0.55 + base[i] * 0.3 + grain[i] * 0.12 + pebble * pebbleOn * 0.6;
    return [l * 1.02, l * 0.98, l * 0.93, h, 0.92 + grain[i] * 0.08];
  }), S, 3.2);
}

function rock() {
  const S = 512;
  const base = fbm(S, 4, 4, 6, 71);
  const warp = fbm(S, 2, 2, 3, 79);
  const cr = worley(S, 7, 83);
  const fine = noise(S, 96, 96, 89);
  return finish(pack(S, (i, x, y) => {
    const strata = Math.sin(((y / S) * 9 + warp[i] * 2.4) * Math.PI * 2) * 0.5 + 0.5;
    const crack = 1 - smooth(0.0, 0.07, cr.f2[i] - cr.f1[i]);
    const band = strata > 0.6 ? 1.06 : 0.94;
    const l = (0.78 + (base[i] - 0.5) * 0.35 + (fine[i] - 0.5) * 0.12) * band - crack * 0.32;
    const h = base[i] * 0.8 + strata * 0.3 + fine[i] * 0.15 - crack * 0.9;
    return [l * 1.04, l * 0.94, l * 0.88, h, 0.85 + fine[i] * 0.12];
  }), S, 4.5);
}

function adobe() {
  const S = 512;
  const mott = fbm(S, 4, 4, 5, 101);
  const trowel = fbm(S, 3, 12, 3, 107);
  const pits = noise(S, 128, 128, 109);
  const ridge = fbm(S, 5, 5, 4, 113);
  const stain = fbm(S, 2, 6, 4, 127);
  return finish(pack(S, (i) => {
    const crack = Math.abs(ridge[i] - 0.5) < 0.012 ? 1 : 0;
    const pit = pits[i] > 0.86 ? (pits[i] - 0.86) * 6 : 0;
    const st = smooth(0.55, 0.85, stain[i]);
    const l = 0.92 + (mott[i] - 0.5) * 0.2 + (trowel[i] - 0.5) * 0.08 - crack * 0.25 - pit * 0.15 - st * 0.12;
    const h = mott[i] * 0.35 + trowel[i] * 0.4 - crack * 0.5 - pit * 0.4;
    return [l * 1.02, l * 0.97, l * 0.92, h, 0.93];
  }), S, 2.6);
}

function metal() {
  const S = 512;
  const grime = fbm(S, 8, 2, 5, 131);
  const blot = fbm(S, 4, 4, 4, 137);
  const fine = noise(S, 200, 200, 139);
  const rng = mulberry32(149);
  const scratch = new Float32Array(S * S);
  for (let k = 0; k < 140; k++) {
    let x = rng() * S, y = rng() * S;
    const a = rng() * Math.PI, len = 10 + rng() * 60;
    for (let s = 0; s < len; s++) {
      const xi = Math.floor(x + Math.cos(a) * s + S) % S, yi = Math.floor(y + Math.sin(a) * s + S) % S;
      scratch[yi * S + xi] = 1;
    }
  }
  const PX = 4, PY = 2; // panels per tile
  return finish(pack(S, (i, x, y) => {
    const u = (x / S) * PX, v = (y / S) * PY;
    const fu = u - Math.floor(u), fv = v - Math.floor(v);
    const seamW = 0.012 * PX;
    const seam = Math.min(fu, 1 - fu) < seamW / PX * 1.6 || Math.min(fv, 1 - fv) < seamW / PY * 1.6 ? 1 : 0;
    // rivets along panel edges
    const ru = fu * 10, rv = fv * 5;
    const nearEdgeU = Math.min(fu, 1 - fu) < 0.06, nearEdgeV = Math.min(fv, 1 - fv) < 0.08;
    const dx = (ru - Math.round(ru)), dy = (rv - Math.round(rv));
    const rivet = (nearEdgeU || nearEdgeV) && Math.hypot(dx * 0.6, dy * 1.2) < 0.12 ? 1 : 0;
    const panelTone = (Math.floor(u) * 7 + Math.floor(v) * 13) % 5 / 5;
    const g = smooth(0.5, 0.8, grime[i]);
    const sc = scratch[i];
    const l = 0.86 + (panelTone - 0.5) * 0.08 + (blot[i] - 0.5) * 0.1 - g * 0.22 - seam * 0.4 + sc * 0.12 + rivet * 0.08 + (fine[i] - 0.5) * 0.04;
    const h = 0.5 - seam * 0.5 + rivet * 0.6 + fine[i] * 0.03 - sc * 0.05;
    return [l, l * 1.005, l * 1.02, h, 0.42 + g * 0.35 + seam * 0.2 - sc * 0.15 + fine[i] * 0.06];
  }), S, 5);
}

function concrete() {
  const S = 256;
  const base = fbm(S, 4, 4, 5, 151);
  const spk = noise(S, 128, 128, 157);
  const cr = fbm(S, 6, 6, 4, 163);
  return finish(pack(S, (i, x, y) => {
    const joint = (x % (S / 2) < 2 || y % (S / 2) < 2) ? 1 : 0;
    const crack = Math.abs(cr[i] - 0.5) < 0.0035 ? 1 : 0;
    const sp = spk[i] > 0.82 ? 0.05 : spk[i] < 0.12 ? -0.05 : 0;
    const l = 0.9 + (base[i] - 0.5) * 0.14 + sp - joint * 0.3 - crack * 0.1;
    const h = base[i] * 0.3 + spk[i] * 0.08 - joint * 0.6 - crack * 0.2;
    return [l, l, l * 0.98, h, 0.9];
  }), S, 2.2);
}

function wood() {
  const S = 256;
  const grain = fbm(S, 3, 40, 4, 171);
  const knots = worley(S, 5, 173);
  const planks = 6;
  return finish(pack(S, (i, x, y) => {
    const v = (y / S) * planks;
    const p = Math.floor(v), fv = v - p;
    const gap = fv < 0.05 || fv > 0.97 ? 1 : 0;
    const tone = ((p * 37) % 7) / 7;
    const ring = Math.sin((grain[i] * 18 + (x / S) * 2) * Math.PI) * 0.5 + 0.5;
    const knot = 1 - smooth(0.0, 0.12, knots.f1[i]);
    const l = 0.82 + (tone - 0.5) * 0.18 + (ring - 0.5) * 0.12 - knot * 0.25 - gap * 0.55;
    const h = 0.5 + ring * 0.1 - gap * 0.6 - knot * 0.1;
    return [l * 1.05, l * 0.97, l * 0.88, h, 0.78 + ring * 0.1];
  }), S, 3);
}

function crate() {
  const S = 256;
  const grain = fbm(S, 2, 24, 4, 181);
  const dirt = fbm(S, 4, 4, 4, 191);
  return finish(pack(S, (i, x, y) => {
    const u = x / S, v = y / S;
    const frame = u < 0.1 || u > 0.9 || v < 0.1 || v > 0.9;
    const diag = Math.abs(u - v) < 0.06 || Math.abs(u - (1 - v)) < 0.06;
    const slat = Math.floor(u * 5);
    const gap = !frame && (u * 5 - slat) < 0.06;
    const corner = (u < 0.14 || u > 0.86) && (v < 0.14 || v > 0.86);
    const stencil = !frame && v > 0.4 && v < 0.6 && u > 0.3 && u < 0.7 && Math.sin(u * 60) > 0.2 && !diag;
    let l = 0.82 + (grain[i] - 0.5) * 0.2 + ((slat * 13) % 5) / 30 - (dirt[i] - 0.5) * 0.12;
    let h = 0.4 + grain[i] * 0.05;
    let r = 0.85;
    if (frame || diag) { l *= 0.82; h = 0.75; }
    if (gap) { l *= 0.45; h = 0.1; }
    if (corner) { l = 0.55; h = 0.85; r = 0.45; }
    if (stencil) l *= 0.7;
    return corner ? [l, l, l * 1.05, h, r] : [l * 1.06, l * 0.96, l * 0.84, h, r];
  }), S, 4);
}

function cloth() {
  const S = 256;
  const fib = noise(S, 128, 8, 201);
  const blot = fbm(S, 3, 3, 4, 211);
  const f = 48;
  return finish(pack(S, (i, x, y) => {
    const a = Math.sin((x / S) * f * Math.PI * 2), b = Math.sin((y / S) * f * Math.PI * 2);
    const over = (Math.floor((x / S) * f * 2) + Math.floor((y / S) * f * 2)) % 2 ? a : b;
    const weave = over * 0.5 + 0.5;
    const l = 0.88 + (weave - 0.5) * 0.14 + (fib[i] - 0.5) * 0.08 + (blot[i] - 0.5) * 0.14;
    return [l, l, l, weave * 0.6 + fib[i] * 0.2, 0.97];
  }), S, 2.5);
}

function plate() {
  const S = 256;
  const base = fbm(S, 4, 4, 4, 221);
  const fine = noise(S, 128, 128, 223);
  const rng = mulberry32(227);
  const sc = new Float32Array(S * S);
  for (let k = 0; k < 60; k++) {
    let x = rng() * S, y = rng() * S;
    const a = rng() * Math.PI, len = 6 + rng() * 30;
    for (let s = 0; s < len; s++) sc[(Math.floor(y + Math.sin(a) * s + S) % S) * S + (Math.floor(x + Math.cos(a) * s + S) % S)] = 1;
  }
  return finish(pack(S, (i, x, y) => {
    const edge = x < 6 || x > S - 7 || y < 6 || y > S - 7 ? 1 : 0;
    const l = 0.9 + (base[i] - 0.5) * 0.12 + sc[i] * 0.15 - edge * 0.15 + (fine[i] - 0.5) * 0.03;
    return [l, l, l * 1.02, 0.5 + edge * 0.3 - sc[i] * 0.1 + fine[i] * 0.03, 0.38 + (base[i] - 0.5) * 0.2 - sc[i] * 0.1];
  }), S, 3);
}

// ------------------------------------------------------------------ public API

let LIB = null;
export function textures() {
  if (LIB) return LIB;
  const t0 = performance.now();
  LIB = { sand: sand(), rock: rock(), adobe: adobe(), metal: metal(), concrete: concrete(), wood: wood(), crate: crate(), cloth: cloth(), plate: plate() };
  LIB.ms = Math.round(performance.now() - t0);
  return LIB;
}

// Copy of a texture set with a different repeat (shares the pixel data)
export function repeated(set, r) {
  const out = {};
  for (const k of ['map', 'normalMap', 'roughnessMap']) { const t = set[k].clone(); t.repeat.set(r, r); t.needsUpdate = true; out[k] = t; }
  return out;
}

// World-space box mapping: each vertex picks the axis its normal faces most.
export function applyWorldUV(geo, scale) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ay >= ax && ay >= az) { u = p.getX(i); v = p.getZ(i); }
    else if (ax >= az) { u = p.getZ(i); v = p.getY(i); }
    else { u = p.getX(i); v = p.getY(i); }
    uv[i * 2] = u / scale; uv[i * 2 + 1] = v / scale;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}
