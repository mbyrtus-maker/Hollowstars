// The worlds of the Hollow Reach the crew can fly between, and the ship that takes them there.
// Shared so the server validates travel and the client draws the star map and each world's look.

export const SHIP = {
  name: 'Wayfarer',
  model: 'Kestrel-class light freighter',
  seats: 4,
  jumpTime: 7.5, // seconds from launch to touchdown
};

export const PLANETS = {
  duskvaro: {
    name: 'Dusk Varo',
    blurb: 'A desert world stuck at sunset. Khet, Garrison Seven, and Oru Dask\'s job board.',
    settlement: 'Khet',
    site: 'Garrison Seven',
    arrival: 'The Khet job board is in the plaza.',
    map: [0.32, 0.58], color: '#ff9a5a',
    look: {
      fog: 0x7a4656, fogDensity: 0.0034,
      hemi: [0x8a76c8, 0x6a3e2a, 0.7], sun: [0xffa25a, 2.9], exposure: 1.05, env: 0.55,
      sky: { zenith: [0.035, 0.025, 0.11], mid: [0.19, 0.09, 0.27], horizon: [0.55, 0.27, 0.32], glow: [1.0, 0.52, 0.22], cloud: [0.36, 0.22, 0.38], cloudLit: [1.0, 0.6, 0.38], below: [0.3, 0.17, 0.2], stars: 1, moons: 1, cloudAmt: 0.7 },
      ground: 0x5a3426,
      terrain: { lo: 0xbf8550, hi: 0xdcaa70, rock: 0xa06450, rockHi: 0x7a5058, road: 0x9a7656, packed: 0xc29468, snowAbove: 0 },
      scatter: { rock: 0x9a6650, shrub: 0x6b6a3a, rocks: 700, shrubs: 450, trees: 0, reeds: 0 },
      weather: null,
    },
  },
  thessaly: {
    name: 'Thessaly Mire',
    blurb: 'Warm, drowned forest. The Concordance is stripping it with a harvester station.',
    settlement: 'Lowmarsh',
    site: 'Harvester Station Kappa',
    arrival: 'Vessa Moor is waiting in Lowmarsh.',
    map: [0.66, 0.34], color: '#7ee08a',
    look: {
      fog: 0x55705e, fogDensity: 0.0062,
      hemi: [0x9fc6b2, 0x2f3a22, 0.85], sun: [0xfff0c8, 2.2], exposure: 1.0, env: 0.5,
      sky: { zenith: [0.12, 0.2, 0.26], mid: [0.3, 0.42, 0.4], horizon: [0.45, 0.55, 0.47], glow: [1.0, 0.92, 0.7], cloud: [0.42, 0.5, 0.46], cloudLit: [0.9, 0.92, 0.82], below: [0.2, 0.26, 0.2], stars: 0, moons: 0, cloudAmt: 0.85 },
      ground: 0x2c3a24,
      terrain: { lo: 0x4a5a2e, hi: 0x6c7a3c, rock: 0x5a5a48, rockHi: 0x4a5a40, road: 0x6a5a40, packed: 0x6a6440, snowAbove: 0 },
      scatter: { rock: 0x5e6252, shrub: 0x4a7a34, rocks: 260, shrubs: 700, trees: 260, reeds: 900 },
      weather: 'spores',
    },
  },
  korrun: {
    name: 'Korrun Deep',
    blurb: 'An ice shelf over a frozen sea. Somewhere under Cryo-Vault Sigma is a codex the Reach needs.',
    settlement: 'Rime Hold',
    site: 'Cryo-Vault Sigma',
    arrival: 'Tobin Vale keeps the Thaw in Rime Hold.',
    map: [0.78, 0.74], color: '#9fdcff',
    look: {
      fog: 0xa8bccc, fogDensity: 0.0048,
      hemi: [0xc8dcff, 0x6a7888, 0.95], sun: [0xe8f0ff, 2.4], exposure: 1.0, env: 0.7,
      sky: { zenith: [0.1, 0.18, 0.34], mid: [0.32, 0.45, 0.62], horizon: [0.66, 0.74, 0.8], glow: [0.95, 0.95, 1.0], cloud: [0.6, 0.66, 0.74], cloudLit: [0.95, 0.97, 1.0], below: [0.5, 0.56, 0.62], stars: 0.4, moons: 0, cloudAmt: 0.75 },
      ground: 0x8a98a8,
      terrain: { lo: 0xc8d4de, hi: 0xeef4f8, rock: 0x6a7480, rockHi: 0x8a96a4, road: 0x9aa4ae, packed: 0xb0bac4, snowAbove: 1 },
      scatter: { rock: 0x7a8694, shrub: 0xb8c8d4, rocks: 600, shrubs: 0, trees: 0, reeds: 0, ice: 140 },
      weather: 'snow',
    },
  },
};

export const PLANET_ORDER = ['duskvaro', 'thessaly', 'korrun'];
