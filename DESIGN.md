# Hollow Stars — Design & Roadmap

Hollow Stars is a co-op space opera where a crew of up to four lives, fights and builds in an occupied star sector. You move from a crouch in the dark of a garrison to piloting a fighter through atmosphere to boarding a capital ship, without a loading screen breaking the spell. This document describes the full game and how the current slice grows into it.

## Pillars

1. **Seamless scale.** Infantry, vehicles, starships and capital ships share one simulation and one set of rules. A blaster bolt is a blaster bolt whether it comes from a trooper or a frigate turret; only the numbers change.
2. **Every approach is valid.** Each objective supports stealth, Current powers and brute force, and the world reacts to which one you chose.
3. **A living occupation.** NPCs always have something to do: patrols, shifts, trade, gossip, wildlife. The Concordance is a system that responds to the crew, not a set of spawn points.
4. **Ownership with consequences.** What you own — land, houses, ships, eventually planets — is taxed by the regime. If you stop paying, they come for it.

## Setting (original IP)

| Concept | Name in Hollow Stars |
| --- | --- |
| The occupying regime | The Concordance — its soldiers are Lancers, its officers Commanders |
| The mystical power | The Current — wielders are called Wardens |
| The energy sword | The arc blade — every Warden's blade colour is personal |
| The sector | The Outer Reach |
| The tax | The tithe — paid per world, per settlement and, later, per player holding |

### Launch planets

1. **Dusk Varo** (built). A desert world with the township of Khet, Garrison Seven, the Spine ridge, mesas and skitter herds.
2. **Thessaly Mire.** A jungle and swamp world. Stilt villages, a Concordance logging operation, dense vegetation that hides you, and beasts that hunt by sound.
3. **Korrun Deep.** An ice and ocean world. Platform cities over a frozen sea, a Concordance shipyard in orbit, blizzards that cut visibility, and submersible sections.

### Spinning up more planets

A planet is a data file: seed, biome palette, terrain parameters, settlement templates, garrison templates, wildlife table, weather and tithe level. The generator places points of interest and builds settlements and garrisons from prefab kits, the same way `shared/world.js` builds Khet and Garrison Seven today. Missions bind to tagged points of interest rather than coordinates, so every new planet gets the full mission set automatically.

## Systems

### Combat (in the slice: blasters, charges, blade, four powers)

- **Blasters.** Visible bolts with heat instead of ammunition. Weapon families planned: pistol, carbine, heavy repeater, sniper (charged shot), ion (disables droids, shields and vehicles).
- **Explosives.** Thermal charges are in. Planned: proximity mines, sticky charges for sabotage, smoke for breaking line of sight, and EMP for cameras.
- **Arc blade.** Combos, deflection and perfect-parry return-to-sender are in. Planned:
  - Blade-on-blade duels with clashes, binds and a guard meter.
  - Enemy blade wielders (Concordance Inquisitors).
  - Thrown blade.
  - Heavy and light stances.
- **The Current.** Push, Pull, Leap and Shroud are in. Planned, as three skill trees:
  - **Kinetic:** lift-and-throw objects or enemies; slam (area knockdown); a deflect bubble.
  - **Mind:** suggestion (a guard walks away), sense (see through walls briefly), panic.
  - **Storm:** arc storm (chain electricity), overload (blows out lights and cameras in a radius).

  Powers scale with progression and share the Focus pool. Using powers loudly raises your "Current signature", which attracts Inquisitors.

### Classes (in the slice)

Five classes are chosen at startup, and each has a signature weapon and Q/F/X abilities (see the README table).

- **Warden.** Arc blade and the Current, but no blaster. Wardens are **wanted**: Lancers recognise them on sight (faster detection) and hunter squads track them through the open desert.
- **Gunslinger.** Twin pistols, plus burst, roll and deadeye.
- **Soldier.** Rifle and charges, plus suppression and an overshield.
- **Medic.** Sidearm and stims, plus ranged revive darts and an area heal.
- **Spy.** Knives, a cloak, noisemakers, throwing knives, and Execute: blink behind a guard and finish him.

Planned:
- Class skill trees.
- A second weapon slot unlocked through progression (a Warden can never use a blaster).
- Class-specific missions: a Medic evacuation, a Spy infiltration.
- Bounty escalation for Wardens that ties into the tithe system. Notorious Wardens draw Inquisitors.

### Stealth (in the slice)

