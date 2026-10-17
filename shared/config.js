// Game-wide tuning, item and mission definitions. Shared by server and client.

export const GAME_TITLE = 'HOLLOW STARS';
export const TICK_RATE = 20; // server simulation ticks per second
export const TICK_DT = 1 / TICK_RATE;
export const INPUT_RATE = 30; // client input messages per second
export const INTERP_DELAY = 0.11; // seconds remote entities are rendered in the past
export const MAX_PLAYERS = 4;

export const GRAVITY = 22;

export const PLAYER = {
  radius: 0.4,
  height: 1.8,
  crouchHeight: 1.05,
  walk: 5.6,
  sprint: 9.2,
  crouchSpeed: 2.7,
  blockSpeed: 3.6,
  accelGround: 55,
  accelAir: 14,
  jump: 7.6,
  leapMax: 15.5,
  leapForward: 11,
  leapChargeTime: 0.55,
  maxHp: 100,
  maxFocus: 100,
  focusRegen: 9,
  focusRegenDelay: 0.9,
  bleedout: 30,
  soloBleedout: 6,
  reviveTime: 3,
  respawnDelay: 4,
};

export const WEAPONS = {
  blaster: {
    damage: 26,
    boltSpeed: 95,
    fireInterval: 0.2,
    heatPerShot: 0.085,
    coolRate: 0.55,
    overheatCooldown: 1.6,
    noise: 42,
    spread: 0.004,
  },
  enemyBlaster: { damage: 9, boltSpeed: 62, noise: 38 },
  officerBlaster: { damage: 13, boltSpeed: 66, noise: 38 },
  speederCannon: { damage: 34, boltSpeed: 140, fireInterval: 0.16, noise: 50 },
  blade: {
    damage: 85,
    range: 2.7,
    arc: 1.05, // radians half-angle
    swingTime: 0.42,
    deflectCone: 1.15, // half-angle of frontal block arc (holding block)
    autoDeflectCone: 1.0, // half-angle covered automatically whenever the blade is drawn
    autoDeflectFocus: 1.5,
    deflectAssist: 0.12, // radians: deflections snap to an enemy this close to your aim
    deflectFocus: 4,
    perfectWindow: 0.3,
    noise: 6,
  },
  grenade: {
    damage: 130,
    radius: 7.5,
    fuse: 2.6,
    noiseFuse: 3.0, // noisemakers need time to land before they start clattering
    throwSpeed: 27, // m/s along the aim: a 30-40 m lob at a comfortable upward angle
    throwLift: 4.5,
    noise: 75,
  },
};

// Extra weapons used by the crew classes. 'blaster' above is the Soldier's rifle.
Object.assign(WEAPONS, {
  pistols: { damage: 18, boltSpeed: 100, fireInterval: 0.12, heatPerShot: 0.055, coolRate: 0.75, overheatCooldown: 1.3, noise: 36, spread: 0.006 },
  pistol: { damage: 24, boltSpeed: 95, fireInterval: 0.24, heatPerShot: 0.07, coolRate: 0.7, overheatCooldown: 1.3, noise: 34, spread: 0.005 },
  knives: { damage: 55, range: 2.2, arc: 0.95, swingTime: 0.3, noise: 2 },
  thrownKnife: { damage: 80, speed: 48, noise: 0 },
  // Sniper's long-las: one heavy, fast bolt; a body shot drops a trooper, a head shot drops an officer
  longlas: { damage: 88, boltSpeed: 230, fireInterval: 1.1, heatPerShot: 0.3, coolRate: 0.5, overheatCooldown: 2, noise: 48, spread: 0.0008 },
  // Agent's suppressed sidearm: quiet enough to use inside a garrison
  silenced: { damage: 32, boltSpeed: 110, fireInterval: 0.32, heatPerShot: 0.09, coolRate: 0.7, overheatCooldown: 1.3, noise: 7, spread: 0.004 },
  wristRocket: { damage: 70, speed: 48, radius: 4.5 },
  swarmRocket: { damage: 45, speed: 38, radius: 3.2 },
  mine: { damage: 160, radius: 6, trigger: 3.2, arm: 1.5 },
});
export const RANGED = ['blaster', 'pistols', 'pistol', 'longlas', 'silenced'];

