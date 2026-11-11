# godot/terrain

Voxel terrain for the Godot client (view protocol: `docs/view-protocol.md`). GDScript only.

- `voxel_codec.gd`: RLE pairs `[count-1, value]` + base64 decode (and encode, for tests).
- `voxel_store.gd`: the client's voxel grid. `load_full(match.start.terrain)`, `apply_patch(terrain.patch)`
  (returns the chunks to remesh: the box's chunks plus neighbours), `copy_chunk_padded(ci)` (34^3 block).
- `surface_mesher.gd`: pure, thread-safe surface nets over a padded block. Clockwise front faces.
- `terrain_view.gd`: `Node3D` that meshes chunks in `WorkerThreadPool`, swaps meshes in `_process`,
  drops stale results. `set_store(store)` once, then `apply_patch(msg)` for each `terrain.patch`.
- `terrain.gdshader` + `terrain_material.gd`: toy-clay triplanar material (grass tops, rock sides, sand).

Use:

```gdscript
var store := preload("res://terrain/voxel_store.gd").new()
store.load_full(match_start["terrain"])
$TerrainView.set_store(store)
# on terrain.patch:
$TerrainView.apply_patch(msg)
```

Tests (headless): `godot --headless --path godot --script res://tests/terrain_tests.gd`.
It prints `BENCH ...` lines with chunk meshing times in ms.