- **In now.**
  - Vision cones with suspicion meters.
  - Visibility modifiers: crouch, sprint, shadow (a real ray toward the sun) and floodlight zones.
  - Noise radiating from shots, sprinting, explosions and powers.
  - Security cameras.
  - Body discovery.
  - The alarm-runner rule: a spotted guard needs a few seconds to raise the alarm, so it can be stopped.
  - Silent takedowns, pickpocketing, crawlspaces, terminal slicing, and a ghost bonus for clean runs.
- **Planned.**
  - Dragging and hiding bodies.
  - Disguises: wear Lancer armour, and guards get suspicious only up close.
  - Sound occlusion through walls.
  - Light switches, plus breakers that kill whole sections.
  - Slicing mini-games for doors and terminals.
  - Guard dogs and droid sentries that track scent and heat.
  - An "intel" layer where scouting reveals patrol routes on the map.

### AI

- **In now.** Routines (patrols, posts, work, chat, errands), investigate/search/combat states, alarm response, reinforcements, townsfolk schedules, merchants, an escort AI and herd animals. Everything paths on an A* navigation grid.
- **Planned.**
  - Squad tactics: suppress, flank, grenade flush-out.
  - A cover system.
  - Day and night shift schedules.
  - Faction relationships between Concordance, smugglers, locals and bandits.
  - Ambient events: tithe collectors marching through town, smuggler deals, bandit raids.
  - Server-side behaviour LOD so thousands of NPCs can run on a planet.

### Vehicles and the scale ladder

Each rung uses the same entity, damage and networking model as infantry.

1. **Ground: speeders** (in now). Planned: walkers, armoured transports, turret emplacements, and boarding enemy transports at speed.
2. **Atmosphere: fighters, gunships, dropships.**
   - Arcade-sim flight with lift, drag and stall.
   - Multi-seat dropships (pilot plus door gunners) for the crew.
   - Landing on any flat surface or pad.
3. **Space: fighters, freighters, frigates, capital ships.**
   - Newtonian-assisted flight with boost and drift.
   - Shield facings and subsystem targeting: engines, shield generators, turrets, hangar.
4. **Capital ships as levels.**
   - Exterior: turrets, shield domes and hangar bays you can fly into.
   - Interior: a full infantry level built from the same building kit as Garrison Seven, with bridges, engine rooms and detention decks.
   - Knock out the shields, land in the hangar, fight to the bridge or the reactor.

### Seamless planet-to-orbit transition

- **Floating origin.** The simulation runs in local frames, roughly 10 km chunks, and the origin is re-centred around the player crew, so precision never degrades.
- **Planet representation.**
  - Up close: today's heightfield tiles, streamed on demand.
  - At altitude: a cube-sphere quadtree with LOD.
  - From orbit: a single impostor sphere with clouds.
- **Altitude bands.**
  - Ground: full detail and NPC simulation.
  - Atmosphere: terrain LOD, air traffic, weather.
  - Upper atmosphere: re-entry effects that mask streaming.
  - Orbit: the space layer.
- **Server handoff.** Crossing a band hands your entity from the planet shard to the orbital shard, using the same message protocol. The client blends the two worlds during a few seconds of re-entry plasma or the climb through cloud.

### Missions

- **The framework is in.** Ordered and unordered steps, live objective text and waypoints, fail conditions, rewards and ghost bonuses.
- **Mission families planned:**

  | Family | Examples |
  | --- | --- |
  | Rescue / escort | Prison breaks, VIP extraction, refugee convoys |
  | Stealth heist | Vaults, data cores, blueprints, cargo manifests |
  | Destroy / sabotage | Depots, comms, shield generators, shipyard cranes |
  | Assassination | Commanders, Inquisitors, collaborators |
  | Ambush | Supply convoys, tithe shipments (steal the tithe!) |
  | Defence | Hold a settlement against a tithe raid |
  | Boarding | Capture or scuttle a frigate; free prisoners aboard a capital ship |
  | Smuggling | Run contraband past orbital patrols, with scans and bribes |
  | Bounties | Hunt named targets who flee, hide and fight back |