// Crew classes, chosen at startup. Abilities live on Q, F and X.
export const CLASSES = {
  warden: {
    name: 'Warden', role: 'Current wielder', weapon: 'blade', weaponName: 'Arc blade',
    desc: 'Arc blade and the Current. No blaster. The Concordance has a bounty on every Warden: guards spot you faster and hunter squads track you in the open.',
    grenades: 1, maxGrenades: 3, medpacks: 2, maxMedpacks: 4, leap: true, wanted: true, focus: true,
    abilities: { q: { id: 'push', name: 'Push' }, f: { id: 'pull', name: 'Pull' }, x: { id: 'suggest', name: 'Suggest' } },
  },
  gunslinger: {
    name: 'Gunslinger', role: 'Dual pistols', weapon: 'pistols', weaponName: 'Twin DL-6 pistols',
    desc: 'Fast, accurate dual pistols. Fan the hammer to empty a burst, roll out of trouble, and line up a deadeye streak.',
    grenades: 2, maxGrenades: 4, medpacks: 2, maxMedpacks: 4,
    abilities: { q: { id: 'fan', name: 'Fan fire', cd: 9 }, f: { id: 'roll', name: 'Dodge roll', cd: 3.5 }, x: { id: 'deadeye', name: 'Deadeye', cd: 18, dur: 6 } },
  },
  soldier: {
    name: 'Soldier', role: 'Rifle and charges', weapon: 'blaster', weaponName: 'K-9 assault rifle',
    desc: 'A heavy rifle and a belt of thermal charges. Lay down suppressive fire without overheating, and raise a kinetic bulwark.',
    grenades: 5, maxGrenades: 8, medpacks: 2, maxMedpacks: 4,
    abilities: { q: { id: 'suppress', name: 'Suppressive fire', cd: 16, dur: 6 }, f: { id: 'bulwark', name: 'Bulwark', cd: 18, dur: 8 } },
  },
  medic: {
    name: 'Medic', role: 'Pistol and stims', weapon: 'pistol', weaponName: 'Kestrel sidearm',
    desc: 'A sidearm and a satchel of stim packs. Fire a stim dart into a teammate, even a downed one, or flood the area with a healing burst. Revives in a second.',
    grenades: 1, maxGrenades: 3, medpacks: 6, maxMedpacks: 8, consumable: 'Stims',
    abilities: { q: { id: 'burst', name: 'Med burst', cd: 22 }, f: { id: 'dart', name: 'Stim dart', cd: 5 } },
  },
  spy: {
    name: 'Spy', role: 'Cloak and knives', weapon: 'knives', weaponName: 'Vibro-knives',
    desc: 'Twin vibro-knives and a cloaking device. Execute guards from the shadows, throw silent knives, and toss noisemakers to pull patrols away.',
    grenades: 3, maxGrenades: 5, medpacks: 2, maxMedpacks: 4, throwable: 'Noisemakers',
    abilities: { q: { id: 'execute', name: 'Execute', cd: 10 }, f: { id: 'knife', name: 'Throw knife', charges: 3, recharge: 6 }, x: { id: 'cloak', name: 'Cloak', cd: 14, dur: 8 } },
  },
  sniper: {
    name: 'Sniper', role: 'Long-las and recon', weapon: 'longlas', weaponName: 'LR-9 long-las',
    desc: 'A long-las that drops a trooper with one bolt. Hold right mouse to scope in. Mark enemies for the crew, mine the approaches, and stay still and low to all but vanish.',
    grenades: 1, maxGrenades: 3, medpacks: 2, maxMedpacks: 4, camo: 0.55,
    abilities: { q: { id: 'overcharge', name: 'Overcharged shot', cd: 12, dur: 8 }, f: { id: 'mine', name: 'Proximity mine', charges: 2, recharge: 20 }, x: { id: 'recon', name: 'Recon sweep', cd: 26 } },
  },
};

