#!/usr/bin/env bash
# Rebuilds every generated asset: textures -> Blender map -> ghost characters -> optimised GLBs.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 blender/make_textures.py
python3 blender/build_library.py
[ -f blender/build_characters.py ] && python3 blender/build_characters.py
npx gltf-transform optimize blender/out/library_raw.glb public/assets/library.glb \
  --compress meshopt --texture-compress webp --texture-size 2048 \
  --simplify false --join false --flatten false --instance false --palette false
ls -la public/assets
