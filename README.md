# Hollow Stars

A 4-player co-op space-opera action game for the browser. This is the first playable slice of a much bigger game. See [DESIGN.md](DESIGN.md) for the full vision and roadmap.

**Dusk Varo** is a desert world under the boot of the Concordance, a galactic regime that collects tithe from every world in the Outer Reach. Your crew lands outside the township of Khet. You take jobs from a fixer named Oru Dask and make the nearby Concordance garrison bleed: quietly or loudly.

## What's in this slice

- **Five classes, chosen at startup:**

  | Class | Kit | Q / F / X |
  | --- | --- | --- |
  | Warden | Arc blade, the Current. No blaster. **Wanted**: guards spot you faster and hunter squads track you in the open | Push / Pull / Suggest (a guard forgets he saw you), plus a charged Leap on Space |
  | Gunslinger | Twin pistols | Fan fire (6-bolt burst) / Dodge roll / Deadeye (harder-hitting shots) |
  | Soldier | Assault rifle, 5 thermal charges | Suppressive fire (no overheating) / Bulwark (kinetic overshield) |
  | Medic | Sidearm, 6 stim packs, one-second revives | Med burst (heals and revives everyone nearby) / Stim dart (heal or revive a teammate at range) |
  | Spy | Twin vibro-knives, cloaking device, noisemakers | Execute (blink behind a guard and finish him) / Throw knife (silent, 3 charges) / Cloak |

- **Co-op for up to 4 players**, three ways:
  - Peer-to-peer from a static site such as GitHub Pages: one player hosts, friends join with a crew code.
  - A dedicated Node server.
  - Solo.

  The game simulation is authoritative wherever it runs. Movement is client-predicted and validated, and remote players are interpolated.
- **Blasters.** Visible bolts and a heat/overheat system, with headshots, scorch marks and positional audio.
- **Thermal charges.** They bounce, have a fuse, knock things back, and chain-detonate fuel tanks.
- **Arc blade.**
  - A three-swing combo with blade trails.
  - Hold right mouse to deflect enemy bolts.
  - A perfectly timed block sends the bolt back at the shooter.
  - It one-shots unaware guards for silent takedowns.
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
- **Three multi-part missions.**
  - *The Silent Key* (rescue and escort)
  - *Ghost in the Vault* (stealth heist: pickpocket the commander, slice the vault)
  - *Scorched Earth* (destroy the comms mast, the fuel tanks and the commander)

  Ghost bonuses pay extra for finishing without an alarm.
- **Economy.** Earn credits from missions and bounties. Two merchants sell consumables and permanent upgrades. Progress is saved per callsign on the server, or in your browser when playing solo.
- **Camera.** Third person, or first person with a weapon viewmodel (V). There's also a compass, objective waypoints, teammate tags, pings, chat and a revive system.

## Play on GitHub Pages (no server needed)

1. Push this folder to a GitHub repository.
2. In the repo, open **Settings → Pages → Build and deployment** and set **Source** to **GitHub Actions**.
3. The included workflow (`.github/workflows/pages.yml`) runs the simulation tests, builds the game and publishes it. The game appears at `https://<you>.github.io/<repo>/`.
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
| Fire / swing | Left mouse |
| Aim down sights / block and deflect (Warden) | Right mouse |
| Class abilities | Q / F / X |
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

## Project layout

```
shared/            Runs on both the server and the browser
  config.js        Tuning, items, missions, protocol constants
  math.js          Math, RNG, noise
  world.js         Terrain heightfield, layout, collision, raycasts, navigation grid and A*
  vehicles.js      Speeder physics (shared for client-side prediction)
  sim/game.js      The authoritative game room: players, netcode validation, interactions, economy, alarms
  sim/ai.js        Guard perception and combat, civilians, merchants, prisoner, wildlife
  sim/combat.js    Bolts, deflection, grenades, explosions, blade, Current powers
  sim/missions.js  Multi-part mission definitions and logic
  sim/classes.js   Class loadouts, Q/F/X abilities, Warden hunter squads
server/server.js   HTTP + WebSocket server, rooms of 4, profile persistence, peer-to-peer signaling relay
client/p2p.js      Serverless host/join crews over WebRTC
vendor/trystero/   WebRTC matchmaking library (MIT), vendored so the build needs only npm's three, ws, esbuild
client/            Three.js renderer, procedural models and animation, effects, HUD, synthesized audio
tools/             Build script, simulation soak test, end-to-end mission test
```

## Tests

```bash
node tools/missions-test.js   # plays all three missions end-to-end against the real simulation
node tools/classes-test.js    # exercises every class ability
node tools/soak.js 240        # 4 scripted bots for 4 minutes; reports tick cost and errors
```

All art is procedural geometry with procedurally generated textures, normal and roughness maps, and all audio is synthesized. There are no asset files to license.
