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
| Esc | pause |

**Goal:** read the Archivist's ledger, find the three keys hidden around the library (their places change every run), unlock the great doors at the south end and get out.
Taking the first key wakes **the Archivist**. He hunts by sight (your torch gives you away from far off) and by sound (running). Break line of sight and hide in a cabinet — but if he sees you climb in, he will open it.
The faceless **Hollow** appear at the gallery rail, at the edge of your light and across your path.

## Project layout

- `blender/` – map pipeline: `make_textures.py` (PBR texture sets), `kit.py` (modelling kit), `build_library.py` (builds the library, writes `library.blend`, the GLB and `level.json` with colliders, key spots, hiding places), `render_preview.py`.
- `public/assets/` – optimised game assets (`library.glb`, the two characters, `level.json`).
- `src/` – game: `main.js` (flow, HUD, scares, post-processing), `world.js` (lighting, candles, moon shafts, dust, doors, pickups), `player.js`, `ghost.js` (AI + spectral shading + animation retargeting), `nav.js` (grid A* and line of sight), `audio.js` (fully synthesised sound).

Rebuild the map with `npm run map` (needs `pip install bpy pillow numpy`).
