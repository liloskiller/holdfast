# Testing

## Automated

```bash
npm run typecheck && npm test && npm run map:check && npm run lint:dashes
```

`npm test` covers math and RNG, collision and sweeps (no tunneling, sliding, stairs, crouch gap), ray tests, the map parser and checker, world destruction and replication diffs, movement determinism, weapon spread and fire rate, protocol round trips and fuzzing, lag compensation, hit detection, visibility filtering, drones, every gadget, the siege interactions, the full round state machine, and an **integration test** where two scripted bots play a full match over a real websocket server.

## Manual checklist

Run through this on each target. Use `?debug` for the stats overlay.

Targets: desktop Chrome, Android Chrome, iPhone Safari in the browser, iPhone Safari as an installed Home Screen app, and one run with `?lag=150&jitter=30&loss=5`.

### Movement and map (Practice)
- [ ] Spawns: in a solo or online match attackers start spread out inside their spawn area, defenders are apart and look into the room (not at a wall)
- [ ] Spawn outside, walk to the house, open a door with E, walk through every room on both floors
- [ ] No wall clipping, stairs climb and descend smoothly, crouch fits under low gaps
- [ ] Break a window (shoot it), tap F next to it to vault through
- [ ] Shoot a plaster wall: cells wear down and vanish; shoot concrete: nothing happens
- [ ] Barricade a door or window (hold E), then shoot it: single planks break exactly where the bullets land and you can see (and shoot) through the hole. Kick it: a hand sized hole opens. Walk through only when a body sized gap is open; a window can be vaulted once every plank and pane is gone
- [ ] Press N on a marked panel (red/brown R wall): it turns to metal and ignores bullets; B blasts it anyway
- [ ] Shoot a floor hatch from below and from above, drop through it

### Solo match vs bots
- [ ] Menu: SOLO MATCH, choose side, team size and difficulty, START MATCH. Bots pick operators, prep starts, bots reinforce walls and barricade doors (defenders)
- [ ] As attacker: bots on your team push toward the objective, kick barricades, go upstairs; enemy bots react to noise, do not see you through walls
- [ ] Easy bots are slow to react and miss a lot, hard bots are sharp but beatable; nothing hangs for a whole round
- [ ] The match finishes (first to 3), you land back in the lobby and START MATCH plays again

### Bomb mode
- [ ] Host sets Mode to Bomb (or SOLO MATCH, MODE: BOMB). Attackers get the glowing zone marker, nothing happens when they just stand in it
- [ ] Hold the interact key in the zone: a bar fills for 4 s, then "Defuser planted", the clock turns red and becomes a 45 s fuse, a case with a blinking light sits on the floor and beeps faster and faster
- [ ] Defenders next to it hold interact for 7 s: "Defuser disabled", defenders win. Too far away (more than 2 m) nothing happens
- [ ] Let the fuse run out: blast, damage to anyone close, attackers win ("Defuser detonated"), even if every attacker is dead
- [ ] Every attacker dead before the plant: defenders win. Time runs out before the plant: defenders win
- [ ] Bots plant when nobody is shooting at them and rush to disable it after the plant

### Secondary gadgets
- [ ] Operator select shows SECONDARY GADGET chips (attack: frag, flashbang, smoke; defend: impact, barbed wire, alarm), the HUD shows its name and count
- [ ] T (NADE on phones) throws: arc, bounces on floors and walls, frag goes off after about 2.5 s and hurts you too if you stay close, a wall between you and the blast protects you
- [ ] Flashbang: white screen and muffled ringing, shorter when you look away; enemy bots lose sight of you while flashed
- [ ] Smoke: a grey cloud grows to about 3 m, blocks sight (yours and bots') for 14 s, bullets still pass
- [ ] Impact grenade explodes on first contact: tears a hole in plaster, breaks barricade planks and doors, hurts people nearby
- [ ] Barbed wire: slows and nicks only the other team. Proximity alarm: the first attacker near it is marked for the defenders for 3 s, then it is used up

### Team markers
- [ ] Middle click (or Y, or the PING button on a phone) puts a diamond on what you look at for you and your teammates only: blue on a wall or floor, red when you hit an enemy. It shows the distance, sticks to the screen border when out of view and fades after 7 s. Works from the drone camera too

### Combat
- [ ] Recoil: hold fire with the Carbine, the view climbs, pulling the mouse down keeps shots on target, releasing settles it. Crosshair widens during a spray and closes when you stop.
- [ ] ADS speed: SMG snaps up, Marksman and Anvil take noticeably longer. Reload cancels aiming.
- [ ] Reload: with rounds left it ends on 30+1 and is quicker than an empty reload. Shotgun loads shell by shell and firing interrupts it.
- [ ] Talon fires exactly 3 rounds per click. Whisper does not light up the compass of an enemy at range.
- [ ] Legs do less damage than the body, headshots with Marksman / Sidearm / Magnum kill in one hit.
- [ ] Lean with Q / E: view rolls and shifts, a peeking head is hittable around a corner, you cannot lean into a wall
- [ ] Phone: tap a LEAN button and the lean stays, tap it again to stop, tap the other side to switch
- [ ] A drop of two floors hurts a lot, a step down does not
- [ ] Targets die, kill feed shows, hit marker and headshot sound differ
- [ ] Reload, swap weapons, ADS, kick a barricade
- [ ] Tracers, sparks and ejected shells appear, no stutter when firing a shotgun

### Online (two or more devices)
- [ ] Create a room on one device, join by code and by QR on others
- [ ] Teams, ready, host settings, start
- [ ] Operator select shows taken operators, timer runs out gracefully
- [ ] Prep: attackers cannot enter the house, drone works, defenders reinforce and barricade
- [ ] Drone: drives on the floor, hops with Space (about knee high), cannot climb a one metre table, can hop up the stairs, a long fall damages it
- [ ] Action: objective capture, kills, spectating after death, round end screen, side swap, match end
- [ ] Late join spectates; leaving mid round ends the round if it was the last player on a team
- [ ] Kill the wifi for 10 seconds on one phone: the game reconnects with the same slot
- [ ] Movement feels instant at 150 ms simulated lag; no rubber banding on a steady connection
- [ ] A destroyed wall looks the same on every device, including for a player who joins late

### Gadgets
- [ ] Ram charge: place, detonate, reinforced wall opens
- [ ] Ping sensor shows red markers; a Jam jammer near Ping turns it off
- [ ] Mend darts heal a teammate; Aegis shield blocks bullets and can be vaulted
- [ ] Snare trap slows and hurts only attackers; Eye cameras tag attackers

### Gamepad (any standard controller)
- [ ] Connect, press a button, then sticks move and look, RT fires, LT aims, LB / RB lean, Y swaps, Start pauses

### Phone specifics
- [ ] Landscape layout comfortable on a 6 inch phone, no accidental browser gestures (pull to refresh, double tap zoom)
- [ ] Left handed layout and button size settings work
- [ ] Audio starts after the first tap, no glitches in Safari or Chrome
- [ ] Installs as a PWA; fullscreen on Android; Home Screen app on iPhone
- [ ] 60 fps on a mid range phone with Medium quality; Low looks fine at 30+ fps

### Performance budget
Draw calls under 150, triangles under 150k, JS frame time under 6 ms on a mid range phone, server tick under 2 ms with 10 players (see the `?debug` overlay).
