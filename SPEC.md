# Wumpus Torture Simulator: build contract

A Kick-the-Buddy-style physics sandbox. A 3D ragdoll Wumpus stands in a room, and the player
picks tools from a toolbar to hit, cut, stab and blow him up. The gore is stylized, not
photoreal: glossy toon-red blood, white toon bones, pink flesh caps on stumps. There is a gore
toggle (on by default). He never "dies" for good: a Reset button rebuilds him.

Stack: plain ES modules, three r169 through the jsdelivr importmap, and Rapier
(`@dimforge/rapier3d-compat` from jsdelivr, `await RAPIER.init()`). There is no build step and
there are no assets. Sound is WebAudio synthesis only. English only in code and UI.

## Files and ownership (only edit files you own)
| Owner | Files |
|---|---|
| MODEL | `src/wumpus.js`, `viewer.html`, `src/viewer.js`, `tools/shots.mjs` |
| ENGINE | `index.html`, `src/main.js`, `src/game.js`, `src/physics.js`, `src/ragdoll.js`, `src/events.js`, `src/audio.js`, `src/ui.js`, `src/room.js`, `src/tools/index.js`, `src/tools/hands.js`, `tools/play.mjs`, `server.mjs` |
| BLUNT | `src/tools/blunt.js`, `src/tools/explosive.js` |
| GORE | `src/gore.js`, `src/tools/nasty.js` (Acid, Squeeze, Saw) |
| SHARP | `src/tools/sharp.js` (Knife, Throwing knives, Cutter, Cleaver, Chainsaw) |

The model viewer moves from `index.html` to `viewer.html`. `index.html` is the game.

## Model API (MODEL)
Keep every existing joint and part name. Joints: root, pelvis, torso, neck, head, leaf,
hipL/R, legL/R, footL/R, shoulderL/R, armL/R, elbowL/R, handL/R, thumbL/R.

- `createWumpus()` also returns:
  - `anatomy`: `{ [segmentName]: { bones: Mesh[], flesh: Material } }`. Each segment gets
    toon-white bone meshes inside it: skull in the head, spine plus ribcage in the torso, pelvis
    bone, humerus/radius in the arms, femur in the legs, small hand and foot bones, all hidden by
    default. `showBones(segment, on)` toggles them.
  - `makeStump(jointName, side /* 'parent' | 'child' */)`: returns a Group with a flesh cap
    (pink-red disc with a darker rim), a white bone cross-section ring in the middle and an ink
    outline. It is sized to the limb at that joint and oriented along the joint axis. The caller
    parents it.
  - `organs`: cartoon organ meshes, hidden inside by default, each a standalone Group that can be
    detached and turned into a prop.
    - Torso: heart, two lungs, stomach, liver, kidneys, and intestines as `intestine: Group[]`,
      a chain of 10-14 sausage links.
    - Head: brain. Eyeballs are an optional extra.
    - Look: glossy toon pink and red with ink outlines, plump and squishy.
    - Each organ has `userData.squish(amount 0..1)`: a squash-and-stretch deform that animates
      back to normal.
  - `setMelt(segment, amount 0..1, dir?)`: an acid melt shader on that segment's skin (via
    onBeforeCompile on its materials).
    - Vertices droop and sag downward, and the surface bubbles and blotches toward a sickly
      green-brown with drip bulges.
    - Above about 0.6 the skin dissolves (alpha-tested noise) to reveal the flesh and the
      bones inside.
    - At 1 the skin is gone; the bones stay.
  - `setFace(name)`: alias of setExpression. Adds a `dead` expression (X eyes, tongue out).
  - `colors.blood = 0xd01830`.
- Segments are the rigid ragdoll bodies: `head` (includes neck, ears, leaf, snout), `torso`,
  `pelvis`, `armL/R` (upper arm), `foreL/R` (elbow group: forearm plus hand), `legL/R` (leg plus
  foot). Expose `segments: { name: Group }`, the joint Group whose subtree is that body, and the
  children list that must be excluded.

## Engine API (ENGINE)
`src/game.js` creates `game`. Tools receive it and use only these:
- `game.scene`, `game.camera`, `game.THREE`, `game.RAPIER`, `game.world` (Rapier world),
  `game.wumpus` (model), `game.ragdoll`.