- **A procedural generator** combines a family template, a planet's tagged points of interest, the regional Concordance strength and the crew's reputation. Hand-authored story arcs (like Ilsa Varn's) run alongside.

### Economy, merchants and progression

- **In now.** Credits from jobs and bounties; two merchants selling consumables and permanent upgrades; profiles saved per callsign.
- **Planned.**
  - Loot and salvage.
  - Crafting (blaster mods, arc blade crystals that set colour and stats).
  - Reputation with factions, which unlocks merchants and missions.
  - Player-to-player trade.
  - A regional market where prices respond to what the crew sabotages. Burn the fuel depot and fuel gets expensive.

### Ownership and housing

1. **Land plots.** Claim a plot in a settlement or in the wilds, then place premade house designs (shack, homestead, villa, bunker). The same snapping kit as the garrison builder is used for furniture, storage and a personal hangar pad.
2. **Starships.** Buy, upgrade and name your own ship: a freighter as a mobile base, or fighters. Ships persist with damage and loadout.
3. **Capital ships.** A crew-scale goal. Earn, steal or capture a frigate. It needs a crew of NPCs (hire them), fuel and docking fees, and it becomes a mobile home base.
4. **Planets and regions** (endgame). Liberate a world from the Concordance by breaking its garrisons, then hold it. Set your own tax rate, defend it from counter-invasions, and fight other player crews for regions of space.

### The tithe and invasions

The tithe is the heartbeat of the world.

- **Every settlement and every player holding owes tithe on a schedule.** Townsfolk already talk about it.
- **Paying is safe but drains you.**
- **Withholding escalates in stages:**
  1. A warning broadcast.
  2. A tithe-collector squad marches in.
  3. A garrison surge with checkpoints and patrols on the roads.
  4. An invasion: dropships land troops and walkers, a frigate parks in orbit, and orbital strikes threaten your property.
- **Repel the invasion** and the region's Concordance strength falls, which opens up liberation. **Lose it** and your holdings are seized: you have to buy back or steal back your property.
- **The crew can also sabotage collection itself.** Ambush tithe shipments, destroy ledgers, or bribe collectors.

This ties all the systems together: missions weaken the regime, ownership creates something to protect, and the tithe creates the pressure.

## Technical architecture

### Today

- One codebase runs in two places. `shared/` is the authoritative simulation and runs on Node or in the browser.
- **Server:** a 20 Hz authoritative tick.
- **Client:**
  - Client-predicted movement with server validation: speed checks, teleport correction, impulses.
  - Interpolated remote entities with a 110 ms buffer.
  - JSON snapshots of about 3 KB.
- **Rooms:** one world instance per room, up to 4 players, sleeping when empty.

### Scaling path

1. **Protocol.** Binary snapshots with delta compression and quantization, plus interest management (send only nearby entities). That buys roughly 10x headroom.
2. **Entity–component system.** Move the simulation onto an ECS so vehicles, ships and capital-ship subsystems compose cleanly.
3. **Navigation.** Replace the nav grid with per-tile navmeshes, plus a flight navigation volume for air and space AI.
4. **World servers.** Zone servers per planet region, an orbital server per system and an instance server per capital-ship interior, with entity handoff between them. A matchmaker routes crews.
5. **Persistence.** Postgres for accounts, holdings and economy; Redis for live presence; an event log for tithe schedules and invasions.
6. **Accounts and authority.**
   - Real authentication.
   - Server-side movement replay for anti-cheat once the game opens beyond co-op friends.
   - Rate limits are already in.
7. **Content pipeline.** Keep procedural low-poly geometry as the baseline look, with optional glTF model swaps for hero assets (ships, characters) once a visual style is locked.

## Roadmap

| Phase | Focus | Highlights |
| --- | --- | --- |
| 0 (this build) | Vertical slice | 4-player co-op (peer-to-peer or dedicated server), five classes, one planet, stealth, blasters, blade, Current, speeders, 3 missions, merchants, procedural PBR textures |
| 1 | Depth on foot | Skill trees, more weapons, disguises and body dragging, squad AI, procedural missions, a second planet (Thessaly Mire) |
| 2 | Flight | Atmospheric fighters and dropships, seamless climb to orbit, space dogfights, a third planet (Korrun Deep) |
| 3 | Capital ships | Subsystem combat, hangar landings, boarding interiors, frigate capture |
| 4 | Ownership | Land plots, prefab houses, owned starships, tithe schedules and invasion events, persistent servers |
| 5 | Territory | Planet liberation and ownership, regional control, crew-vs-crew conflict over space |

## Open questions for the creative lead

- Tone: grim occupation drama, or swashbuckling adventure with grim edges? The current writing leans toward the second.
- PvP: is it opt-in only (contested regions), or is the sector open?
- Do Current powers stay rare (only some players can become Wardens), or can every character learn them?
- Planet ownership: is it a crew-level or a guild-level activity?
