# The Hollow Archive

A first-person horror game set in a moonlit gothic library. The map is built procedurally in **Blender** (Python / `bpy`), exported to glTF and played in the browser with three.js.

## Play

```bash
npm install
npm run dev      # http://localhost:5173
```

| Key | Action |
| --- | --- |
| W A S D / mouse | move / look |
| Shift | run (drains stamina, very loud) |
| C / Ctrl | crouch (quiet, harder to see) |
| F | torch on / off (battery drains — find spares) |
| E / click | take, read, hide in a cabinet, unlock the doors |
| V | switch first-person / third-person camera |
| Q | ghost radar on / off |
| R | hand radio on / off |
| Esc | pause |

**Goal:** read the ledger, find the three keys (their places change every run), unlock the great doors at the south end and get out.

**The dead**

- **The Archivist** walks. He wakes when you lift the first key, hunts by sight and sound, and opens cabinets he saw you enter.
- **The Wraith** flies above the shelves and through them. It is drawn to torchlight: go dark and it loses you.
- **The Crawler** scuttles on all fours under the tables. Nearly blind, but it hears everything.
- **The Weeping Sister** is in the hall from the first second. She glides slowly and sees badly; you can hear her crying (and sometimes singing) long before you see her. When the crying stops, run.
- **The Bone Man**, a walking skeleton, also patrols from the start. You hear his bones rattle as he moves.
- **The Hanged** is not a hunter: now and then a body drops out of the dark on a rope right in front of you.

Jumpscares come at irregular intervals from the start of a run, whether or not you have found a key. The hall is also full of voices: sobbing, distant shouts, screams, a child's laugh, a bell, scratching and dragging. All sound is synthesised in the browser.

## Assets and licences

The player body (`human_m.glb`), the Sister (`human_f.glb`) and the clips in `public/assets/anim/` come from the [Ready Player Me animation library](https://github.com/readyplayerme/animation-library). Its licence allows the animations to be used only with Ready Player Me avatars and does not allow redistributing them without consent, so check it before publishing or reusing these files.
- **The Hollow** are apparitions: at the gallery rail, at the edge of your light, right behind you.

No ghost hunts forever: each one gives up after a few seconds, only one hunts at a time, and they rest between hunts.
**Look a ghost in the eyes** and hold its gaze: it slows, then freezes, then drifts away. Your nerve (the eye meter) runs out if you stare too long.

**Tools:** the radar sweeps for contacts (red walker, blue flyer, orange crawler, gold = nearest key). The radio plays a warped waltz; its static swells when something is close and it sometimes mutters where a key is — but the dead can hear it too.

Also in the dark: a thunderstorm with lightning through the great window, a bat colony, posters whose writing changes when you are not looking, and scares that escalate with every key.

## Trailer

Open the game with `?trailer` added to the address (for example `http://localhost:5173/?trailer`), or use the "Watch the trailer" link on the menu. It plays a 66-second cinematic rendered live by the game: scripted camera moves, every ghost, captions and the game's own sound.

- **Play the trailer** just plays it. Press Esc to stop.
- **Record the trailer** asks the browser to share this tab, plays the trailer, and downloads `the-hollow-archive-trailer.webm` when it ends. Use Chrome or Edge, pick "This tab", and go fullscreen (F11) first. Any screen recorder (OBS, Xbox Game Bar) works too.

The shot list is in `src/trailer.js`.

## Project layout

- `blender/` – map pipeline: `make_textures.py` (PBR texture sets), `kit.py` (modelling kit), `build_library.py` (builds the library, writes `library.blend`, the GLB and `level.json` with colliders, key spots, hiding places), `render_preview.py`.
- `public/assets/` – optimised game assets (`library.glb`, the two characters, `level.json`).
- `src/` – game: `main.js` (flow, HUD, scares, storm, radio, post-processing), `extras.js` (bats, posters, radar), `world.js` (lighting, candles, moon shafts, dust, doors, pickups), `player.js`, `ghost.js` (AI + spectral shading + animation retargeting), `nav.js` (grid A* and line of sight), `audio.js` (fully synthesised sound).

Rebuild the map with `npm run map` (needs `pip install bpy pillow numpy`).
