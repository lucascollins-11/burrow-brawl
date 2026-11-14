#!/usr/bin/env bash
# Rebake every library prefab in shared/src/terrain3d/prefabs/ (see bake_prefab.py). The JSON is
# committed, so only run this after changing the baker or adding a model here.
set -euo pipefail
cd "$(dirname "$0")/../.."
K=godot/assets/thirdparty/kaykit/medieval_hexagon/buildings
bake() { python3 -I tools/assets/bake_prefab.py "$@"; }
# KayKit is about 30 voxels per unit: a home is then 28 tall (two storeys and a roof).
bake $K/blue/building_windmill_blue.gltf --id kaykit-windmill --height 44 --avoid brick
bake $K/blue/building_church_blue.gltf --id kaykit-church --height 50 --avoid brick
bake $K/blue/building_tower_B_blue.gltf --id kaykit-tower --height 66 --avoid brick
bake $K/blue/building_watermill_blue.gltf --id kaykit-watermill --height 37 --avoid brick
bake $K/blue/building_tavern_blue.gltf --id kaykit-tavern --height 42 --avoid brick
bake $K/red/building_home_A_red.gltf --id kaykit-home-a --height 28 --avoid brick
bake $K/red/building_home_B_red.gltf --id kaykit-home-b --height 38 --avoid brick
