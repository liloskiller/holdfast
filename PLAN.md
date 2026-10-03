# HOLDFAST - 3D tactical breach shooter (working title)

A cheap, original, Rainbow Six Siege inspired 3D game. Browser based, multiplayer, playable on phones and desktop over LAN or the internet. Built with TypeScript, Three.js and a tiny authoritative Node WebSocket server.

This file is the source of truth. Read it fully before writing code. Also copy section 1 and section 2 into `CLAUDE.md` in the repo root so every session sees them.

---

## 0. How we work (read first)

- Work **one milestone at a time** (section 12). After each milestone: run typecheck, run tests, run the game, commit, then STOP and tell me exactly how to run and test it. Do not start the next milestone until I say so.
- Always give **complete files**, never partial snippets or "rest unchanged" placeholders.
- Keep dependencies minimal. Allowed runtime deps: `three` (client), `ws` (server). Dev deps: `typescript`, `vite`, `tsx`, `vitest`, `@vitejs/plugin-basic-ssl`, `@types/*`. Ask me before adding anything else.
- No game engine, no physics engine, no React for the game or HUD. Plain TS and DOM.
- **No em dashes anywhere** in code comments, UI strings or docs. Use regular hyphens.
- When something in this plan is ambiguous or a better option exists, say so briefly and pick the simplest option that keeps the milestone shippable.
- Prefer boring, readable code over clever code. Small modules, explicit types, no `any`.

---

## 1. Goals and non-goals

### Goals
- 3D first person tactical shooter, **one life per round**, attackers vs defenders on a single multi-floor house map.
- The Siege pillars: **destructible walls and floors, reinforcement, barricades, breaching, drone recon, information warfare, gadgets.**
- 2 to 10 players. Friends join on their phones or laptops by opening a URL and entering a room code.
- Stable 60 fps on a mid range phone (3 to 4 years old), 30 fps minimum floor.
- Fully original: own name, own operators, own map, own sounds. No Ubisoft assets, names or logos.
- Runs locally on a laptop for LAN, and can be deployed to Hetzner behind Cloudflare for internet play.

### Non-goals (do NOT build these early)
Ranked, accounts, skins, shop, voice chat, bots (stretch only), realistic ballistics, physics ragdolls, animation rigs, glTF pipelines, more than one map, anti-cheat beyond server authority.

---

## 2. Key technical decisions (locked unless I say otherwise)

| Area | Decision | Why |
|---|---|---|
| Renderer | Three.js, WebGL2, low poly flat shaded, no real time shadows | Phone performance, tiny setup |
| Art | Procedural primitives (boxes, capsules, cylinders) with flat colors and simple canvas generated textures | Zero asset pipeline, original by default |
| Language | TypeScript strict everywhere | Shared types between client and server |
| Repo | npm workspaces: `shared`, `server`, `client` | Shared simulation code runs on both sides |
| Server | Node + `ws`, authoritative, **60 Hz simulation, 20 Hz snapshots** | Cheap, easy to reason about |
| Netcode | Client prediction + server reconciliation for the local player, **snapshot interpolation (100 ms buffer)** for remote players, **server side lag compensation** for hitscan | Feels fair on bad Wi-Fi |
| Transport | WebSocket (TCP) for everything at first. JSON messages behind a `codec` module so we can swap to binary later | Simplest thing that works |
| Physics | Custom kinematic character controller vs AABB world. Ray vs AABB for bullets. No physics lib | Full control, tiny |
| World | Uniform grid. Static geometry plus **destructible cells** (see section 5) | Makes destruction cheap to sync |
| Map format | ASCII floor plans in text files, compiled to geometry at load | Easy to author and diff, Claude Code can edit maps directly |
| UI | Vanilla TS + DOM overlay for HUD, menus, lobby | No framework needed |
| Audio | WebAudio, **procedurally synthesized** sound effects (no audio files) | No assets, positional audio for free |
| Input | Desktop: WASD + mouse with Pointer Lock. Phone: dual thumb touch controls | Both first class from day one |

Units: **1 world unit = 1 meter.** Y is up. Right handed (Three.js default).

---

## 3. Repository layout