- `game.ragdoll`:
  - `bodies[segment]` gives a Rapier RigidBody.
  - `segmentOf(collider)`.
  - `sever(joint)` removes the impulse joint for `neck | shoulderL/R | elbowL/R | hipL/R | waist`,
    emits `sever`, and returns `{ parentSeg, childSeg, worldPos }`.
  - `isSevered(joint)`.
  - `applyImpulse(seg, vec3, point?)` and `explode(center, radius, strength)`: radial impulse on
    all bodies plus props.
- `game.pick(ndcX, ndcY)`: `{ seg | null, prop | null, point, normal }` via Rapier raycast from
  the camera.
- `game.spawnProp({ mesh, shape: 'box'|'ball'|'capsule'|'cylinder', size, mass, position,
  velocity, onHit(e) })`: a dynamic body synced to the mesh. `game.removeProp(p)`.
- `game.addUpdate(fn(dt))` / `removeUpdate`.
- `game.events`: `on(name, fn)`, `emit(name, data)`. Events:
  - `damage { seg, point, normal, force /* 0..1+ */, kind: 'blunt'|'cut'|'stab'|'burn'|'blast'|'tickle' }`
  - `sever { joint, parentSeg, childSeg, point }`
  - `impact { seg, point, speed }`: body vs world or prop contacts, emitted by the engine.
  - `reset`, `toolchange { id }`.
- `game.audio`: `noise({dur, freq, q, gain})`, `tone({from, to, dur, type, gain})`,
  `play(name)` with built-ins `thud`, `slap`, `squeak`, `whimper`, `laugh`, `boing`, `pop`.
- `game.coins.add(n, at?)`: floating +N text; balance saved in localStorage (inside try/catch).
- `game.settings.gore` (bool).

## Gore API (GORE), `game.gore`, created in gore.js `init(game)`
Everything no-ops or goes cartoon-clean (stars and sweat, no blood) when `settings.gore` is off.
- `bleed(seg, point, normal, amount)`: a spray burst plus drips that fall, splat and pool on
  the floor.
- `wound(seg, point, normal, { kind: 'cut'|'stab'|'blunt'|'burn', size })`: a decal on the skin.
  Deep ones reveal bone and flesh beneath and keep dripping for a while.
- `spurt(stumpGroup)`: a pulsing arterial spray from a stump that fades over about 6 s.
- `openBelly(point)`: tears the torso open. Organs pop out as props with physics, and the
  intestines become a floppy rope of linked bodies still attached to the torso.
- `stick(mesh, seg, localPoint, localQuat)`: parent an object, such as a knife, to a body part.
- `organProps`: the list of live organ props. `squeeze(prop, amount)` squishes it, squirts, and
  can pop it at a threshold.
- gore.js listens to `sever` (attaches the stumps from `wumpus.makeStump` on both sides, then
  calls spurt) and to `damage` (decides bleed and wound from kind and force, and big blunt/blast
  splatter).

### Tool contract
Each tool file exports `default [ tool, ... ]`. A tool is:
`{ id, name, group: 'Hands'|'Blunt'|'Sharp'|'Boom'|'Nasty', icon /* emoji */, price, cursor?,
init?(game), select?(game), deselect?(game), down?(game, p), move?(game, p), up?(game, p),
update?(game, dt) }`, where `p = { ndc: {x,y}, hit /* game.pick result */, dragging }`.
`src/tools/index.js` imports hands, blunt, explosive, sharp and nasty, and tolerates a missing
module. It also calls `gore.init(game)` if src/gore.js exists.

Everything animates:
- Wumpus squashes and stretches on hits, twitches while he bleeds, and wobbles.
- Tools have wind-up and follow-through (a mallet swings, a knife thrusts, a saw goes back and
  forth, a chainsaw rattles).
- Organs jiggle, props bounce, and debris flies.

## Wumpus behaviour (ENGINE)
- The ragdoll is active from the start. A balance controller (torso/head upright torque plus a
  pelvis height spring) keeps him standing and wobbling while both legs are attached. It goes
  limp for about 1.5 s after a big hit, then recovers. When he has no legs he just lies there.
