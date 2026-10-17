# Hollow Stars

A 4-player co-op space-opera action game for the browser. This is the first playable slice of a much bigger game. See [DESIGN.md](DESIGN.md) for the full vision and roadmap.

**Dusk Varo** is a desert world under the boot of the Concordance, a galactic regime that collects tithe from every world in the Outer Reach. Your crew lands outside the township of Khet in the *Wayfarer*, a four-seat light freighter. You take jobs from a fixer named Oru Dask and make the Concordance bleed: quietly or loudly, on Dusk Varo and on two more worlds a jump away.

## What's in this slice

- **Six classes, chosen at startup:**

  | Class | Kit | Q / F / X |
  | --- | --- | --- |
  | Warden | Arc blade, the Current. No blaster. **Wanted**: guards spot you faster and hunter squads track you in the open | Push / Pull / Suggest (a guard forgets he saw you), plus a charged Leap on Space |
  | Gunslinger | Twin pistols | Fan fire (6-bolt burst) / Dodge roll / Deadeye (harder-hitting shots) |
  | Soldier | Assault rifle, 5 thermal charges | Suppressive fire (no overheating) / Bulwark (kinetic overshield) |
  | Medic | Sidearm, 6 stim packs, one-second revives | Med burst (heals and revives everyone nearby) / Stim dart (heal or revive a teammate at range) |
  | Spy | Twin vibro-knives, cloaking device, noisemakers | Execute (blink behind a guard and finish him) / Throw knife (silent, 3 charges) / Cloak |
  | Sniper | LR-9 long-las (one bolt drops a trooper; right mouse scopes in), camouflage that improves while you keep still | Overcharged shot (double damage, punches through) / Proximity mine (2 charges) / Recon sweep (marks every hostile ahead for the crew, through walls) |

- **Experience and levels.** Jobs, takedowns (more if nobody saw), cameras, sabotage, revives, gathering, crafting and fitting upgrades all earn XP. Each level up to 20 adds 3 health and trims ability cooldowns. Your level is saved with your profile.
- **Advanced classes at level 10.** Until then a character can switch classes freely at the start screen. Open the Career screen (K) to specialize; it warns you first, because taking an advanced class locks that character into its class for good. The advanced class also opens a fourth ability key, Z.

  | Base | Advanced class | What changes |
  | --- | --- | --- |
  | Warden | Guardian | Wider deflection arc, every block is perfect, +30 health. X: Bastion, a dome that stops every bolt fired into it |
  | Gunslinger | Bounty Hunter | +25% credits from kills. F: wrist rocket. X: mark a bounty (the crew deals 50% more to the target, and you collect when it dies) |
  | Soldier | Commando | +30 health, two more charges. F: jump jets. X: a pod of six homing rockets |
  | Medic | Combat Surgeon | Stims heal 30% more. X: Adrenal, an overshield plus 25% more damage for the crew nearby |
  | Spy | Agent | Whisper suppressed pistol, slices twice as fast, guards are slower to notice you. F: holo-decoy that draws guards with noise |
  | Sniper | Phantom | Better camouflage. X: Phase cloak, whose first shot keeps you hidden and hits 50% harder. Overcharged shots pierce every target in line |