```
holdfast/
  package.json              (workspaces: shared, server, client)
  tsconfig.base.json
  CLAUDE.md                 (sections 1 and 2 of this plan)
  PLAN.md                   (this file)
  shared/
    src/
      constants.ts          tick rates, player dims, weapon stats, gameplay tuning
      types.ts              message types, entity state, enums
      math.ts               vec3 helpers, clamp, lerp, angle wrap, seeded RNG
      movement.ts           deterministic player movement step (used by client AND server)
      collision.ts          AABB, sweep vs grid, ray vs AABB, ray vs world
      world.ts              World class: grid, cells, statics, doors, queries, damage
      mapFormat.ts          ASCII map parser -> MapData
      weapons.ts            weapon definitions, spread pattern, damage calc
      protocol.ts           encode/decode messages (JSON now, binary later)
      *.test.ts             vitest unit tests
    maps/
      safehouse.map.txt     the one map
  server/
    src/
      index.ts              http + ws bootstrap, serves client dist in prod
      Room.ts               one match: players, world, phases, tick loop
      Lobby.ts              room codes, create/join, teams, ready
      Player.ts             server side player state, input queue, hitbox history
      systems/
        movementSystem.ts
        combatSystem.ts     hitscan, lag compensation, damage, death
        destructionSystem.ts
        gadgetSystem.ts
        roundSystem.ts      phases, win conditions, scoring, side swap
        visibilitySystem.ts per recipient snapshot filtering
  client/
    index.html
    vite.config.ts
    src/
      main.ts               boot, screen router
      net/Connection.ts     ws wrapper, reconnect, ping, clock sync
      net/Prediction.ts     input buffer, reconciliation
      net/Interpolation.ts  remote entity buffers
      game/Game.ts          main loop, owns everything below
      game/Renderer.ts      three.js scene, camera, resize, quality tiers
      game/WorldView.ts     builds meshes from World, instanced cells, damage tint
      game/PlayerView.ts    remote player model (capsule robot), name tag, team color
      game/Viewmodel.ts     first person weapon mesh, recoil, reload anim
      game/DroneView.ts
      game/Effects.ts       tracers, impacts, debris, muzzle flash, hit markers
      input/KeyboardMouse.ts
      input/TouchControls.ts
      input/InputState.ts   unified input struct both sources write into
      audio/Audio.ts        synth sfx + positional audio
      ui/Hud.ts, Menu.ts, Lobby.ts, Scoreboard.ts, KillFeed.ts, OperatorSelect.ts
```

Scripts at the root: `npm run dev` (starts server with `tsx watch` and Vite together), `npm run build`, `npm run test`, `npm run typecheck`, `npm start` (production server serving built client).

---

## 4. Shared simulation rules

### 4.1 Time and tick
- `SIM_HZ = 60`, `SIM_DT = 1/60`.
- `SNAPSHOT_HZ = 20`.
- `INPUT_SEND_HZ = 30` (each packet carries the last 2 input commands, so one lost or late packet does not matter).
- Server time is the clock. Clients estimate server time via ping/pong (keep the lowest RTT sample, smooth the offset).

### 4.2 Player dimensions and movement (tunable in `constants.ts`)
- Collision shape: vertical cylinder approximated as an AABB for sweeps. Radius 0.35, height 1.8 standing, 1.3 crouched. Eye height 1.65 standing, 1.15 crouched.
- Walk 3.4 m/s, sprint 5.0 m/s, crouch walk 1.8 m/s, jump is **disabled** (Siege has no jump, it has vaulting). Gravity applies for falling through breached floors and hatches.
- Acceleration based movement (simple friction), not instant velocity.
- Movement step is a pure function: `stepPlayer(state, input, world, dt) -> state`. It lives in `shared/movement.ts` and is used by the server for truth and by the client for prediction. **It must be deterministic.** No `Math.random`, no `Date.now`, no Three.js imports in shared code.
- Collision: sweep the AABB axis by axis (X, then Z, then Y) against nearby solids from the grid, slide along surfaces. Add a small skin width (0.001) to avoid tunneling and sticking. Max step up 0.3 m so stairs and small ledges work without jumping.
- Lean (Q and E) is a **stretch** feature (M10). Design `PlayerState` so a lean value can be added later.

### 4.3 Input command
```ts
interface InputCmd {
  seq: number;          // increments per command
  dt: number;           // always SIM_DT for now
  moveX: number;        // -1..1 strafe
  moveZ: number;        // -1..1 forward
  yaw: number;          // absolute radians
  pitch: number;        // absolute radians, clamped to +-1.5
  buttons: number;      // bitmask: FIRE, RELOAD, CROUCH, SPRINT, INTERACT, GADGET, SWITCH, MELEE, DRONE
  clientTime: number;   // estimated server time at the moment this input was sampled
}
```
Phone joysticks produce analog moveX and moveZ. Keyboard produces -1, 0, 1.

### 4.4 Player hitboxes
Head: sphere radius 0.15 centered at eye height minus 0.1. Body: capsule or two stacked boxes, radius 0.3, from feet to neck. Legs share the body box (no leg multiplier). Crouch lowers both. Damage multipliers: head x2.5 (per weapon override), body x1.0.

### 4.5 Health
100 HP. **One life per round.** Optional "downed" state is NOT in scope. Medic gadget can heal but not revive.

---

## 5. World, map and destruction (the heart of the game)

### 5.1 Grid
- Horizontal tile size **0.5 m**. Wall thickness is one tile (0.5 m). Rooms are authored in tiles, so a 6 by 5 meter room is 12 by 10 tiles.
- Floor height **3.0 m** (including floor slab). Vertical **cell size 0.5 m**, so a wall column is 6 cells tall. Constant `CELL = 0.5`, keep it tunable. A later upgrade to 0.25 for finer bullet holes should only require changing constants.
- Maps have up to 3 floors (basement optional) plus a roof.

