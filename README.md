# HOLDFAST

A cheap, original, Rainbow Six Siege inspired 3D tactical breach shooter. Browser based, multiplayer, built to be played on phones and laptops with friends over your own Wi-Fi or the internet.

TypeScript, Three.js, and a tiny authoritative Node WebSocket server. No game engine, no physics engine, no UI framework, no audio or model files: everything is generated in code.

- 2 to 10 players, one life per round, attackers vs defenders on one two floor house ("Safehouse").
- Destructible walls and floors, reinforcement, barricades, hard breach charges, drones, security cameras, pulse sensors, traps, jammers, shields, heal darts.
- Server authoritative with client prediction, snapshot interpolation and lag compensated hitscan.
- Phone, desktop and gamepad first class. Installable as a PWA, and playable fully offline (see below), including solo matches against bots.
- Real recoil, nine weapons, leaning, a grounded hopping RC drone.

`PLAN.md` is the full design. `CLAUDE.md` holds the working rules.

## Quick start

```bash
npm install        # .npmrc sets legacy-peer-deps, you do not need to pass anything
npm run dev        # game server + Vite dev server (HTTPS)
```

Open `https://localhost:5173`. The first time, the browser warns about the self signed certificate: Advanced, Proceed.

Click **SOLO MATCH vs BOTS** to play a real round based match alone (you and bot teammates against bots, no server and no internet needed), or **PRACTICE** for a shooting range with targets and sandbox tools.

Click **PRACTICE** to play alone right away. Practice runs a complete authoritative room inside your browser (no server needed) with shootable targets and sandbox tools, so it is the fastest way to try destruction, gadgets and movement.

## Playing with friends on your Wi-Fi (phones and laptops)

Phones need a **secure context** (HTTPS) for Wake Lock, gyro aim and installing the PWA, and a LAN IP over plain HTTP is not secure. Pick one:

1. **Easiest, one command:** `npm run lan`
   Builds the client, creates a self signed certificate for your LAN IPs (needs `openssl`), and serves the game and websocket over HTTPS on one port (`PORT`, default 8443). It prints the URL and a **QR code**. Friends scan it, accept the certificate warning once, and are in.
2. **Dev server:** `npm run dev` prints a QR for `https://<your-ip>:5173`. Same warning, once.
3. **Friends anywhere (valid certificate, no router setup):** run the server locally (`npm run build && npm start`) and put a Cloudflare Tunnel in front: `cloudflared tunnel --url http://localhost:8787`. It gives you a real `https://....trycloudflare.com` URL.

In the game: one person taps **CREATE ROOM**, everyone else enters the 4 letter code (or scans the QR in the lobby). The host picks settings and starts the match.

**iPhone:** Safari has no fullscreen for web pages. Use Share, then **Add to Home Screen**, and open it from there. Audio only starts after your first tap. Rotate to landscape.

## Playing offline

| What you want | How | Needs |
|---|---|---|
| Solo match vs bots or Practice, nothing installed, no internet | `npm run build:offline`, then open `dist-offline/holdfast.html` (about 760 KB, one file, double click it). Copy it to a USB stick or another computer and it still works. | Any modern browser. No server. Solo match and Practice only, multiplayer shows a message. |
| Solo Practice, reopens like an app | Visit the game once while online (or on `localhost`), then it is cached by a service worker and opens with no network at all. On a phone use Add to Home Screen. | One visit over `localhost` or a real HTTPS certificate. |
| Multiplayer with friends and no internet | `npm run lan` on one laptop, everyone joins that laptop's address over the same Wi-Fi or a phone hotspot. Nothing is fetched from the internet at runtime (no CDN, no fonts, no analytics). | Run `npm install` once while online. |

Notes:

- Practice is a real authoritative room that runs inside the page, so it plays exactly like online except for the other players.
- Chrome and Edge refuse to register service workers on a self signed certificate, so the "reopens offline" behaviour does not apply to `npm run lan` pages that you reached through the certificate warning. Use the single file, `localhost`, or a real certificate (a Cloudflare Tunnel gives you one) for that. LAN multiplayer itself is unaffected.
- The single file build has no PWA, wake lock or gyro features, because browsers only grant those to secure origins.
- Tested here in headless Chromium: the single file from `file://` (one request, the file itself), and the service worker reopening the game with the server stopped. Not yet tested on a real phone.