- **Branches at level 15.** Each advanced class splits two ways. A branch adds a passive perk, its own look, and two abilities (one at level 15, one at 18). Resetting a branch back to the advanced class costs three average jobs' pay (6,660cr), and then you can take the other path. You choose which unlocked abilities sit on Q, F, X and Z from the Career screen.

  | Advanced | Branch | Perk | Abilities (15 / 18) |
  | --- | --- | --- | --- |
  | Guardian | Shieldwall Sentinel | +25 health; crew near you take 15% less damage | Aegis (crew overshield) / Challenge (guns turn on you; you take 40% less) |
  | Guardian | Bladedancer | Blade +35% | Riposte (every bolt in front goes back) / Whirlwind |
  | Bounty Hunter | Manhunter | Bounty marks last twice as long | Snare net / Open season (bounty on everyone ahead) |
  | Bounty Hunter | Gunfighter | Pistols +20% | Quickdraw (harder, heat-free shots) / Trick shot (curving bolts into up to four targets) |
  | Commando | Vanguard | Jump jets recharge 40% faster | Jet slam / Barrage (three blasts on a marked spot) |
  | Commando | Heavy Gunner | +40 health, rifle +25% | Rail shot (pierces six) / Sentry turret |
  | Combat Surgeon | Field Medic | Revives take half the time | Mending field / Lifeline (nobody nearby can go down) |
  | Combat Surgeon | Toxicologist | Bolts poison | Toxin cloud (silent) / Sedative dart (silent takedown) |
  | Agent | Infiltrator | Guards notice you even slower | Disguise (unseen unless they're right next to you) / Blackout (cameras and nearby guards) |
  | Agent | Saboteur | Slices three times as fast | EMP pulse / Overload (a trooper's power pack explodes) |
  | Phantom | Wraith | Phase cloak lasts 50% longer | Shadow blink / Veil (cloaks the crew) |
  | Phantom | Longshot | Long-las +25% | Ricochet round / Executioner's mark (double damage on marked targets) |

- **Your ship is home base.** Press E at the Wayfarer's ramp to restock charges and medpacks (20cr each; mines and knives free), call your own speeder bike in your crew colour, or go aboard. A wrecked speeder takes 30 seconds to replace.
- **Speeder theft.** Every speeder in town belongs to someone. Hold E to hotwire a parked one, or pull a rider off a stopped one. Anyone who sees it reports it unless you stop them; an unseen theft is noticed later. Reported thefts give your crew heat in that town: prices go up, the owner's friends come after you, and at high heat the town militia turns out. Heat fades while you stay away, or pay the fine at the exchange. Give a stolen speeder back where you took it for a small reward and less heat, leave it somewhere quiet and it finds its way home, or sell it to the exchange's fence. A stolen hauler takes its cargo with it, so the town runs short.

- **Co-op for up to 4 players**, three ways:
  - Peer-to-peer from a static site such as GitHub Pages: one player hosts, friends join with a crew code.
  - A dedicated Node server.
  - Solo.

  The game simulation is authoritative wherever it runs. Movement is client-predicted and validated, and remote players are interpolated.
- **Blasters.** Visible bolts and a heat/overheat system, with headshots, scorch marks and positional audio.
- **Thermal charges.** They lob 30-40 m, bounce, have a fuse, knock things back, and chain-detonate fuel tanks. The Spy's noisemakers throw just as far.
- **Arc blade.**
  - A three-swing combo with blade trails.
  - Hold right mouse to deflect enemy bolts.
  - A perfectly timed block sends the bolt back at the shooter.
  - It one-shots unaware guards for silent takedowns.
  - While drawn, it catches bolts coming from the front on its own and sends them where you're looking, snapping onto a guard near your aim.
- **The Current** (psionic powers): Push (Q), Pull (F), charged Leap (hold Space) and Shroud (X).
- **Stealth.**
  - Guards have vision cones, and their suspicion fills over time.
  - What a guard notices depends on crouching, sprinting, floodlights versus shadow, and noise.
  - Security cameras watch key areas, and guards react when they find a body.
  - Once a guard spots you, they run for the alarm after a few seconds. Kill them first and nobody knows.
- **Alarms.** Lockdown seals the gate, reinforcements pour out of the barracks, and the whole base hunts you. Slice the security terminal to loop the cameras or silence the alarm. Topple the comms mast to stop reinforcements.
- **An AI that's always busy.**
  - Guards patrol, stand watch in towers, chat at the mess tables, work the fuel depot and run errands.
  - Townsfolk wander the market, gossip, sit and flee from gunfire.
  - Merchants and Oru greet you, a bartender works the bar, and herds of dune skitters graze and bolt.
- **Speeder bikes.** Hover physics, boost and forward cannons.
- **Living towns.** Each town is ringed by streets and outer neighbourhoods. Townsfolk ride speeder bikes and landspeeders around the ring, and haulers run between town and the farms, mines and lodges. Traffic brakes and honks if you stand in the road. Shooting it up costs you. Each Concordance site is now a long ride from its town.
- **Spaceports.** Every town has two extra pads where trader ships land, sit a while and leave. There are three designs: the Mulehorn bulk hauler, the Swiftwater courier skiff and the Pilgrim lander. Each trader that lands moves goods in and out of the town market.
- **An economy.** People grow grain, mine ore and cut coolant ice, tap resin, log timber, and hunt the herds with rifles. Their output fills each town's stock. Makers at the workshop turn raw goods into parts. Prices float with stock, and each world is cheap in what it makes and dear in what it imports, so hauling cargo between planets pays.
  - Gather it yourself: dig ore, cut ice, tap resin, saw timber and help with the harvest. Hunting gives meat and hides; Concordance kills give salvage.
  - Trade at each town's **exchange**. Make **parts** (alloy plate, power cells, armorweave, circuit boards) at the **workshop**.
  - Spend parts and credits on three tiers of upgrades for what you own: your **weapon** (+damage), **armor** (+health), **speeder tune** (+speed, +cannons) and your **Wayfarer berth** (+cargo, faster jumps). Your pack and gear are saved with your callsign.
- **Three planets and a ship.** The crew starts with the *Wayfarer*, parked at each world's landing pad. Walk up the ramp to board, then use the nav console to pick a destination on the star map. It launches once the whole crew is aboard, and the crew stays aboard until it has touched down at the other end.
  - **Dusk Varo:** desert, the township of Khet, Garrison Seven.
  - **Thessaly Mire:** a drowned forest with solid trees to hide behind, the stilt village of Lowmarsh, and Harvester Station Kappa.
  - **Korrun Deep:** an ice shelf in falling snow, the outpost of Rime Hold, ice spires, and Cryo-Vault Sigma.
- **Five multi-part missions.**
  - *The Silent Key* (rescue and escort)
  - *Ghost in the Vault* (stealth heist: pickpocket the commander, slice the vault)
  - *Scorched Earth* (destroy the comms mast, the fuel tanks and the commander)
  - *Roots of Rebellion* (off-world: fly to Thessaly, meet Vessa Moor, kill the harvester's power cells, free the captured woodcutters, report back to Oru)
  - *Cold Storage* (off-world stealth heist: fly to Korrun, get the vault code from Tobin Vale, slice the cryo-archive for the Ashfall Codex, bring it home)

  Ghost bonuses pay extra for finishing without an alarm. Leaving a world in the middle of a job that happens only there abandons that job.
- **Economy.** Earn credits from missions and bounties. Four merchants across the three worlds sell consumables and permanent upgrades. Progress is saved per callsign on the server, or in your browser when playing solo.
- **Characters, guns and set dressing from CC0 model packs.** People are rigged Quaternius base bodies animated with the Universal Animation Library (upper and lower body blend, so you can run while aiming), dressed per class, advanced class and branch. Guards carry pack rifles, security cameras are eye-drones, two garrison patrols per site are walking droids, and spaceports have colony prefabs, hangars, rovers, loader mechs and Space Kit trader ships. The Wayfarer is the Challenger hull from the Ultimate Spaceships Pack, Khet's outer houses are Quaternius townhouses recoloured as adobe, Rime Hold is built from KayKit base modules with wind turbines, Korrun's haulers are KayKit space trucks, and Cryo-Vault Sigma keeps specimens on ice. If the models can't load (for example when opening the page from disk), the game falls back to its procedural models.
- **Camera.** Third person, or first person with a weapon viewmodel (V). There's also a compass, objective waypoints, teammate tags, pings, chat and a revive system.

## Play on GitHub Pages (no server needed)

1. Push this folder to a GitHub repository.
2. In the repo, open **Settings → Pages → Build and deployment**. Choose **Deploy from a branch**, then **main** and **/ (root)**.
3. The game appears at `https://<you>.github.io/<repo>/`. It is the self-contained `index.html` at the repo root, built by `npm run build -- --single`. On every push, `.github/workflows/build.yml` runs the simulation tests, rebuilds `index.html` and commits it if it changed, so the site always matches the code.
4. One player chooses **Host a crew**. They get a five-letter crew code and a **Copy invite link** button: the chip under the party list, or in the pause menu.
5. Friends open the link, or choose **Join a crew** and type the code.

How it works: the host's browser runs the authoritative game. Public BitTorrent WebSocket trackers introduce the players to each other, and after that all game traffic flows directly between browsers over WebRTC. The host needs to keep their tab open.

If a friend can't connect (some strict corporate or mobile networks block peer-to-peer), run the included server anywhere. Then put `wss://<your-server>/relay` in **Connection settings → Signaling relay**, or use **Dedicated server** mode.

## Run the dedicated server

Requires Node.js 18 or newer.

```bash
npm install
npm start            # builds the client and starts the server on http://localhost:8080
```

Open `http://localhost:8080`, enter a callsign and a crew room name, then make planetfall. Friends on the same network open `http://<your-LAN-IP>:8080` and use the **same room name**.

- **Play over the internet.** Deploy the included `Dockerfile` to any container host, such as Fly.io, Render or Railway. The client connects over `wss://` automatically when the page is served over HTTPS. A tunnel like `cloudflared tunnel --url http://localhost:8080` also works for a quick session.
- **Solo / offline.** Choose *Solo* on the menu. The same authoritative simulation runs inside your browser. `npm run build -- --single` also produces `dist/hollow-stars.html`, a single self-contained file you can open anywhere.
- **Port.** Set the `PORT` environment variable to change it.
- **GitHub Codespaces.** Open the repo in a Codespace. The included `.devcontainer` installs dependencies, starts the server and forwards port 8080. Make the port public to invite friends.
- The server also hosts a signaling relay at `/relay`, so it can back the peer-to-peer modes too.

## Controls

| Action | Key |
| --- | --- |
| Move / sprint / crouch | WASD / Shift / C (or Ctrl) |
| Jump / charged Current leap | Space / hold Space |
| Draw / holster your weapon | R |
| Fire / swing | Left mouse |
| Aim down sights / block and deflect (Warden) | Right mouse |
| Class abilities (Z once you take an advanced class) | Q / F / X / Z |
| Career: level, XP, advanced class, branch and ability keys | K |
| Throwable (thermal charge, or noisemaker for the Spy) / medpack or stim | G / H |
| Interact (hold to slice terminals, cut locks, revive) | E |
| First / third person | V |
| Ping a spot for your crew | T or middle mouse |
| Toggle the mission tracker / chat | Tab / Enter |

On a speeder: W/S for throttle, steer with the mouse (or A/D), Shift to boost, Space to hop, left mouse for cannons, E to dismount.

## Tips

- Wardens draw attention. Pair one with a Spy or Medic, and use Suggest on the guard who's about to sound the alarm.
- Stay low and in the shadows. The eye at the bottom of the screen shows how visible you are.
- The arcs around your crosshair point at whoever is noticing you. A full **!** means they've seen you and are heading for the alarm.
- The east wall has a drainage culvert you can crawl through.
- Slicing the security office terminal loops the cameras for two minutes.
- Sneak up behind Commander Rhal and hold E to lift his keycard. Pulling him (F) can also knock it loose.
- Fuel tanks chain-explode. Stand back.
- A Sniper who stays still and crouched almost vanishes. Sweep a garrison with Recon before the crew goes in.

## Project layout

```
shared/            Runs on both the server and the browser
  config.js        Tuning, items, missions, protocol constants
  math.js          Math, RNG, noise
  world.js         Per-planet terrain, Dusk Varo's layout, collision, raycasts, navigation grid and A*
  layouts.js       Thessaly Mire and Korrun Deep, built from the same kit
  districts.js     Outer neighbourhoods, streets, farms, mines, lodges, markets, workshops, spaceports
  economy.js       Goods, prices, recipes, upgrade tiers and town markets
  spaceport.js     The trader ships' land-and-leave schedule (a pure function of game time)
  sim/traffic.js   Townsfolk driving bikes, landspeeders and haulers along the streets
  planets.js       Planet roster (names, looks, star-map positions) and the Wayfarer
  vehicles.js      Speeder physics (shared for client-side prediction)
  sim/game.js      The authoritative game room: players, netcode validation, interactions, economy, alarms
  sim/ai.js        Guard perception and combat, civilians, merchants, prisoner, wildlife
  sim/combat.js    Bolts, deflection, grenades, explosions, blade, Current powers
  sim/missions.js  Multi-part mission definitions and logic
  sim/classes.js   Class loadouts, Q/F/X abilities, Warden hunter squads
  dressing.js      Pack models placed around spaceports, workshops and Concordance sites, kept clear of every path
  packs.js         Houses built from boxes (collision) but drawn as pack models
server/server.js   HTTP + WebSocket server, rooms of 4, profile persistence, peer-to-peer signaling relay
client/p2p.js      Serverless host/join crews over WebRTC
vendor/trystero/   WebRTC matchmaking library (MIT), vendored so the build needs only npm's three, ws, esbuild
client/            Three.js renderer, procedural models and animation, effects, HUD, synthesized audio
client/assets/     Slimmed .glb packs (about 13 MB) and CREDITS.md
client/render/     assets.js loader, assethumanoid.js (pack characters on the game's rig), weapons.js, props.js, kitcreature.js
client/viewer.js   Model and animation viewer: open the game with ?viewer=1 (&set=crew|adv|town|models&state=aim|run|...)
tools/             Build script, simulation soak test, end-to-end mission test
tools/assets/      build_assets.py and gltfpack.py: turn the unzipped packs into client/assets (python3, numpy, Pillow)
```

## Tests

```bash
node tools/missions-test.js   # plays the three Dusk Varo missions end-to-end against the real simulation
node tools/travel-test.js     # checks every planet's layout, flies the Wayfarer, plays both off-world missions
node tools/economy-test.js    # workers, hunters, traders and traffic for 10 minutes per planet, then gather/trade/craft/upgrade
node tools/classes-test.js    # exercises every class ability
node tools/career-test.js     # Sniper kit, XP and levels, and every advanced class
node tools/branch-test.js     # class lock-in, the four-key loadout, branches, resets and all 24 branch abilities
node tools/theft-test.js      # the ramp menu, personal speeders, theft, witnesses, heat, militia, fines and the fence
node tools/soak.js 240 korrun # 4 scripted bots for 4 minutes on a planet; reports tick cost and errors
```

Terrain, buildings, vehicles and effects are procedural geometry with generated textures, and all audio is synthesized. Characters, weapons, props, the Wayfarer and many buildings come from CC0 packs by Quaternius, Kenney and Kay Lousberg (public domain, no attribution required, credited anyway in [client/assets/CREDITS.md](client/assets/CREDITS.md)). To rebuild them from the original zips, unzip the packs into one folder and run `python3 tools/assets/build_assets.py <folder>`.
