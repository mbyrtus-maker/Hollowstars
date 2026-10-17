// Trader ships coming and going from each town's spaceport. The schedule is a pure function
// of game time, so the host's simulation and every client agree without extra messages.

export const NPC_SHIPS = {
  hauler: { name: 'Mulehorn bulk hauler', trade: 1.0 },
  skiff: { name: 'Swiftwater courier skiff', trade: 0.4 },
  lander: { name: 'Pilgrim lander', trade: 0.6 },
};
const TYPES = ['hauler', 'skiff', 'lander', 'hauler', 'skiff'];
export const PAD_TIMES = { cycle: 165, arrive: 14, stay: 75, depart: 12 };

const hash = (n) => { let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); return (h ^ (h >>> 16)) >>> 0; };

export function padState(i, time) {
  const { cycle, arrive, stay, depart } = PAD_TIMES;
  const t = time + i * 71 + 40;
  const n = Math.floor(t / cycle), u = t - n * cycle;
  const type = TYPES[hash(n * 31 + i * 7) % TYPES.length];
  if (u < arrive) return { phase: 'arrive', k: u / arrive, type, n };
  if (u < arrive + stay) return { phase: 'landed', k: (u - arrive) / stay, type, n };
  if (u < arrive + stay + depart) return { phase: 'depart', k: (u - arrive - stay) / depart, type, n };
  return { phase: 'empty', k: 0, type, n };
}