## Controls

| Action | Keyboard and mouse | Touch |
|---|---|---|
| Move / sprint | WASD / Shift | Left stick (push to the rim to sprint) |
| Look | Mouse | Drag the right side |
| Fire / aim | Left / right mouse | FIRE (drag it to aim) / AIM |
| Reload, swap, kick | R, 1 / 2 or mouse wheel, V | RELOAD, SWAP, KICK |
| Lean (peek around corners) | Q / E | LEAN buttons |
| Crouch | C (toggle), Ctrl (hold) | CROUCH |
| Use (door, vault, hold to reinforce or barricade) | F | USE |
| Gadget | G | GADGET |
| Grenade / trap (secondary gadget) | T | NADE |
| Drone / camera | X / Z | DRONE / CAM |
| Drone hop | Space | HOP |
| Scoreboard / pause | Tab / Esc | SCORE / II |
| Practice tools | B blast, N reinforce, M reset, K refill | Pause menu |

**Gamepad** (standard mapping, Xbox / PlayStation / most Bluetooth pads, used in matches and Practice; menus still need the mouse or touch): left stick move, L3 sprint, right stick look, RT fire, LT aim, A use (hops the drone), B crouch, X reload, Y swap weapon, LB / RB lean, R3 kick, D-pad up gadget, down drone, left cameras, right grenade, Back scoreboard, Start pause. **Recoil assist** (settings, on by default for touch) makes the gun kick 40 percent weaker.

Tap F near a **broken window** to vault through it. **Hold F** facing a marked wall panel to reinforce it (defenders, prep only) or facing a door or window to barricade it. Drone: a small RC car that drives on the floor (WASD, mouse to look), rolls over tiny lips and **hops** (Space) about knee high to get over low furniture and up stairs. It cannot fly, cannot pass one metre furniture, and a hard fall damages it. FIRE tags the enemy in your crosshair so your team sees them through walls for 8 seconds.

**Leaning:** hold Q or E to put your head and shoulders out around a corner while your feet stay put. The server treats the leaned head as really being there (line of sight, shots and hit boxes), walls stop the lean, you walk slower while leaning and cannot lean while sprinting or in the air. Falling more than about 1.4 m hurts, a long fall kills.

## Bots (solo matches)

The menu's **SOLO MATCH vs BOTS** starts a full match in your browser: pick your side (attack or defend), team size (2 to 5 per team, you included) and bot difficulty (easy, normal, hard). It uses the same rules, map and round flow as an online match (operator pick, prep, action, first to 3 rounds, sides swap every 2).

Bots are ordinary players whose inputs are generated on the server side of the game (in your page for solo play), so they move, shoot, recoil, reload and take damage by exactly the same code as you. They have no special senses: they see what is in their field of view with a clear line, and hear footsteps, gunfire and breaches within range. Attackers path to the objective (through doors and up the stairs), kick down barricades and fight what they meet; defenders reinforce walls and barricade doors in prep, then hold positions near the objective, turn to noises and contest the objective when it is being taken. They throw frag, flash and impact grenades at enemies they see and plant or defuse the bomb. They do not use operator gadgets, traps or drones yet.

## How a match works

`Lobby, Operator select (20 s), Prep (45 s), Action (180 s), Round end`. First team to 4 rounds wins; sides swap every 3 rounds. In **Secure Area** attackers win by holding the glowing objective zone for 10 seconds with no living defender inside, or by eliminating defenders; defenders win by eliminating attackers or running out the clock. In **Bomb** attackers plant a defuser inside the zone (hold the interact key for 4 seconds) and have to protect it for 45 seconds, defenders disable it by standing next to it and holding interact for 7 seconds; once it is planted the attackers do not have to stay alive. **Elimination** is last team standing. Host settings are in the lobby.

