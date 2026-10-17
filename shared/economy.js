// The economy of the Hollow Reach. Townsfolk grow, mine, hunt and log raw goods; makers
// turn them into parts; traders and the crew move goods between towns and worlds. Prices
// float with each town's stock. Parts buy upgrades for what a crew member owns.

export const GOODS = {
  grain: { name: 'Grain', base: 6, kind: 'raw', desc: 'Grown in the fields and greenhouses. Everyone eats.' },
  meat: { name: 'Game meat', base: 11, kind: 'raw', desc: 'Hunted from the herds.' },
  hide: { name: 'Hides', base: 15, kind: 'raw', desc: 'Tanned skins from the hunt. Makers weave them into armor.' },
  ore: { name: 'Raw ore', base: 13, kind: 'raw', desc: 'Dug from the cliffs. Smelted into alloy.' },
  timber: { name: 'Timber', base: 9, kind: 'raw', desc: 'Felled giants from Thessaly\'s drowned forest.' },
  resin: { name: 'Mire resin', base: 17, kind: 'raw', desc: 'Tapped from Thessaly\'s resin trees. Binds weave and boards.' },
  ice: { name: 'Coolant ice', base: 19, kind: 'raw', desc: 'Cut from Korrun\'s frozen sea. Every power cell needs it.' },
  scrap: { name: 'Salvage', base: 10, kind: 'raw', desc: 'Stripped from Concordance gear. Circuits start here.' },
  alloy: { name: 'Alloy plate', base: 52, kind: 'part', desc: 'Weapon frames, armor plates, hull patches.' },
  cell: { name: 'Power cell', base: 76, kind: 'part', desc: 'Energy for weapons, speeders and drives.' },
  weave: { name: 'Armorweave', base: 60, kind: 'part', desc: 'Layered hide and resin. Stops a bolt, mostly.' },
  circuit: { name: 'Circuit board', base: 92, kind: 'part', desc: 'Fine electronics for the good upgrades.' },
};
export const GOOD_ORDER = ['grain', 'meat', 'hide', 'ore', 'timber', 'resin', 'ice', 'scrap', 'alloy', 'cell', 'weave', 'circuit'];
export const RAW = GOOD_ORDER.filter((g) => GOODS[g].kind === 'raw');
export const PARTS = GOOD_ORDER.filter((g) => GOODS[g].kind === 'part');

// What a workshop needs to make one part (the crew pays a bench fee on top)
export const RECIPES = {
  alloy: { in: { ore: 3 }, fee: 12 },
  cell: { in: { ore: 1, ice: 2 }, fee: 18 },
  weave: { in: { hide: 2, resin: 1 }, fee: 14 },
  circuit: { in: { scrap: 2, resin: 1, timber: 1 }, fee: 22 },
};

// Things a crew member owns, each upgradable through three tiers with parts and credits
export const UPGRADES = {
  weapon: {
    name: 'Weapon', desc: 'Your class weapon: blaster, pistols, knives or arc blade.',
    tiers: [
      { cost: { alloy: 2, cell: 1 }, cr: 250, fx: '+12% damage' },
      { cost: { alloy: 4, cell: 2, circuit: 1 }, cr: 600, fx: '+24% damage' },
      { cost: { alloy: 6, cell: 3, circuit: 3 }, cr: 1400, fx: '+36% damage' },
    ],
  },
  armor: {
    name: 'Armor', desc: 'What you wear between you and the Concordance.',
    tiers: [
      { cost: { weave: 2, alloy: 1 }, cr: 200, fx: '+15 health' },
      { cost: { weave: 4, alloy: 2 }, cr: 500, fx: '+30 health' },
      { cost: { weave: 6, alloy: 3, circuit: 1 }, cr: 1200, fx: '+45 health' },
    ],
  },
  speeder: {
    name: 'Speeder tune', desc: 'How you ride any speeder bike: drive, cannons and plating.',
    tiers: [
      { cost: { cell: 1, alloy: 1 }, cr: 200, fx: '+10% speed, +15% cannons' },
      { cost: { cell: 2, alloy: 2, circuit: 1 }, cr: 550, fx: '+20% speed, +30% cannons' },
      { cost: { cell: 3, alloy: 3, circuit: 2 }, cr: 1100, fx: '+30% speed, +45% cannons' },
    ],
  },
  ship: {
    name: 'Wayfarer berth', desc: 'Your share of the Wayfarer: cargo locker and drive tuning.',
    tiers: [
      { cost: { alloy: 3, cell: 2 }, cr: 400, fx: '+20 cargo, faster jumps' },
      { cost: { alloy: 5, cell: 3, circuit: 2 }, cr: 900, fx: '+40 cargo, faster jumps' },
      { cost: { alloy: 8, cell: 5, circuit: 4 }, cr: 2000, fx: '+60 cargo, fastest jumps' },
    ],
  },
};
export const UPGRADE_ORDER = ['weapon', 'armor', 'speeder', 'ship'];
export const gearBonus = {
  damage: (t) => 1 + 0.12 * (t || 0),
  hp: (t) => 15 * (t || 0),
  speeder: (t) => 1 + 0.1 * (t || 0),
  cannon: (t) => 1 + 0.15 * (t || 0),
  cargo: (t) => 30 + 20 * (t || 0),
  jump: (t) => Math.max(3, 7.5 - 1.4 * (t || 0)),
};

