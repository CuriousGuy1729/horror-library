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
| R | spirit box (hand radio) on / off — it crackles and speaks when something is near |
| T | EMF meter on / off — five lamps, 1 (nothing) to 5 (it is beside you) |
| M | microphone on / off — the house hears you (see below) |
| G | throw a book: the noise draws whatever is hunting to where it lands |
| Esc | pause |

**Goal:** read the ledger, find the three keys (their places change every run), unlock the great doors at the south end and get out.

**The dead**

- **The Archivist** walks. He wakes when you lift the first key, hunts by sight and sound, and opens cabinets he saw you enter.
- **The Wraith** flies above the shelves and through them. It is drawn to torchlight: go dark and it loses you.
- **The Crawler** scuttles on all fours under the tables. Nearly blind, but it hears everything.
- **The Weeping Sister** is in the hall from the first second. She glides slowly and sees badly; you can hear her crying (and sometimes singing) long before you see her. When the crying stops, run.
- **The Bone Man**, a walking skeleton, also patrols from the start. You hear his bones rattle as he moves.
- **The Lost Child** arrives after the first key. Small, pale, laughing among the shelves; she wanders more than she hunts.
- **The Shadow** comes late. A black silhouette with red eyes that only moves while you are *not* looking at it. Keep your light and your eyes on it and it stands still; hold the stare for a few seconds and it comes apart.
- **The Hanged** is not a hunter: now and then a body drops out of the dark on a rope right in front of you.

Jumpscares come at irregular intervals from the start of a run, whether or not you have found a key. The hall is also full of voices: sobbing, distant shouts, screams, a child's laugh, a bell, scratching and dragging. All sound is synthesised in the browser.

**Tools and talking to the dead**

- You carry an **EMF meter** in the left hand and a **spirit box** in the right (first person). The meter climbs and beeps faster as a ghost closes in.
- With the **microphone** on (the browser asks for permission; audio never leaves your machine), the game listens to how loud you are. Stay quiet and you are harder to find. Shout and the nearest ghost comes to look. Speak with the spirit box on, then pause, and something answers through the static.
- Stare a hunting ghost down at close range to stop it for a moment, throw books to lead it away, and light or pinch out candles with **E**.
- Ghosts give a short warning when they first glimpse you, then come for you. A chase lasts about 15 seconds unless you break line of sight or hide; afterwards you get roughly 10–20 seconds of breathing room. Walk into one and it attacks at once.

The layout adapts to the window: small windows, phones in landscape and very wide screens all get a scaled HUD and menu (the game still needs a keyboard and mouse).

**Performance.** The game watches its own frame rate: if it drops below about 45 fps it renders at a lower internal resolution, and as a last step turns off torch shadows. Ghost glows share two real lights, and all shaders are compiled while loading so nothing stutters the first time a ghost appears. If it is still heavy, choose *Low* quality in the menu.

## Assets and licences

- Recorded sounds (footsteps on creaking boards, whispers, screams, ambience, stingers) are CC0 recordings by Freesound authors, collected via `mayerwin/halloween-soundboard`. Every file and its author is listed in `public/assets/sfx/CREDITS.md`. Synthesised sound remains as a fallback.


The player body (`human_m.glb`), the Sister (`human_f.glb`) and the clips in `public/assets/anim/` come from the [Ready Player Me animation library](https://github.com/readyplayerme/animation-library). Its licence allows the animations to be used only with Ready Player Me avatars and does not allow redistributing them without consent, so check it before publishing or reusing these files.
- **The Hollow** are apparitions: at the gallery rail, at the edge of your light, right behind you.

No ghost hunts forever: each one gives up after a few seconds, only one hunts at a time, and they rest between hunts.
**Look a hunting ghost in the eyes** when it is close (within about 7 m) and hold its gaze: it slows, then freezes for a few seconds. It only works on a ghost that is already chasing you, the same ghost cannot be stopped again for 30 seconds, and your nerve (the eye meter) runs out if you stare too long.

**Tools:** the radar sweeps for contacts (red walker, blue flyer, orange crawler, gold = nearest key). The radio plays a warped waltz; its static swells when something is close and it sometimes mutters where a key is — but the dead can hear it too.

Also in the dark: a thunderstorm with lightning through the great window, a bat colony, posters whose writing changes when you are not looking, and scares that escalate with every key.

## Trailer

**Download the video:** [`media/the-hollow-archive-trailer.mp4`](media/the-hollow-archive-trailer.mp4) (66 s, 720p, rendered frame by frame from the game engine, with a soundtrack mixed from the game's CC0 recordings).

Open the game with `?trailer` added to the address (for example `http://localhost:5173/?trailer`), or use the "Watch the trailer" link on the menu. It plays a 66-second cinematic rendered live by the game: scripted camera moves, every ghost, captions and the game's own sound.

- **Play the trailer** just plays it. Press Esc to stop.
- **Record the trailer** asks the browser to share this tab, plays the trailer, and downloads `the-hollow-archive-trailer.webm` when it ends. Use Chrome or Edge, pick "This tab", and go fullscreen (F11) first. Any screen recorder (OBS, Xbox Game Bar) works too.

The shot list is in `src/trailer.js`.

## Project layout

- `blender/` – map pipeline: `make_textures.py` (PBR texture sets), `kit.py` (modelling kit), `build_library.py` (builds the library, writes `library.blend`, the GLB and `level.json` with colliders, key spots, hiding places), `render_preview.py`.
- `public/assets/` – optimised game assets (`library.glb`, the two characters, `level.json`).
- `src/` – game: `main.js` (flow, HUD, scares, storm, radio, post-processing), `extras.js` (bats, posters, radar), `world.js` (lighting, candles, moon shafts, dust, doors, pickups), `player.js`, `ghost.js` (AI + spectral shading + animation retargeting), `nav.js` (grid A* and line of sight), `audio.js` (fully synthesised sound).

Rebuild the map with `npm run map` (needs `pip install bpy pillow numpy`).