If someone's connection drops, they keep their slot: a 3 second grace period before they count as dead for the round, and they can rejoin the same room for up to 60 seconds (the game reconnects automatically; if you reload the page, tap JOIN again and you get your slot back). Players who join mid-round spectate until the next round.

| Operator | Side | Gadget |
|---|---|---|
| Ram | Attack | Hard breach charge (breaks reinforced walls and hatches) |
| Ping | Attack | Pulse sensor (heartbeats through walls) |
| Mend | Attack | Heal darts |
| Aegis | Attack | Deployable shield, 110 HP |
| Warden | Defend | Extra reinforcement, faster building |
| Snare | Defend | Spike traps |
| Jam | Defend | Signal jammers |
| Eye | Defend | Security cameras |
| Recruit | Both | No gadget, always available |

## Weapons and gunplay

Every operator carries a primary and a sidearm, picked on the operator screen (the screen shows damage, rate, range, control and mobility bars). Switch with `1` / `2` / `Q`.

| Weapon | Role | Notes |
|---|---|---|
| Carbine | Rifle | All round, 650 rpm, 30+1 |
| Talon | Burst rifle | 3 round bursts, one press per burst, precise |
| Rattler | SMG | Fast, light recoil, short range |
| Whisper | Suppressed SMG | Almost silent, so it does not give your position away on the enemy compass, lower damage |
| Hammer | Pump shotgun | 8 pellets, loads shell by shell (fire to interrupt) |
| Marksman | DMR | One hit headshots, slow to aim, scope |
| Anvil | LMG | 60 rounds, heavy recoil, slow to aim and raise, chews through walls |
| Sidearm | Pistol | 12+1, one hit headshots |
| Magnum | Heavy pistol | 6 rounds, 62 damage, strong kick |

How guns behave (all simulated by the shared step, so the server and your prediction agree):

- **Recoil is real.** Each shot kicks the aim up and a little sideways (a per weapon pattern plus a bit of randomness). The kick climbs while you hold the trigger and settles when you let go, so you pull down to hold a target. Crouching, aiming and standing still reduce it, moving and jumping increase it. The first shot of a spray is always accurate.
- **Bloom.** Sustained fire opens the spread cone, tapping lets it close. The crosshair is the real cone, so what you see is what you get.
- **Aiming takes time** (SMGs are fast, the LMG and DMR slow), and you cannot shoot for a moment after sprinting or switching. Reloading drops the sights.
- **Reloads.** A tactical reload (rounds left) is quicker and leaves one in the chamber (30+1). An empty reload is slower. Shotguns load shell by shell.
- **Hit zones.** Head (big multiplier), body, legs (80 percent). Damage drops with range. Bullets go through soft walls with a loss that depends on the weapon (the Marksman and Anvil keep the most).
- A click made just before the gun is ready is remembered, so semi automatic weapons never feel like they ate your input.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Server (tsx watch) and Vite dev server together, HTTPS, QR for phones |
| `npm run lan` | Build and serve over HTTPS on one port with a QR code |
| `npm run build` / `npm start` | Production build / production server (serves `client/dist`) |
| `npm run build:offline` | One self contained `dist-offline/holdfast.html` for solo Practice with no server |
| `npm test` | Vitest unit and integration tests (includes bots playing over real websockets) |
| `npm run typecheck` | Strict TypeScript for shared, server and client |
| `npm run map:check` | Validates every map in `shared/maps` (reachability with a player sized footprint, spawns, counts) |
| `npm run lint:dashes` | Guards the "no em dashes" rule |
| `npm run icons` | Regenerates the PWA icons |
| `npx tsx scripts/bench.ts` | Server benchmark: 10 players on Safehouse, prints tick time and bandwidth |
| `npx tsx scripts/arena-server.ts` | Serves the built client with a tiny open arena map on port 8788 (quick two-player testing) |

Environment: `PORT` (default 8787), `HTTPS=1` with `HTTPS_KEY` / `HTTPS_CERT` (or files in `certs/`).

