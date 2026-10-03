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
- [ ] Spawn outside, walk to the house, open a door with E, walk through every room on both floors
- [ ] No wall clipping, stairs climb and descend smoothly, crouch fits under low gaps
- [ ] Break a window (shoot it), tap E next to it to vault through
- [ ] Shoot a plaster wall: cells wear down and vanish; shoot concrete: nothing happens
- [ ] Press N on a marked panel (red/brown R wall): it turns to metal and ignores bullets; B blasts it anyway
- [ ] Shoot a floor hatch from below and from above, drop through it

### Combat
- [ ] Targets die, kill feed shows, hit marker and headshot sound differ
- [ ] Reload, swap weapons, ADS, kick a barricade
- [ ] Recoil is subtle, tracers and sparks appear, no stutter when firing a shotgun

### Online (two or more devices)
- [ ] Create a room on one device, join by code and by QR on others
- [ ] Teams, ready, host settings, start
- [ ] Operator select shows taken operators, timer runs out gracefully
- [ ] Prep: attackers cannot enter the house, drone works, defenders reinforce and barricade
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

### Phone specifics
- [ ] Landscape layout comfortable on a 6 inch phone, no accidental browser gestures (pull to refresh, double tap zoom)
- [ ] Left handed layout and button size settings work
- [ ] Audio starts after the first tap, no glitches in Safari or Chrome
- [ ] Installs as a PWA; fullscreen on Android; Home Screen app on iPhone
- [ ] 60 fps on a mid range phone with Medium quality; Low looks fine at 30+ fps

### Performance budget
Draw calls under 150, triangles under 150k, JS frame time under 6 ms on a mid range phone, server tick under 2 ms with 10 players (see the `?debug` overlay).