// Advanced classes: unlocked at level 10, each grows out of one base class. Anything not
// listed falls back to the base class.
export const ADVANCED = {
  guardian: {
    base: 'warden', name: 'Guardian', role: 'Shield of the crew', hp: 30,
    desc: 'A Warden who stands between the crew and the guns. The blade catches bolts across a wider arc, and the Bastion dome stops every bolt fired into it.',
    deflectCone: 1.4,
    abilities: { x: { id: 'bastion', name: 'Bastion', cd: 24, dur: 6 } },
  },
  bounty: {
    base: 'gunslinger', name: 'Bounty Hunter', role: 'Marks and rockets', hp: 15, creditBonus: 0.25,
    desc: 'Marks a target for the crew to tear apart, fires a wrist rocket, and collects a quarter more on every kill.',
    abilities: { f: { id: 'rocket', name: 'Wrist rocket', cd: 9 }, x: { id: 'bounty', name: 'Mark bounty', cd: 20, dur: 20 } },
  },
  commando: {
    base: 'soldier', name: 'Commando', role: 'Jump jets and rockets', hp: 30, grenades: 2,
    desc: 'Heavier armor, jump jets that throw you over walls, and a shoulder pod that fires homing rockets at everything in front of you.',
    abilities: { f: { id: 'jets', name: 'Jump jets', cd: 7 }, x: { id: 'swarm', name: 'Swarm rockets', cd: 22 } },
  },
  surgeon: {
    base: 'medic', name: 'Combat Surgeon', role: 'Adrenaline and triage', hp: 20, healBonus: 0.3,
    desc: 'Heals hit 30% harder, and an adrenaline surge gives everyone nearby an overshield and a quarter more damage.',
    abilities: { x: { id: 'adrenal', name: 'Adrenaline', cd: 26, dur: 8 } },
  },
  agent: {
    base: 'spy', name: 'Agent', role: 'Suppressed pistol and decoys', weapon: 'silenced', weaponName: 'Whisper suppressed pistol', hp: 10, detect: 0.75, sliceSpeed: 2,
    desc: 'A suppressed pistol guards can barely hear, a holo-decoy that pulls patrols away, slicing twice as fast, and guards notice you a quarter slower.',
    abilities: { f: { id: 'decoy', name: 'Holo-decoy', cd: 16, dur: 10 } },
  },
  phantom: {
    base: 'sniper', name: 'Phantom', role: 'Phase cloak and ghost shots', hp: 10, camo: 0.3,
    desc: 'Phase-cloak and take one shot without breaking it, for half again the damage. Overcharged shots punch through every target in line.',
    abilities: { x: { id: 'phase', name: 'Phase cloak', cd: 18, dur: 8 } },
  },
};

// The class a player actually plays: their base class with any advanced class laid over it
const CLASS_CACHE = new Map();
export function effectiveClass(cls, adv) {
  const key = cls + '/' + (adv || '');
  if (CLASS_CACHE.has(key)) return CLASS_CACHE.get(key);
  const B = CLASSES[cls] || CLASSES.soldier, A = adv && ADVANCED[adv] && ADVANCED[adv].base === cls ? ADVANCED[adv] : null;
  const out = A ? { ...B, ...A, name: A.name, base: cls, adv, abilities: { ...B.abilities, ...A.abilities } } : { ...B, base: cls, adv: null };
  if (A && A.grenades) { out.grenades = B.grenades + A.grenades; out.maxGrenades = B.maxGrenades + A.grenades; }
  if (A) out.weapon = A.weapon || B.weapon, out.weaponName = A.weaponName || B.weaponName;
  CLASS_CACHE.set(key, out);
  return out;
}
export const advancedFor = (cls) => Object.entries(ADVANCED).filter(([, a]) => a.base === cls).map(([id]) => id);

// Experience: every level adds a little health and shaves ability cooldowns
export const LEVELS = { max: 20, advancedAt: 10, hpPer: 3, cdPer: 0.01 };
export const xpToNext = (lv) => 100 + 50 * (lv - 1);
export function levelOf(xp) {
  let lv = 1, need = xpToNext(1), left = xp;
  while (lv < LEVELS.max && left >= need) { left -= need; lv++; need = xpToNext(lv); }
  return { lv, into: left, need: lv >= LEVELS.max ? 0 : need };
}
export const XP = { lancer: 25, officer: 100, camera: 10, critter: 6, silent: 15, gather: 4, craft: 5, upgrade: 25, revive: 20, sabotage: 30, bounty: 60 };
export const DEFAULT_CLASS = 'soldier';