### 5.2 Cell types
Every wall tile on every floor becomes a stack of **destructible cells**. Each cell is a 0.5 m cube with:
```ts
interface Cell { id: number; hp: number; maxHp: number; material: MaterialId; reinforced: boolean; alive: boolean }
```
Materials: `WOOD` (hp 30), `PLASTER` (hp 40), `BRICK` (hp 120), `CONCRETE` (hp 100000, indestructible, outer shell and load bearing walls), `GLASS` (hp 10, windows), `METAL` (reinforced, see below).
Floors and ceilings are also cell layers: `FLOOR_WOOD` (soft, breakable) and `FLOOR_CONCRETE` (indestructible). **Hatches** are marked floor/ceiling regions of soft cells that can be breached.

### 5.3 Static geometry
Non destructible things (outer shell, ground, furniture blocks, stairs) are static AABBs. Furniture is simple boxes, can be partial cover. Stairs are real stepped geometry using the 0.3 m step up rule.

### 5.4 Doors, windows, barricades
- **Door:** a tile entry with open/closed state. Closed = solid AABB, open = no collision (rendered as a swung panel). Interact toggles. Doors can be barricaded (see below) and are destroyed like soft cells only when shot at 8+ times or breached.
- **Window:** a gap in a wall with a glass cell that shatters to a single bullet. Windows can be vaulted through by interact when clear (short scripted movement, 0.6 s, player cannot shoot).
- **Barricade:** defenders place a barricade on a door or window (interact). Becomes a solid with 150 HP that bullets, melee and explosives damage. Players can melee it (kick) for 40 dmg.
- **Reinforcement:** defenders have N charges (default 2, Warden gets 3). Interact on a reinforceable wall panel (a wall segment marked `R` in the map) takes 2.0 s and sets `reinforced = true` on every cell in that panel (visual: metal plates). Reinforced cells ignore bullets and normal explosives. Only a hard breach charge (or the Ram's gadget) removes them.

### 5.5 Damage and penetration
- Bullets hit the first thing along the ray. If it is a destructible cell, subtract `weapon.wallDamage` from cell hp. If the cell survives, the ray stops. If it dies, remove it and the **same bullet does not continue** (simple, predictable).
- **Soft wall penetration (optional, M5b):** bullets pass through `WOOD` and `PLASTER` with 50 percent damage and hit players behind. Make this a constant flag `PENETRATION_ENABLED`.
- Explosive damage: sphere query for cells within radius, damage falls off with distance, reinforced cells are skipped unless the source is a hard breach.
- When a cell is removed the World emits an event `{type: 'cellDestroyed', id}`. The server batches these per snapshot tick and sends them **reliably as part of the snapshot stream** (WS is ordered and reliable anyway). Late joiners receive the full list of destroyed cell ids plus reinforcement flags in the join payload.

### 5.6 World API (in `shared/world.ts`)
```ts
class World {
  constructor(map: MapData)
  isSolidAt(x,y,z): boolean
  querySolids(aabb): Aabb[]               // spatial hash lookup
  raycast(origin, dir, maxDist, opts): RayHit | null   // returns cell/static/door, distance, normal
  damageCell(id, amount, source): boolean              // true if destroyed
  destroyBox(aabb, opts: {includeReinforced: boolean}): number[]  // returns destroyed cell ids
  reinforce(panelId): boolean
  setDoorOpen(id, open), placeBarricade(id)
  serializeDiff() / applyEvents(events)   // for networking
}
```
The server owns truth. The client holds its own `World` instance, applies the same events, and uses it for prediction collision and tracers.

### 5.7 Rendering destruction (client `WorldView`)
- One `InstancedMesh` per material for cells. Destroyed cells set instance scale to 0 (cheap, no buffer reshuffle). Update only the changed instance matrices and flag `instanceMatrix.needsUpdate`.
- Damaged cells tint darker via `instanceColor` as hp drops. Reinforced cells use the `METAL` instance mesh.
- Static geometry is merged with `BufferGeometryUtils.mergeGeometries` into a few big meshes per floor. Floors above the player can be hidden or not, simply keep everything visible, it is a small map.
- Debris: on cell destruction spawn 3 to 5 tiny cube particles from a pooled `InstancedMesh`, 0.6 s lifetime, no collision.
- Bullet holes and decals: skip. Use a small impact spark and dust puff only.
- Frustum culling on, `matrixAutoUpdate = false` on statics, pixel ratio capped (`min(devicePixelRatio, 2)` on desktop, 1.5 on phones), antialias off on phones, fog for depth cue. **No shadow maps.** Fake a blob shadow under players with a dark circle sprite.

### 5.8 ASCII map format (`shared/maps/safehouse.map.txt`)
Header, then one block per floor separated by `--- floor N ---`. One character = one 0.5 m tile. Parser lives in `shared/mapFormat.ts` and must have unit tests (round trip counts, bounds, spawn presence).

Legend:
```
.  empty floor tile (walkable, floor slab below)
#  concrete wall (indestructible)
W  wood wall (soft)
P  plaster wall (soft)
B  brick wall (medium)
R  reinforceable wall (PLASTER base, defenders can reinforce)
g  glass window gap (glass cell at waist height, sill below, open above)
D  door (closed by default)
d  doorway (no door, open gap)
h  floor hatch (soft floor cells, breachable) - placed on the lower floor ceiling layer
c  ceiling hatch pair marker (matches an h above)
s  stairs up (direction defined in the header table)
S  stairs down
f  furniture block (1 tile static box, 1.0 m high)
F  tall furniture (1 tile, 2.0 m high)
A  attacker spawn point
Y  defender spawn point
O  objective zone tile (secure area)
x  outside / void (not part of the building)
```
Header includes: name, tile size, floor height, objective name, attacker spawn names, drone spawn points, camera spots, and a stairs table. Keep it readable.

### 5.9 The map: "Safehouse"
Design brief for the one launch map. Two floors plus basement stairs only if time allows. Target size: about 28 by 20 meters (56 by 40 tiles) per floor.
- **Ground floor:** garage, kitchen, living room, hallway with main stairs, small office, back garden door. Several windows facing the front and back so attackers have approach angles.
- **Upper floor:** 2 bedrooms, bathroom, study, landing with stairs, a **reinforceable** wall pair around the objective room, 2 ceiling/floor hatches connecting to the ground floor.
- **Objective:** the study (upper floor, `O` tiles). Alternative site is the kitchen. Server picks one per round (random, same for both teams, announced before prep).
- At least **6 reinforceable wall panels**, **4 hatch spots**, **8 windows**, **3 outdoor attacker spawn points** (front, side, back), **6 defender spawn points**, **4 drone entry spots outside**.
- Hand author it, then validate with a script `npm run map:check` that flood fills from attacker spawns to verify every objective tile is reachable, spawns are not inside solids, and no tile is out of bounds.

---

## 6. Combat

### 6.1 Weapons (initial set, stats in `constants.ts`, all tunable)

| Weapon | Role | Dmg body | Head mult | RPM | Mag | Reload | Spread (deg, hip / ads) | Wall dmg | Range falloff |
|---|---|---|---|---|---|---|---|---|---|
| Carbine | rifle | 27 | 2.5 | 650 | 30 | 2.3 s | 1.8 / 0.5 | 12 | starts at 30 m |
| Rattler | SMG | 20 | 2.2 | 850 | 35 | 2.0 s | 2.2 / 0.8 | 8 | starts at 15 m |
| Hammer | shotgun | 11 x 8 pellets | 1.5 | 70 | 6 | 0.6 s per shell | 6 / 4 | 6 per pellet | starts at 8 m |
| Marksman | DMR | 55 | 2.5 | 180 | 10 | 2.8 s | 1.0 / 0.1 | 25 | starts at 50 m |
| Sidearm | pistol | 38 | 3.0 | 400 | 12 | 1.6 s | 1.5 / 0.5 | 6 | starts at 15 m |

Every player carries a primary and a sidearm. Switch with key `1`/`2` or a touch button. Aim down sights (ADS): right mouse on desktop, a toggle button on phone (tighter spread, slower move, narrower FOV).

### 6.2 Firing and hit detection (server authoritative with lag compensation)
1. Client fires, shows tracer and muzzle flash immediately (cosmetic), sends `FIRE` button inside the input command along with `clientTime`.
2. Server queues the shot at the correct position in the input stream. For each shot it computes the ray from the player's eye using the player's yaw and pitch **plus a deterministic spread offset** from `weapons.ts` using a seeded RNG (`seed = playerId * 7919 + shotIndex`). Client and server compute the same spread, so tracers match.
3. **Lag compensation:** server keeps 500 ms of position/crouch history per player. For a shot, it rewinds all *other* players to `clientTime - interpDelay` (clamped to at most 250 ms in the past), tests the ray against rewound hitboxes, then tests world cells at **current** state. Nearest hit wins.
4. On hit: apply damage, send `HIT` event to shooter (hit marker, headshot sound), `DAMAGED` event to victim (directional damage indicator).
5. On kill: broadcast `KILL` event, victim enters spectate. Kill feed on every screen.

### 6.3 Recoil, ADS and feel
- Camera recoil: per weapon vertical kick plus small horizontal sway, recovers over time. This is **cosmetic and client side only**; the server uses spread only. Keep recoil subtle so touch aiming stays playable.
- Mobile aim assist (client side only): small magnetism toward the nearest enemy head within a narrow cone while ADS or firing, strength configurable and toggleable in settings.
- Viewmodel: a simple box built gun with bob, sway and recoil animation, reload dip.

### 6.4 Melee
Short range (1.5 m) arc check, 40 damage to players, 40 to barricades, instant on press with 0.7 s cooldown. Used for kicking barricades, which is important for attackers.

### 6.5 Spectating
After death: free cycle through living teammates (tap/click to switch). Also can watch teammate drones. After the round ends everyone is revived at next round.

---

## 7. Game modes and round flow

### 7.1 Modes
1. **Secure Area (main).** Attackers win by holding the objective zone uncontested for 10 s (no living defender inside) or by eliminating all defenders. Defenders win by eliminating all attackers or when the action timer runs out.
2. **Elimination (debug and warm up).** Last team standing wins. No objective. Great for early testing.

### 7.2 Phases (state machine in `roundSystem.ts`)
`LOBBY -> OPERATOR_SELECT (20 s) -> PREP (45 s) -> ACTION (180 s) -> ROUND_END (6 s) -> next round or MATCH_END`
- **PREP:** attackers are confined to an outdoor volume (invisible walls), can use drones only. Defenders spawn indoors, place reinforcements and barricades, set gadgets. Attacker drone can tag defenders (section 8). Defender cameras (Eye operator) are active.
- **ACTION:** attackers released. Timer runs. Overtime logic: if attackers are in the zone when time expires, a short overtime while contested.
- First to **4 rounds** wins (best of 7). Teams swap sides after round 3 and after round 6 if needed. All configurable in the room settings.
- Scoreboard shows kills, deaths, objective time. Round end shows a short summary.
- Disconnect handling: a disconnected player is removed (counts as dead for the round). Reconnect within 60 s restores their slot via a session token stored in `sessionStorage`.

---

## 8. Information warfare (key to the Siege feel)

### 8.1 Visibility filtering (anti wallhack, also reduces bandwidth)
`visibilitySystem.ts` builds each recipient's snapshot:
- Teammates: always included.
- Enemies: included only if (a) there is a clear line of sight from the recipient's eye to any of 3 points on the enemy (head, chest, feet) using the world raycast with a 0.5 s hysteresis, OR (b) the enemy is **tagged** by a drone or gadget, OR (c) a sound ping was emitted for them (below).
- Because of this, a modified client cannot see through walls. Late hysteresis avoids pop in.

### 8.2 Drone
- Attacker `DRONE` button (hold or toggle). The player's body stays put and vulnerable. The view switches to a small RC drone entity.
- Drone: radius 0.15, speed 3.0 m/s, free flight, 0.3 s vertical thrust, 25 HP, collides with the world, can pass through open windows and doorways. Drone camera has a distinct green tint filter and a slight vignette.
- **Tag:** center screen tap or a Tag button highlights an enemy in the crosshair for 8 s. Tagged enemies are included in the snapshots for the whole attacking team, and shown as a red outline marker visible through walls. Limit: 1 tag per second.
- Drones are destructible by gunfire and by defender gadgets. When a drone dies the player returns to their body.
- During PREP drones are free. In ACTION attackers have a single drone each (cooldown after loss).
- Defenders: static security cameras (placed by Eye operator, M8).

### 8.3 Sound pings
Loud events (sprinting footsteps within 8 m, breach charge, gunfire, reinforcement placing, door slam, barricade break) create a `soundEvent {pos, loudness}`. The server sends them as a brief **radar pulse marker** (a 1 s fading ring on a HUD compass strip and a world space ring). Enemies emitting sound without LOS appear only as a direction ping, not an exact position (random jitter of a meter).
Plus real positional audio on the client (see section 10).

### 8.4 HUD info
Compass strip with teammate markers, ammo, health, current gadget count, round timer, team alive icons, and objective indicator. Keep it clean: minimal DOM updates (only change textContent when a value changes).

---

## 9. Operators and gadgets

Start with **8 operators** (4 per team). Each has: a primary weapon pick (2 choices), a sidearm, 1 gadget with 2 uses, and one **passive** (tiny tweak). Gadgets are implemented in `gadgetSystem.ts` as small objects with `onUse`, `onTick`, `onDestroyed`. Ship them in this order.

### Attackers
| Operator | Gadget | Behavior |
|---|---|---|
| **Ram** | Hard breach charge | Throw/stick to a wall or hatch. Detonate on a second press. `destroyBox` of 1.5 x 2.0 x 1.5 m including **reinforced** cells. Damages players in the blast, strong knockback. |
| **Ping** | Pulse sensor | Deploy a handheld that, while held, shows heartbeat pings of enemies within 12 m through walls for 6 s, direction accurate, small jitter. Cooldown 20 s. |
| **Mend** | Heal darts | Fire a dart at teammate (or self) to heal 40 HP over 4 s. 4 charges. Cannot revive. |
| **Aegis** | Deployable shield | Place a 1.2 m wide shield, 400 HP, blocks bullets, attackers can vault over it. |

### Defenders
| Operator | Gadget | Behavior |
|---|---|---|
| **Warden** | Extra reinforcements | Has 3 reinforcement charges instead of 2, takes 1.5 s to place. Passive: slightly faster barricading. |
| **Snare** | Spike traps | Floor trap, visible to defenders only, slows an attacker 70 percent for 3 s and deals 25 damage. 3 traps. |
| **Jam** | Signal jammers | Placed in a room, disables Ping's sensor, Mend's darts and attacker drones within 8 m. 2 jammers, 60 HP each. |
| **Eye** | Security cameras | Place up to 2 cameras on walls or ceiling. Defenders can cycle through them from a button. Cameras tag attackers in view like a drone and are shot to destroy (30 HP). |

Operator pick screen: each player chooses one unique operator per team before PREP (server validates, no duplicates).

---

## 10. Audio (all synthesized, no files)

`audio/Audio.ts` builds sounds from oscillators, filtered noise and envelopes at boot into reusable `AudioBuffer`s.
- Sounds: gunshots (per weapon timbre), reload clicks, hit marker tick, headshot ding, footsteps (3 surface variations: wood, concrete, metal), door open/close, glass break, wall break thud, breach charge, barricade hit, reinforcement hammering loop, drone hum, UI clicks, round start sting, round end sting, 10 second timer beeps.
- Positional playback using `PannerNode` with `equalpower` panning on phones and `HRTF` on desktop. Rolloff tuned for 3 to 40 m. Simple occlusion: if a wall is between listener and source, apply a low pass filter at 800 Hz.
- Audio context must be created or resumed on the first user gesture (tap on "Play").
- Master volume and SFX volume in settings.

---

## 11. Networking details

### 11.1 Connection and lobby
- Client opens `wss://<host>/ws` (or `ws://` on localhost). Messages are JSON arrays or objects with a `t` field behind `protocol.ts`.
- Client -> server: `CREATE_ROOM`, `JOIN_ROOM {code, name, token?}`, `SET_TEAM`, `SET_READY`, `PICK_OPERATOR`, `START_MATCH` (host only), `INPUT {cmds[]}`, `CHAT` (optional), `PING {t}`.
- Server -> client: `JOINED {playerId, token, roomState, worldState}`, `ROOM_STATE`, `PHASE {phase, endsAt}`, `SNAPSHOT {tick, serverTime, lastProcessedSeq, players[], events[]}`, `EVENT_*` (kill, hit, damaged, cellDestroyed, reinforced, gadget), `PONG`, `ERROR`.
- Room codes: 4 uppercase letters, avoiding ambiguous ones. The host sees a **QR code of the join URL** (draw it with a tiny self written QR generator OR link to a public API only if I approve, prefer a minimal local implementation, ask me first).
- Max room size 10. Rooms are destroyed 60 s after the last player leaves.

### 11.2 Prediction and reconciliation (client)
1. Each frame: sample input, step local player with `stepPlayer`, push the cmd into a pending buffer.
2. On `SNAPSHOT`: take the authoritative state for the local player at `lastProcessedSeq`, drop acked cmds, replay unacked cmds on top. If the error is under 0.02 m ignore, under 0.5 m smooth correct over 100 ms, over that snap.
3. Render the local camera from the predicted state, with render time smoothing between sim steps.

### 11.3 Remote players
Store the last ~10 snapshots per entity. Render at `now - 100 ms`, lerp position and slerp yaw/pitch between the two bracketing snapshots. If a snapshot is missing, extrapolate up to 100 ms then freeze.

### 11.4 Bandwidth budget
Position quantized to 1 cm, angles to 16 bit. Target under 15 KB/s down per player at 10 players. JSON is fine first, `protocol.ts` must make it possible to move to binary `ArrayBuffer` messages later without touching game code.

### 11.5 Cheating and sanity checks
Server clamps movement speed (it simulates inputs itself, so mostly free), clamps fire rate per weapon, validates interact distances, rejects impossible `clientTime`, and drops malformed messages. Rate limit messages per socket.

---

## 12. Milestones (build in this order, one at a time)

Each milestone lists tasks and **acceptance criteria**. Do not move on until they pass.

### M0 - Scaffold (about 1 hour)
Tasks: npm workspaces, strict TS configs, Vite client, tsx server, vitest, root scripts, `CLAUDE.md`, ESLint optional (skip unless I ask), a README with run instructions, basic CI workflow for typecheck and test.
Accept: `npm run dev` serves a page showing a spinning cube, server logs "listening", `npm run test` and `npm run typecheck` are green.

### M1 - 3D sandbox, single player, no network
Tasks:
- `Renderer`, `Game` main loop with fixed timestep for sim and variable render.
- `shared` modules: math, collision, world (with a hardcoded tiny test room built in code first, ASCII parser comes in M2), `stepPlayer`.
- Desktop input (pointer lock, WASD, shift sprint, C crouch) and **phone touch controls** (left virtual stick, right look drag, fire / jump-less buttons: crouch, sprint toggle, interact, reload, fire). All write to `InputState`.
- Basic HUD (crosshair, fps counter toggled with a query param `?debug`).
- Test room: a few rooms with doorways, a staircase, a window, boxes as furniture.
- Unit tests for collision (no tunneling at 6 m/s, slides along walls, stairs step up).
Accept: playable on desktop and on a phone over LAN at 60 fps, no wall clipping, stairs work, crouch fits under a 1.4 m gap but standing does not.

### M2 - Map pipeline and destruction (still offline)
Tasks:
- `mapFormat.ts` parser and tests, `safehouse.map.txt` first pass, `map:check` script.
- `World` cells with HP, materials, `damageCell`, `destroyBox`, reinforce, door toggle, hatches.
- `WorldView` instanced rendering, damage tint, debris pooled particles, merged static geometry.
- Offline debug weapon: hold fire to shoot cells with a ray from the camera, key `B` to blow a 1.5 m hole where you look, key `R` to reinforce the targeted panel, key `E` doors and barricades.
Accept: full house walkable, shooting wears down plaster and wood but not concrete, reinforced walls immune to bullets but not the debug breach, hatch breach lets you drop to the floor below, 60 fps on a phone with all walls intact.

### M3 - Authoritative server and netcode
Tasks:
- `Connection`, `protocol`, `Lobby` and `Room`, room codes, join flow, simple lobby UI (name, create, join, team select, start).
- Server tick loop, per player input queue, `stepPlayer` on server, snapshots at 20 Hz.
- Client prediction, reconciliation, remote interpolation, clock sync, ping display in debug HUD.
- Simulated latency tools: query params `?lag=100&jitter=30&loss=2` implemented in the client Connection wrapper for testing.
Accept: 3 devices in one room see each other move smoothly, local movement feels instant at 150 ms simulated lag, no rubber banding on a steady connection, late joiner gets the correct world state.

### M4 - Combat
Tasks: weapons table, firing, deterministic spread, server hit detection with lag compensation, health, death and spectate, hitboxes, hit markers, damage indicators, kill feed, reload and ammo, viewmodel, tracers and impacts, melee, weapon switch, ADS.
Tests: lag compensation unit test (shoot at a rewound position hits, shoot at current position of a player who moved misses), weapon fire rate clamping, spread determinism.
Accept: two phones can shoot each other, headshots feel right, kills register once, dead players spectate, bullets chip walls on the server and the client sees the same holes.

### M5 - Siege mechanics
Tasks: reinforce interaction (hold to place, progress bar), barricades on doors and windows, melee kick, window vault, hatch shooting, optional soft wall penetration flag, explosive destroyBox, networked `cellDestroyed` events and late join sync, sounds for each.
Accept: defenders can fortify the objective in prep, attackers can open a hatch above and shoot down through it, destroyed state matches on all clients and for late joiners.

### M6 - Round flow and game modes
Tasks: `roundSystem` state machine, prep confinement, win conditions, objective capture timer, scoring, side swap, operator select screen (just weapon choice for now), scoreboard, round and match end screens, reconnect tokens, host settings (rounds to win, prep time, action time, mode).
Accept: a full 5 round match can be played start to finish with 4 or more players.

### M7 - Drone and information
Tasks: drone control and view, tagging, visibility filtering per recipient, sound ping events, compass HUD, drone destruction and respawn rule, prep phase drone UX on mobile (move stick, up/down buttons, tag button).
Accept: attackers can scout the defenders in prep, tagged enemies show through walls only for tagging team, enemy position data is absent from a non-tagged attacker's network traffic (verify by logging snapshot contents on the client in debug mode).

### M8 - Operators and gadgets
Tasks: the 8 operators in the order of the table in section 9 (**Ram, Warden, Ping, Snare, Aegis, Jam, Mend, Eye**), gadget system architecture, HUD gadget slot, operator select UI, server validation of unique picks.
Accept: each gadget works, syncs, is destroyed correctly, and has a test or a documented manual test.

### M9 - Audio and juice
Tasks: all synthesized sounds, positional audio and occlusion filter, screen shake on nearby explosions, damage vignette, footstep sounds by surface, UI polish, settings screen (sensitivity, FOV, graphics quality, aim assist, volume, invert Y).
Accept: you can locate enemies by footsteps with headphones, no audio glitches on mobile Safari or Chrome, graphics quality low/medium/high works.

### M10 - Mobile polish and install
Tasks:
- Touch layout refinement, button size options, left/right hand swap, optional gyro aim (DeviceOrientation, permission prompt on iOS), haptic feedback via `navigator.vibrate` where available.
- Landscape layout, `touch-action: none`, prevent pull to refresh and double tap zoom, `viewport-fit=cover`, safe area insets.
- Fullscreen button (Android), Wake Lock API, **PWA manifest + service worker + "Add to Home Screen" instructions for iPhone** (Safari has no real fullscreen outside a PWA).
- Stretch: lean (Q, E, plus touch edge swipes), dynamic resolution scaling when fps drops under 45.
Accept: installable PWA, landscape locked layout is comfortable on a 6 inch phone, no accidental browser gestures during play.

### M11 - Hosting
Tasks:
- **LAN mode:** server serves the built client and the websocket on one port with HTTPS. See section 13.
- **Production:** Dockerfile or systemd unit for Hetzner, GitHub Actions workflow to build, test and deploy, Cloudflare in front with WebSockets enabled, `wss` only, basic health endpoint `/health`.
- Optional `npm run lan` script that starts everything and prints the local URL plus a QR code to the terminal.
Accept: friends on cellular data can join via the public URL, friends on the same Wi-Fi can join via the LAN URL.

### M12 - Stretch backlog (only if the base is fun)
Binary protocol, bots (simple nav grid and shoot), second map, spectator mode for non players, replay of last round, custom operator abilities, ranked style stats, WebRTC data channels for lower latency, finer destruction (0.25 m cells), gamepad support, in game text chat and ping markers.

---

## 13. Critical gotchas (handle these deliberately)

1. **Secure context on phones.** Wake Lock, DeviceOrientation permission, PWA install and service workers need HTTPS. A LAN IP over plain HTTP is not a secure context (only `localhost` is exempt). Solutions, pick one and document it in the README:
   - **Dev/LAN:** `@vitejs/plugin-basic-ssl` for the Vite dev server with a proxy `/ws` -> `ws://localhost:PORT` (`ws: true`, `secure: false`). Phones will show a certificate warning once, accept it.
   - **Production LAN:** server generates or loads a self signed cert (mkcert recommended) and serves static plus `wss` on one port.
   - **Easiest for friends anywhere:** a Cloudflare Tunnel (`cloudflared`) to the local server gives a real HTTPS URL with a valid cert and no router setup.
2. **iOS Safari quirks:** no Fullscreen API on iPhone pages, no vibration API, audio only starts after a gesture, `100vh` is unreliable (use `dvh` or `visualViewport`), pointer events preferred over touch events. Test on real iPhones early (M1).
3. **Pointer lock** on desktop requires a user gesture, handle `pointerlockchange` and show a "click to resume" overlay.
4. **Determinism:** `shared` must not touch `Date`, `Math.random`, DOM or Three.js. Use the seeded RNG from `math.ts`. Add a test that runs the same input sequence twice and asserts identical state.
5. **Memory and GC:** no allocations in hot loops (reuse vectors, pools for particles, tracers, and events). Phones stutter hard from GC.
6. **Tab visibility:** if the tab is hidden, stop sending inputs and show a reconnect overlay when it returns. Server must tolerate input gaps.
7. **Wi-Fi jitter:** the interpolation buffer should adapt (100 ms default, up to 200 ms when jitter is high).
8. **Cloudflare:** WebSockets must be enabled, idle timeouts are around 100 s so send app level pings every 15 s.
9. **Instanced mesh limits:** do not exceed a few thousand live instances per mesh without testing on a phone. If too heavy, merge distant intact wall stacks into single boxes until damaged (optimization for later).
10. **Authoring safety:** map file edits are easy to break. `map:check` must run in CI.

---

## 14. Quality and testing

- Unit tests (vitest) for: math and RNG, collision and sweeps, ray vs AABB, map parser, world destruction, movement determinism, weapon spread determinism, lag compensation, round state machine transitions, visibility filtering.
- An integration test that boots the server in memory with N fake clients (simple scripted bots over a real `ws` connection), plays a full round in Elimination mode, and asserts a winner is declared.
- Manual test checklist file `TESTING.md` updated each milestone: desktop Chrome, Android Chrome, iPhone Safari (installed PWA and in browser), 150 ms simulated lag, 5 percent packet loss.
- Debug overlay (`?debug`): fps, frame ms, draw calls, triangles, ping, snapshot rate, prediction error, entity counts, memory estimate.
- Performance targets: under 150 draw calls, under 150k triangles, JS frame time under 6 ms on a mid range phone, server tick under 2 ms with 10 players.

---

## 15. Visual and UX direction

- Palette: desaturated, readable. Dark charcoal outer shell, warm beige interiors, team colors: attackers **orange** (#ff7a1a), defenders **cyan** (#18c8ff). Enemy outlines in red when tagged.
- Players are blocky robot/soldier capsule figures with a visor head box and a team colored chest stripe so team ID is instant. Simple procedural walk bob (legs as two boxes swinging) is enough, no skeletal animation.
- UI font: a system font stack, bold uppercase for headings. Menus must be usable one handed on a phone in landscape.
- Keep the first launch screen minimal: Name field, Create Room, Join Room, Settings.

---

## 16. Definition of done for v1

Five friends can open a URL on their phones, join a room, pick operators, play a 7 round Secure Area match on Safehouse with reinforcement, drones, breaching, destruction, positional audio and a scoreboard, at a steady frame rate, without desyncs.

---

## 17. Kickoff prompt for Claude Code

Paste this after placing this file as `PLAN.md` in an empty repo:

```
Read PLAN.md fully. Copy sections 0, 1 and 2 into CLAUDE.md. Then do Milestone M0 and Milestone M1 only. Follow the working rules in section 0 strictly: complete files, minimal dependencies, no em dashes. When done, run typecheck and tests, commit with clear messages, and tell me exactly how to run it on desktop and on my phone over the LAN (including the HTTPS workaround from section 13). Then stop and wait for me.
```
