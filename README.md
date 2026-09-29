# Wumpus Torture Simulator

A Kick-the-Buddy-style physics sandbox in the browser. Wumpus is a 3D ragdoll standing in a
padded room, and you work through a toolbar of hands, blunt objects, blades, explosives and
chemicals. Hits pay coins, and coins unlock the tools. The gore is stylized cartoon and has an
on/off toggle; Reset rebuilds him.

A fan project. Wumpus is Discord's mascot, and this project is not affiliated with Discord.

## Run

```
node server.mjs
```

Then open http://localhost:8811/. The model viewer is at http://localhost:8811/viewer.html.
three.js r169 and Rapier 0.14 load from the jsdelivr CDN, so the page needs network access.

## Tools

| Group | Tools |
|---|---|
| Hands | Grab & throw, Slap, Poke, Tickle feather, Ear pull, Leaf pluck |
| Blunt | Mallet, Rubber chicken, Frying pan, Bowling ball, Boxing glove, Anvil, Piano |
| Sharp | Knife, Throwing knives, Cutter, Cleaver, Chainsaw |
| Boom | Bomb, Grenade, Landmine, Dynamite |
| Nasty | Acid, Squeeze, Saw |

## Code

- `src/wumpus.js`: the procedural model. It includes the rig, faces, bones, organs, stumps and
  the acid melt shader.
- `src/game.js`, `src/ragdoll.js`, `src/physics.js`, `src/room.js`, `src/ui.js`, `src/audio.js`:
  the engine.
- `src/gore.js`: blood, wounds, stumps, belly opening, organ props and squeeze.
- `src/tools/*.js`: one file per tool group.
- `SPEC.md`: the module contract.

## Tests

Each command drives headless Chromium through `tools/harness.mjs` and saves PNGs to `shots/`.
Each one fails on any console error.

```
node tools/play.mjs        # engine and hands
node tools/test_blunt.mjs  # blunt and boom
node tools/test_sharp.mjs  # blades
node tools/test_gore.mjs   # gore and nasty (about 8 min)
node tools/shots.mjs       # model contact sheet
```

`window.TS` has the debug hooks: `tool(id)`, `click`, `drag`, `advance(sec)`, `shot`, `reset`
and `state`.