URL parameters for testing: `?debug` (stats overlay), `?lag=100&jitter=30&loss=2` (simulated network), `?touch` (force touch controls), `?room=ABCD` (prefill the join code), `?netpractice` (run Practice on the real server instead of in the browser, handy together with `?lag=`), `?nolock` (skip pointer lock, for automated browser tests).

## Repository layout

```
shared/   deterministic code used by BOTH sides: constants, math, collision, World (voxel grid with
          destructible cells), stepPlayer (movement and weapons), map parser and checker, protocol, QR
server/   Room, Lobby, systems (movement, combat, destruction, gadgets, rounds, visibility); Node bootstrap
client/   Three.js renderer, WorldView (instanced cells), prediction, interpolation, HUD, UI, audio, input
scripts/  dev, lan, map check, icon generator
deploy/   Dockerfile and systemd unit examples
```

Key ideas:

- **One simulation, two places.** `shared/src/movement.ts` is the only movement and firing code. The server runs it for truth, the client runs the same function for prediction, and inputs are quantized so both sides agree bit for bit.
- **The map is ASCII** (`shared/maps/safehouse.map.txt`, legend in PLAN.md section 5.8). Edit it by hand, then run `npm run map:check`.
- **Anti wallhack:** every snapshot is filtered per recipient. Enemies you cannot see (and have not tagged) are simply not in your network traffic. Sounds out of line of sight arrive with a jittered position.
- **Practice mode** runs the same `Room` class in the browser through a loopback transport (`client/src/net/Connection.ts`), which is why the server's `engine.ts` has no Node imports.

## Hosting it online

The game has two parts with different hosting needs:

| Part | What it is | Where it can run |
|---|---|---|
| Client (menu, solo Practice, PWA) | Static files in `client/dist` | Anywhere static: Vercel, Netlify, Cloudflare Pages, GitHub Pages |
| Server (rooms, multiplayer) | A long running Node process holding WebSockets and a 60 Hz loop | A host that runs a normal always-on process or container: Fly.io, Railway, Render, a VPS (Hetzner), or your own machine behind a tunnel |

Vercel, Netlify and similar serverless platforms cannot run the server (functions are short lived and cannot keep a match alive), so **do not put the whole game on Vercel and expect multiplayer to work**: the page would load and Practice would run, but CREATE ROOM and JOIN would fail.

A `vercel.json` is included for the static client (output `client/dist`), so importing this repository into Vercel deploys the menu and solo Practice with no settings to change.

The simplest setup is one container that serves both the client and the WebSocket on one URL, because the client connects to whatever host it was loaded from:

- **Container host (Fly.io, Railway, Render, ...):** create a service from this repository using `deploy/Dockerfile`, set the health check path to `/health`, and let the platform provide HTTPS. The server listens on `$PORT` (8080 in the image) on all interfaces. Rooms live in memory, so a restart ends running matches, and a platform that sleeps idle services makes the first visitor wait for it to wake.
- **Free and instant, from your own computer:** `npm run build && npm start`, then `cloudflared tunnel --url http://localhost:8787`. It prints a real `https://....trycloudflare.com` link to share, and it works while your computer is on.

Status: `npm start` serving the client and `/health` was checked locally, and the build and tests run in CI. The Docker image and the specific hosting platforms have not been exercised from here.

## Deploying (Hetzner behind Cloudflare)

`deploy/Dockerfile` builds and runs the server and client in one image; `deploy/holdfast.service` is a systemd unit if you prefer running on the host. Put Cloudflare in front with WebSockets enabled and "Always use HTTPS". The game sends protocol level pings every 15 seconds, well inside Cloudflare's idle timeout. `/health` returns `{"ok":true}`. A manual GitHub Actions deploy template lives in `.github/workflows/deploy.yml`.

## Known limitations (v1)

- One map, JSON over WebSocket (a binary protocol is isolated behind `shared/src/protocol.ts`).
- Wall penetration is simplified: soft walls let bullets through once at half damage.
- Gyro aim is experimental and untested on real devices.
- The synthesized audio is functional rather than beautiful.