export const POWERS = {
  push: { cost: 30, cooldown: 1.0, range: 14, halfAngle: 0.65, force: 15, lift: 6.5, damage: 15, noise: 10 },
  pull: { cost: 25, cooldown: 1.0, range: 26, aimCone: 0.2, force: 16, stun: 1.1 },
  leap: { cost: 20 },
  shroud: { cost: 40, cooldown: 4, duration: 7, visibility: 0.3 },
  suggest: { cost: 30, cooldown: 6, range: 22, forget: 15 },
  cloak: { visibility: 0.06 },
};

export const STEALTH = {
  visionRange: 34,
  alertVisionRange: 52,
  visionHalfAngle: 0.95, // ~55 degrees
  peripheralRange: 4,
  suspiciousAt: 0.35,
  detectRate: 1.15,
  decayRate: 0.18,
  raiseAlarmDelay: 4.0, // an alerted guard reaches the alarm after this long
  corpseAlarmDelay: 3.0,
  cameraRange: 27,
  cameraHalfAngle: 0.55,
  alarmDuration: 75,
  alarmQuiet: 30, // seconds without a sighting before the alarm resets
  reinforceInterval: 16,
  maxGuards: 26,
};

// Credits and items. "kind": consumable stacks; "upgrade": permanent.
export const ITEMS = {
  grenade: { name: 'Thermal Charge', kind: 'consumable', price: 120, max: 6, desc: 'Bouncing fused explosive. Big noise, bigger results.' },
  medpack: { name: 'Bacta-free Medpack', kind: 'consumable', price: 90, max: 4, desc: 'Restores 60 health over two seconds. Press H.' },
  coil: { name: 'Heavy Bolt Coil', kind: 'upgrade', price: 900, desc: 'Blaster bolts hit 40% harder.' },
  cyclic: { name: 'Cyclic Emitter', kind: 'upgrade', price: 800, desc: 'Fire 35% faster and build less heat.' },
  damper: { name: 'Damped Emitter', kind: 'upgrade', price: 700, desc: 'Your shots are only audible up close. A thief\'s best friend.' },
  shield: { name: 'Kinetic Shield Belt', kind: 'upgrade', price: 1100, desc: '+50 regenerating shield.' },
  attune: { name: 'Current Attunement', kind: 'upgrade', price: 1000, desc: 'Focus regenerates 50% faster; powers cost less.' },
  weave: { name: 'Shroud Weave Cloak', kind: 'upgrade', price: 600, desc: 'Guards see you 25% less while crouched.' },
};

export const MERCHANTS = {
  teska: { name: 'Teska Vool', title: 'Arms & Oddments', stock: ['coil', 'cyclic', 'damper', 'shield'], greet: 'Credits talk, friend. Everything else whispers.' },
  bram: { name: 'Old Bram', title: 'Provisions', stock: ['grenade', 'medpack', 'attune', 'weave'], greet: 'Charges, meds, and a little something for the mind.' },
  grell: { name: 'Grell Asko', title: 'Marsh Salvage', stock: ['grenade', 'medpack', 'damper', 'weave'], greet: 'Everything here was pulled out of the mud. Most of it still works.' },
  khetExchange: { name: 'Mara Quill', title: 'Khet Exchange', type: 'exchange', stock: [], greet: 'Grain, ore, hides. Everything has a price, and today\'s is on the board.' },
  voskWorks: { name: 'Vosk Tamrin', title: 'Vosk Fabrication', type: 'workshop', stock: [], greet: 'Bring me parts and I\'ll make your kit sing.' },
  lowmarshPost: { name: 'Ennis Garde', title: 'Lowmarsh Trading Post', type: 'exchange', stock: [], greet: 'Timber and resin we have. Ore we pay well for.' },
  reedwright: { name: 'Old Pell', title: 'Reedwright\'s Workshop', type: 'workshop', stock: [], greet: 'Resin binds anything. Even you, if you stand still too long.' },
  rimeExchange: { name: 'Ilka Fenn', title: 'Rime Exchange', type: 'exchange', stock: [], greet: 'Ice is cheap here. Grain is not. Plan accordingly.' },
  coldforge: { name: 'Dorrin Hask', title: 'Coldforge', type: 'workshop', stock: [], greet: 'Cold steel holds an edge. What are we building?' },
  sava: { name: 'Sava Rook', title: 'Cold-Weather Outfitter', stock: ['medpack', 'grenade', 'shield', 'cyclic'], greet: 'Out here, the cold kills more troopers than you will. Buy something warm.' },
};