- Face reacts to `damage`: hurt or shock on hits, teary afterwards, dizzy after big hits,
  happy on tickle, dead when the head is severed. The signature beat: once calm for 2 s after
  damage he plays the teary face and holds a trembling thumbs-up (only if armL is intact).
- `damage` pays coins. HUD: toolbar grouped by group, locked tools show a price and are bought
  with coins, a coin counter, Reset, a Gore toggle, a Mute toggle.

## Debug hooks (ENGINE)
`window.TS = { game, tool(id), click(nx, ny), drag([[nx,ny],...]), advance(sec) /* fixed steps,
works while the pane is hidden */, shot(name) /* POST /__shot saves a PNG to shots/ */, reset(),
state() }`. The server adds `POST /__shot`. `tools/play.mjs` (playwright-core, see
tools/shots.mjs for the paths) runs scripted scenarios for each tool and saves PNGs.

## Engine as built (read this: it refines the API above)
- Run the game with `node server.mjs` at http://localhost:8811/. `node tools/play.mjs [--only=a,b]` runs the scenarios on port 8813 and saves `shots/play_*.png`. It fails on console errors. Add your own scenarios there, named after your tools; ENGINE owns the file, so append your scenario functions and nothing else.
- Tests must call `TS.pause(true)` before stepping with `TS.advance`. `TS.render()` and `TS.shot()` draw on demand. Also available: `TS.ndc(seg, offset)`, `TS.ndcAt(x, y, z)`, `TS.unlockAll()`, `TS.addCoins()`.
- `game.pick` results also carry `part` ('earL', 'leaf', 'head', ...), `collider` and `toi`. On a miss, `point` lies on the z=0 plane.
- `p` also has `down` and `time`. `move` fires on hover too, so check `p.down` / `p.dragging`.
- `applyImpulse` takes a physical impulse. Masses: head 1.5, torso 1, pelvis 0.9, legs 0.55, arms ~0.15.
- `explode(center, radius, strength)`: strength is the peak dv in m/s at the center, falling to 0 at radius. It also makes him limp for 1.6 s.
- `spawnProp`:
  - Sizes: box `[w,h,d]` full extents, ball `radius`, capsule/cylinder `[radius, totalLength]`. Omit size to fit the mesh bounds.
  - Options: `soft: true` (bouncy, squashes), `colliders: [{shape, size, offset, rotation}]` for compound props.
  - The prop has `.body`, `.root` and `.mesh`.
  - `onHit(e)` receives `{ prop, other: 'world'|'seg'|'prop', seg, otherProp, speed, point, normal }`.
- `impact` events carry `normal`, `other` and `prop`. World impacts faster than 4.6 m/s emit `damage` with `source:'impact'`.
- `reset` fires `beforereset`, then `reset`. Always re-read `game.wumpus` and `game.ragdoll`; both are rebuilt.
- Helpers:
  - `game.ragdoll.attachRope(bodiesOrProps, anchorBody, { anchorWorld?, contacts? })` returns `{ joints, remove() }`.
  - `game.ragdoll`: `twitch(seg, s)`, `limpFor(sec)`, `partCollider(seg, part)`, `jointGaps()`.
  - `game`: `addPhysicsUpdate(fn(h))` at 120 Hz, `planePoint(nx, ny, through)`, `ndcOf(point)`, `rayFrom`, `react(face, sec, prio)`, `shake(amp)`.
- Sounds: `game.audio.play` also knows coin, bonk, boom, splat, slice, whoosh, ouch, zap and ding. Build richer ones from `noise` and `tone`.
- Rapier caveat: never switch a body from kinematic to dynamic and then remove a body in the same step, because it panics. Use `setEnabled(false)` for bodies you want parked.
- Model extras: `wumpus.anatomy`, `showBones`, `makeStump(joint, side)` (already in the frame of `userData.frame`'s group), `clearStumps()`, `organs` (with `organs.intestine[]`), `userData.squish`, `setMelt(seg | 'all', amt)`, `setXray`, `segments`, and `anatomy.head.jaw` (coming soon).