// What each world makes plenty of and what it has to import. `make` are local producers;
// everything else arrives on trade ships.
export const TOWNS = {
  duskvaro: {
    name: 'Khet', exchange: 'khetExchange', workshop: 'voskWorks',
    target: { grain: 80, meat: 30, hide: 24, ore: 70, timber: 14, resin: 10, ice: 10, scrap: 20, alloy: 12, cell: 6, weave: 6, circuit: 4 },
    mult: { grain: 0.8, ore: 0.8, ice: 1.5, resin: 1.45, timber: 1.4, cell: 1.2 },
    eat: { grain: 3, meat: 1 }, // per minute
  },
  thessaly: {
    name: 'Lowmarsh', exchange: 'lowmarshPost', workshop: 'reedwright',
    target: { grain: 40, meat: 30, hide: 24, ore: 12, timber: 80, resin: 60, ice: 8, scrap: 12, alloy: 5, cell: 4, weave: 10, circuit: 6 },
    mult: { timber: 0.75, resin: 0.75, ore: 1.6, ice: 1.6, grain: 1.2, weave: 0.9, circuit: 0.9, alloy: 1.25 },
    eat: { grain: 2, meat: 1.4 },
  },
  korrun: {
    name: 'Rime Hold', exchange: 'rimeExchange', workshop: 'coldforge',
    target: { grain: 24, meat: 36, hide: 40, ore: 16, timber: 10, resin: 8, ice: 80, scrap: 14, alloy: 6, cell: 12, weave: 6, circuit: 4 },
    mult: { ice: 0.7, hide: 0.8, meat: 0.85, grain: 1.7, timber: 1.5, resin: 1.5, cell: 0.85 },
    eat: { grain: 2.2, meat: 1.6 },
  },
};

export function newMarket(planet) {
  const T = TOWNS[planet];
  const stock = {};
  for (const g of GOOD_ORDER) stock[g] = Math.round((T.target[g] || 10) * 0.9);
  return { planet, stock, ref: priceTable({ planet, stock }), lastShip: -999, tithe: 0, updatedAt: 0 };
}

// Mid price for one unit at the current stock
export function price(m, g) {
  const T = TOWNS[m.planet], G = GOODS[g];
  const target = T.target[g] || 10, s = Math.max(0, m.stock[g] || 0);
  const scarcity = Math.min(2.6, Math.max(0.45, Math.pow((target + 4) / (s + 4), 0.6)));
  return G.base * (T.mult[g] || 1) * scarcity;
}
export const buyPrice = (m, g) => Math.max(1, Math.ceil(price(m, g) * 1.08));
export const sellPrice = (m, g) => Math.max(1, Math.floor(price(m, g) * 0.86));
export function priceTable(m) { const o = {}; for (const g of GOOD_ORDER) o[g] = Math.round(price(m, g) * 10) / 10; return o; }

// Cost to buy n units one at a time (price rises as stock falls)
export function quoteBuy(m, g, n) {
  const s0 = m.stock[g];
  let total = 0;
  for (let i = 0; i < n; i++) { total += buyPrice(m, g); m.stock[g]--; }
  m.stock[g] = s0;
  return total;
}
export function quoteSell(m, g, n) {
  const s0 = m.stock[g];
  let total = 0;
  for (let i = 0; i < n; i++) { total += sellPrice(m, g); m.stock[g]++; }
  m.stock[g] = s0;
  return total;
}

export const packCount = (pack) => Object.values(pack || {}).reduce((a, b) => a + b, 0);
export function canAfford(pack, cost) { return Object.entries(cost).every(([g, n]) => (pack[g] || 0) >= n); }
export function spend(pack, cost) { for (const [g, n] of Object.entries(cost)) { pack[g] -= n; if (pack[g] <= 0) delete pack[g]; } }

// The world's slow background life: townsfolk eat, makers smelt when they can, stock
// drifts back toward normal through smuggling. Worker production happens in the AI.
export function marketTick(m, dt, rng) {
  const T = TOWNS[m.planet];
  for (const [g, perMin] of Object.entries(T.eat)) m.stock[g] = Math.max(0, m.stock[g] - (perMin * dt) / 60);
  for (const g of GOOD_ORDER) {
    const target = T.target[g] || 10;
    // goods nobody here produces trickle in or out slowly
    const k = 0.004 * dt;
    m.stock[g] += (target - m.stock[g]) * k * (rng() * 0.5 + 0.5);
  }
}
// A maker at the bench finishes a job: make the part the town is shortest on
export function makerWork(m) {
  const T = TOWNS[m.planet];
  let best = null, bestNeed = 0;
  for (const p of PARTS) {
    const r = RECIPES[p];
    if (!Object.entries(r.in).every(([g, n]) => m.stock[g] >= n + 2)) continue;
    const need = (T.target[p] || 6) / Math.max(1, m.stock[p]);
    if (need > bestNeed) { bestNeed = need; best = p; }
  }
  if (!best) return null;
  for (const [g, n] of Object.entries(RECIPES[best].in)) m.stock[g] -= n;
  m.stock[best] += 1;
  return best;
}
// A trader lands: sell what this town lacks, buy up what it has too much of
export function shipTrade(m, rng) {
  const T = TOWNS[m.planet];
  const moved = [];
  for (const g of GOOD_ORDER) {
    const target = T.target[g] || 10, s = m.stock[g];
    if (s < target * 0.6 && rng() < 0.75) { const n = Math.ceil((target * 0.8 - s) * (0.3 + rng() * 0.3)); m.stock[g] += n; moved.push([g, n]); }
    else if (s > target * 1.4 && rng() < 0.75) { const n = Math.ceil((s - target) * (0.3 + rng() * 0.3)); m.stock[g] -= n; moved.push([g, -n]); }
  }
  return moved;
}

// Compact view sent to clients
export function marketView(m) {
  const T = TOWNS[m.planet];
  const rows = GOOD_ORDER.map((g) => [g, Math.floor(m.stock[g]), buyPrice(m, g), sellPrice(m, g), Math.sign(Math.round((price(m, g) - m.ref[g]) * 2) / 2)]);
  return { town: T.name, rows };
}