export const START_CREDITS = 300;

// Mission definitions. Logic lives in shared/sim/missions.js; this is presentation data.
export const MISSIONS = {
  rescue: {
    name: 'The Silent Key',
    type: 'Rescue',
    giver: 'Oru Dask',
    brief: 'The Concordance took Ilsa Varn, a courier who knows too much. Get the cell code from Oru in the cantina, break her out of Garrison Seven, and walk her to the Ridge LZ.',
    reward: 1500,
    ghostBonus: 750,
  },
  heist: {
    name: 'Ghost in the Vault',
    type: 'Stealth Heist',
    giver: 'Oru Dask',
    brief: 'Commander Rhal carries the vault keycard. Lift it from him — quietly or not — slice the command vault, and get the data core to the Ridge LZ.',
    reward: 2000,
    ghostBonus: 1000,
  },
  sabotage: {
    name: 'Scorched Earth',
    type: 'Destroy',
    giver: 'Oru Dask',
    brief: 'Garrison Seven fuels the Concordance tribute fleet. Topple the comms mast so they cannot call for help, burn all four fuel tanks, and take down Commander Rhal.',
    reward: 1800,
    ghostBonus: 0,
  },
  mire: {
    name: 'Roots of Rebellion',
    type: 'Destroy · Off-world',
    giver: 'Oru Dask',
    planet: 'thessaly',
    brief: 'Fly the Wayfarer to Thessaly Mire. Meet Vessa Moor in Lowmarsh, knock out the three power cells feeding Harvester Station Kappa, and cut the captured woodcutters out of their pen. Then fly home and report to Oru.',
    reward: 2600,
    ghostBonus: 0,
  },
  cold: {
    name: 'Cold Storage',
    type: 'Stealth Heist · Off-world',
    giver: 'Oru Dask',
    planet: 'korrun',
    brief: 'Fly to Korrun Deep. Tobin Vale in Rime Hold has the code to Cryo-Vault Sigma. Get inside, slice the cryo-archive for the Ashfall Codex, and bring it back to Oru on Dusk Varo.',
    reward: 3200,
    ghostBonus: 1200,
  },
};

export const PLAYER_COLORS = ['#3fb6ff', '#7dff6a', '#ffb13b', '#e86bff'];
export const BLADE_COLORS = ['#4fc8ff', '#6dff7a', '#ffd04a', '#d77bff'];

// Entity kinds in snapshots
export const K = {
  PLAYER: 1, LANCER: 2, OFFICER: 3, CIVILIAN: 4, MERCHANT: 5, INFORMANT: 6, PRISONER: 7,
  CRITTER: 8, CAMERA: 9, SPEEDER: 10, PICKUP: 11, BARTENDER: 12, GRENADE: 13, TRAFFIC: 14, MINE: 15, DECOY: 16,
};

// Entity flag bits in snapshots
export const F = {
  CROUCH: 1, BLOCK: 2, BLADE: 4, DEAD: 8, DOWNED: 16, DRIVING: 32, STAGGER: 64,
  SPRINT: 128, TALK: 256, SHROUD: 512, AIM: 1024, WORK: 2048, AIR: 4096, OFF: 8192, ALERT: 16384, FLEE: 32768, SHIELD: 65536, DRAWN: 131072, ABOARD: 262144, MARKED: 524288,
};
