# HOLDFAST - project rules

Sections 0, 1 and 2 of PLAN.md, copied here so every session sees them. PLAN.md is the source of truth.

## 0. How we work (read first)

> Note: the first session built every milestone (M0 to M11) in one go because the owner asked to "execute the plan as much as you can" so they could start testing. For later sessions, go back to working on one change at a time.

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

---

## Repo notes (added during the first build session)

- This is a standalone repository. It started life inside an unrelated website repo and was split out with its history, so there is nothing else to protect here.
- `npm install` needs `legacy-peer-deps=true` (already set in `.npmrc`).
- Everything in `shared/` must stay deterministic and free of DOM, Three.js, `Date` and `Math.random` (a test enforces this).
- `server/src/engine.ts` is platform neutral (no Node imports) so the same Room code runs in Node (real server) and in the browser (Practice mode over a loopback transport).
- The map is plain ASCII in `shared/maps/safehouse.map.txt`. After editing run `npm run map:check`.
- Run `npm run typecheck && npm test` before every commit.
- **Changes that supersede PLAN.md:** the drone is a grounded RC car with a hop, not a flyer (8.2). Gunplay v2 replaces 6.1 and 6.3: nine weapons, real server side recoil (the aim moves, `applyKick` / `settleRecoil` in `shared/src/weapons.ts`), bloom, timed ADS, tactical reloads with a chambered round, burst and suppressed weapons, a sidearm pick, leg hits and per weapon wall penetration. Weapon ids are always below 40, kill feed causes that are not guns live in `KillCause`.
- **Barricades are plank grids** (`Opening.planks`, 0.25 m cells, each with its own hit points, `SIEGE.plankHp`). `World.damageBarricade(id, x, y, z, amount, radius)` damages the planks near a hit point, `RayHit.sub` says which plank a ray hit (-1 = the door leaf), `queryBoxes` lets you through only where a body sized gap is open and `barricadeHp` is the sum of the plank hit points (above zero means some barricade is left). The wire format sends one digit per plank.
- **Bomb mode** (`GameMode.BOMB`): `server/src/systems/bombSystem.ts` (plant, defuse, fuse, blast), `Act.PLANT` / `Act.DEFUSE` in `destructionSystem.ts`, state in `room.bomb` (`BombState`), win rules in `checkWin`. The round clock becomes the fuse when the defuser is planted.
- **Secondary gadgets** (`shared/src/throwables.ts`, `server/src/systems/throwSystem.ts`): `Btn.THROW` (T), one `ThrowKind` per round picked in operator select (`PICK_OPERATOR.throwable`). Grenades are `EntityKind.GRENADE` entities integrated on the server at 60 Hz, smoke is a sphere in `World.smokes` that blocks `lineOfSight`, flash is `Player.blindUntil` (sent as `SelfExtra.flash`), wire and alarm are placed entities. Bots pick frag/flash (attack) or impact (defend) and throw them (`planThrow` in `botSystem.ts`).
- **Team markers**: `ClientMsg.MARK` (no payload, the server reads the aim), `server/src/systems/markSystem.ts`, delivered as a private `mark` event to teammates, drawn by `Game.updateHud` / `Hud.worldMarks`.
- **Spawns**: `shared/src/spawns.ts` (`spreadPick`, `openFacing`) spreads people inside a spawn group and turns defenders toward open space; `assignSpawns` in `roundSystem.ts` uses them.
- **Bots** live in `server/src/bots/` (`botSystem.ts` behaviour, `BotMind.ts` state and difficulty table, `solo.ts` match setup). A bot is a `Player` with `isBot` whose `InputCmd`s are pushed to its queue each tick before `processInputs`, so it follows every rule a human does. Navigation is `shared/src/nav.ts` (A* over tile corners, stairs as links, windows blocked, doors walkable). Bots have no connection and are excluded from `livePeople()` (host, room idle, round leave logic).
