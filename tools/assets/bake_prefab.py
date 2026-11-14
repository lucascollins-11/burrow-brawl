#!/usr/bin/env python3
"""Bake a library model (glTF) into a voxel Prefab for the map generator.

The result is shared/src/terrain3d/prefabs/<id>.json in the Prefab format of
shared/src/terrain3d/prefab.ts: integer boxes only, so the server just stamps it and server and
clients agree voxel for voxel. The JSON is committed; this tool runs offline, never at match time.

  bake_prefab.py MODEL.gltf --id ID --height VOXELS [--out DIR] [--shell 2] [--storey 11]
                 [--no-door] [--no-floors] [--avoid brick,...]

  tools/assets/bake_prefabs.sh rebakes every committed prefab with the settings it was made with.

What it does:
  1. Loads every mesh of the default scene with its node transforms, scales the model so it is
     HEIGHT voxels tall, and drops anything below the model's origin (that part is underground).
  2. Rasterises the surface into voxels, each with the colour of the model there (from the base
     colour texture when there is one, e.g. KayKit's gradient atlas).
  3. Fills the inside, then hollows it to a SHELL voxels thick skin, with a floor on the ground
     and one every STOREY voxels up (each with a hatch), so the inside is walkable.
  4. Opens a doorway, at least 5 wide and 8 tall, on the side where the model's door is (the
     side with the most dark wood at the bottom).
  5. Maps each colour to the nearest structure material (materials.ts), merges voxels into boxes,
     and adds one footing part under the footprint.

Standard library only (it reads PNG textures itself), like fetch.py.
"""
import argparse
import base64
import json
import math
import os
import struct
import sys
import zlib
from collections import deque

# Structure materials (shared/src/terrain3d/materials.ts) with the colour the client draws them
# (godot/terrain/terrain.gdshader). The baker picks the nearest one for each voxel.
MATERIALS = [
    (1, "plaster", (0.95, 0.89, 0.76)),
    (2, "timber", (0.42, 0.26, 0.16)),
    (3, "roof-tile", (0.84, 0.40, 0.26)),
    (4, "stone", (0.66, 0.66, 0.70)),
    (5, "brick", (0.72, 0.32, 0.24)),
    (6, "planks", (0.78, 0.60, 0.38)),
    (7, "paint-red", (0.88, 0.24, 0.22)),
    (8, "paint-white", (0.97, 0.96, 0.93)),
    (9, "glass", (0.62, 0.86, 0.96)),
    (10, "slate", (0.34, 0.39, 0.52)),
    (12, "metal", (0.30, 0.33, 0.38)),
    (13, "thatch", (0.88, 0.72, 0.38)),
    (14, "paint-blue", (0.33, 0.56, 0.86)),
    (15, "paint-yellow", (0.99, 0.81, 0.30)),
]
MAT_STONE = 4
MAT_TIMBER = 2
DOOR_W = 5
DOOR_H = 8

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEFAULT_OUT = os.path.join(ROOT, "shared", "src", "terrain3d", "prefabs")


# ---------------------------------------------------------------- PNG (8-bit RGB/RGBA, no interlace)

def read_png(path):
    with open(path, "rb") as f:
        data = f.read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{path}: not a PNG")
    pos = 8
    idat = b""
    w = h = depth = ctype = 0
    while pos < len(data):
        n, kind = struct.unpack(">I4s", data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + n]
        pos += 12 + n
        if kind == b"IHDR":
            w, h, depth, ctype, _c, _f, interlace = struct.unpack(">IIBBBBB", body)
            if depth != 8 or ctype not in (2, 6) or interlace:
                raise ValueError(f"{path}: only 8-bit RGB/RGBA non-interlaced PNGs are supported")
        elif kind == b"IDAT":
            idat += body
        elif kind == b"IEND":
            break
    bpp = 4 if ctype == 6 else 3
    raw = zlib.decompress(idat)
    stride = w * bpp
    out = bytearray(h * stride)
    prev = bytearray(stride)
    i = 0
    for y in range(h):
        ft = raw[i]
        i += 1
        line = bytearray(raw[i:i + stride])
        i += stride
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0
            b = prev[x]
            c = prev[x - bpp] if x >= bpp else 0
            if ft == 1:
                line[x] = (line[x] + a) & 255
            elif ft == 2:
                line[x] = (line[x] + b) & 255
            elif ft == 3:
                line[x] = (line[x] + ((a + b) >> 1)) & 255
            elif ft == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return w, h, bpp, bytes(out)


class Texture:
    def __init__(self, path):
        self.w, self.h, self.bpp, self.px = read_png(path)

    def sample(self, u, v):
        x = min(self.w - 1, max(0, int((u % 1.0) * self.w)))
        y = min(self.h - 1, max(0, int((v % 1.0) * self.h)))
        o = (y * self.w + x) * self.bpp
        return (self.px[o] / 255.0, self.px[o + 1] / 255.0, self.px[o + 2] / 255.0)


# ---------------------------------------------------------------- glTF

def mat_mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def node_matrix(n):
    if "matrix" in n:
        m = n["matrix"]
        return [[m[c * 4 + r] for c in range(4)] for r in range(4)]
    t = n.get("translation", [0, 0, 0])
    q = n.get("rotation", [0, 0, 0, 1])
    s = n.get("scale", [1, 1, 1])
    x, y, z, w = q
    r = [
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ]
    return [
        [r[0][0] * s[0], r[0][1] * s[1], r[0][2] * s[2], t[0]],
        [r[1][0] * s[0], r[1][1] * s[1], r[1][2] * s[2], t[1]],
        [r[2][0] * s[0], r[2][1] * s[1], r[2][2] * s[2], t[2]],
        [0, 0, 0, 1],
    ]


def apply(m, p):
    return (
        m[0][0] * p[0] + m[0][1] * p[1] + m[0][2] * p[2] + m[0][3],
        m[1][0] * p[0] + m[1][1] * p[1] + m[1][2] * p[2] + m[1][3],
        m[2][0] * p[0] + m[2][1] * p[1] + m[2][2] * p[2] + m[2][3],
    )


COMPONENTS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}
FORMATS = {5126: ("f", 4), 5125: ("I", 4), 5123: ("H", 2), 5121: ("B", 1)}


def load_triangles(path):
    """[(p0, p1, p2, colour0, colour1, colour2, uv0, uv1, uv2, texture or None)] in model units."""
    base = os.path.dirname(path)
    with open(path) as f:
        g = json.load(f)
    buffers = []
    for b in g.get("buffers", []):
        uri = b["uri"]
        if uri.startswith("data:"):
            buffers.append(base64.b64decode(uri.split(",", 1)[1]))
        else:
            with open(os.path.join(base, uri), "rb") as fh:
                buffers.append(fh.read())

    def accessor(i):
        a = g["accessors"][i]
        bv = g["bufferViews"][a["bufferView"]]
        fmt, size = FORMATS[a["componentType"]]
        comps = COMPONENTS[a["type"]]
        stride = bv.get("byteStride") or size * comps
        start = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        buf = buffers[bv["buffer"]]
        out = []
        for k in range(a["count"]):
            o = start + k * stride
            v = struct.unpack_from("<" + fmt * comps, buf, o)
            if a.get("normalized") and fmt != "f":
                v = tuple(x / float((1 << (8 * size)) - 1) for x in v)
            out.append(v if comps > 1 else v[0])
        return out

    textures = {}

    def material(mi):
        if mi is None:
            return (0.8, 0.8, 0.8), None
        m = g["materials"][mi].get("pbrMetallicRoughness", {})
        factor = tuple(m.get("baseColorFactor", [1, 1, 1, 1])[:3])
        tex = None
        if "baseColorTexture" in m:
            src = g["textures"][m["baseColorTexture"]["index"]]["source"]
            uri = g["images"][src].get("uri", "")
            if uri.lower().endswith(".png"):
                full = os.path.join(base, uri)
                if full not in textures:
                    textures[full] = Texture(full)
                tex = textures[full]
        return factor, tex

    tris = []

    def walk(ni, parent):
        n = g["nodes"][ni]
        m = mat_mul(parent, node_matrix(n))
        if "mesh" in n:
            for prim in g["meshes"][n["mesh"]]["primitives"]:
                if prim.get("mode", 4) != 4:
                    continue
                pos = [apply(m, p) for p in accessor(prim["attributes"]["POSITION"])]
                uv = accessor(prim["attributes"]["TEXCOORD_0"]) if "TEXCOORD_0" in prim["attributes"] else None
                idx = accessor(prim["indices"]) if "indices" in prim else list(range(len(pos)))
                factor, tex = material(prim.get("material"))
                for k in range(0, len(idx) - 2, 3):
                    a, b, c = idx[k], idx[k + 1], idx[k + 2]
                    uvs = (uv[a], uv[b], uv[c]) if uv else None
                    tris.append((pos[a], pos[b], pos[c], uvs, factor, tex))
        for ch in n.get("children", []):
            walk(ch, m)

    ident = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]
    scene = g["scenes"][g.get("scene", 0)]
    for ni in scene["nodes"]:
        walk(ni, ident)
    return tris


# ---------------------------------------------------------------- voxels

def nearest_material(c, avoid=()):
    best, bd = MATERIALS[0][0], 1e9
    for mid, name, ref in MATERIALS:
        if name in avoid:
            continue
        d = (c[0] - ref[0]) ** 2 * 0.3 + (c[1] - ref[1]) ** 2 * 0.59 + (c[2] - ref[2]) ** 2 * 0.11
        # Hue matters as much as brightness: also compare the colour normalised by its brightness.
        sc = max(1e-3, sum(c))
        sr = max(1e-3, sum(ref))
        d += sum((c[i] / sc - ref[i] / sr) ** 2 for i in range(3)) * 1.5
        if d < bd:
            best, bd = mid, d
    return best


def bake(path, pid, height, shell=2, storey=11, door=True, floors=True, avoid=()):
    tris = load_triangles(path)
    if not tris:
        sys.exit(f"{path}: no triangles")
    lo = [min(min(t[i][a] for i in range(3)) for t in tris) for a in range(3)]
    hi = [max(max(t[i][a] for i in range(3)) for t in tris) for a in range(3)]
    ground = max(lo[1], 0.0)  # anything under the model's origin is underground
    s = float(height) / (hi[1] - ground)
    pad = 1
    sx = int(math.ceil((hi[0] - lo[0]) * s)) + 1
    sz = int(math.ceil((hi[2] - lo[2]) * s)) + 1
    sy = int(height)
    # Grid with one voxel of padding on every side, for the outside flood fill.
    gx, gy, gz = sx + 2 * pad, sy + 2 * pad, sz + 2 * pad

    def vox(p):
        return (
            int(math.floor((p[0] - lo[0]) * s)) + pad,
            int(math.floor((p[1] - ground) * s)) + pad,
            int(math.floor((p[2] - lo[2]) * s)) + pad,
        )

    surface = {}  # (x, y, z) -> [r, g, b, n]
    for p0, p1, p2, uvs, factor, tex in tris:
        e1 = [p1[i] - p0[i] for i in range(3)]
        e2 = [p2[i] - p0[i] for i in range(3)]
        longest = max(math.dist(p0, p1), math.dist(p0, p2), math.dist(p1, p2)) * s
        steps = max(1, int(math.ceil(longest * 2.5)))
        for i in range(steps + 1):
            for j in range(steps + 1 - i):
                u, v = i / steps, j / steps
                p = [p0[k] + e1[k] * u + e2[k] * v for k in range(3)]
                if p[1] < ground:
                    continue
                key = vox(p)
                if not (pad <= key[1] < sy + pad):
                    continue
                if tex is not None and uvs is not None:
                    tu = uvs[0][0] + (uvs[1][0] - uvs[0][0]) * u + (uvs[2][0] - uvs[0][0]) * v
                    tv = uvs[0][1] + (uvs[1][1] - uvs[0][1]) * u + (uvs[2][1] - uvs[0][1]) * v
                    c = tex.sample(tu, tv)
                    c = (c[0] * factor[0], c[1] * factor[1], c[2] * factor[2])
                else:
                    c = factor
                acc = surface.setdefault(key, [0.0, 0.0, 0.0, 0])
                acc[0] += c[0]
                acc[1] += c[1]
                acc[2] += c[2]
                acc[3] += 1

    def idx(x, y, z):
        return (y * gz + z) * gx + x

    solid = bytearray(gx * gy * gz)
    for (x, y, z) in surface:
        solid[idx(x, y, z)] = 1
    # Outside air: flood from the padding. Everything else is inside the model.
    outside = bytearray(gx * gy * gz)
    dist = [0] * (gx * gy * gz)
    q = deque()
    for x in range(gx):
        for z in range(gz):
            for y in (0, gy - 1):
                i = idx(x, y, z)
                if not solid[i] and not outside[i]:
                    outside[i] = 1
                    q.append((x, y, z))
    for y in range(gy):
        for x in range(gx):
            for z in (0, gz - 1):
                i = idx(x, y, z)
                if not solid[i] and not outside[i]:
                    outside[i] = 1
                    q.append((x, y, z))
        for z in range(gz):
            for x in (0, gx - 1):
                i = idx(x, y, z)
                if not solid[i] and not outside[i]:
                    outside[i] = 1
                    q.append((x, y, z))
    nb = ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1))
    while q:
        x, y, z = q.popleft()
        for dx, dy, dz in nb:
            a, b, c = x + dx, y + dy, z + dz
            if 0 <= a < gx and 0 <= b < gy and 0 <= c < gz:
                i = idx(a, b, c)
                if not outside[i] and not solid[i]:
                    outside[i] = 1
                    q.append((a, b, c))
    # The ground under the model counts as closed: no flooding in from below the base.
    # Distance (in voxels, 6-neighbour) from the outside, for the shell.
    inside = [i for i in range(gx * gy * gz) if not outside[i]]
    for i in inside:
        dist[i] = 1 << 20
    q = deque()
    for x in range(gx):
        for y in range(gy):
            for z in range(gz):
                i = idx(x, y, z)
                if outside[i]:
                    continue
                for dx, dy, dz in nb:
                    a, b, c = x + dx, y + dy, z + dz
                    if dy == -1 and b == pad - 1:
                        continue  # the ground is not outside air
                    if 0 <= a < gx and 0 <= b < gy and 0 <= c < gz and outside[idx(a, b, c)]:
                        dist[i] = 1
                        q.append((x, y, z))
                        break
    while q:
        x, y, z = q.popleft()
        d = dist[idx(x, y, z)]
        for dx, dy, dz in nb:
            a, b, c = x + dx, y + dy, z + dz
            if 0 <= a < gx and 0 <= b < gy and 0 <= c < gz:
                i = idx(a, b, c)
                if not outside[i] and dist[i] > d + 1:
                    dist[i] = d + 1
                    q.append((a, b, c))

    # Colour of every solid voxel: its own surface colour, else the nearest surface voxel's.
    colour = {}
    for key, acc in surface.items():
        colour[key] = (acc[0] / acc[3], acc[1] / acc[3], acc[2] / acc[3])

    def colour_at(x, y, z):
        if (x, y, z) in colour:
            return colour[(x, y, z)]
        for r in range(1, 6):
            for dx in range(-r, r + 1):
                for dz in range(-r, r + 1):
                    for dy in (0, -1, 1):
                        k = (x + dx, y + dy, z + dz)
                        if k in colour:
                            return colour[k]
        return (0.66, 0.66, 0.70)

    # Final grid in local prefab coordinates: material id, 0 = air (interior), None = untouched.
    mats = {}
    air = set()
    for y in range(pad, sy + pad):
        for z in range(pad, sz + pad):
            for x in range(pad, sx + pad):
                i = idx(x, y, z)
                if outside[i]:
                    continue
                key = (x - pad, y - pad, z - pad)
                ly = y - pad
                is_floor = ly == 0 or (floors and storey > 0 and ly % storey == 0)
                if dist[i] > shell and not is_floor:
                    air.add(key)
                else:
                    mats[key] = nearest_material(colour_at(x, y, z), avoid)
    # Interior floors (every storey) get a hatch so you can climb through.
    if floors and storey > 0:
        for ly in range(storey, sy, storey):
            cells = [(x, z) for (x, yy, z) in mats if yy == ly and _interior_below(air, x, ly, z)]
            if not cells:
                continue
            hx = sorted(c[0] for c in cells)
            hz = sorted(c[1] for c in cells)
            cx, cz = hx[len(hx) // 4], hz[len(hz) // 4] if (ly // storey) % 2 else hz[3 * len(hz) // 4]
            for x in range(cx - 1, cx + 3):
                for z in range(cz - 1, cz + 3):
                    if (x, ly, z) in mats and _interior_below(air, x, ly, z):
                        del mats[(x, ly, z)]
                        air.add((x, ly, z))
    door_box = _door(mats, air, sx, sz) if door else None
    parts = []
    xs = [k[0] for k in mats]
    zs = [k[2] for k in mats]
    parts.append(_part("footing", MAT_STONE, min(xs), 0, min(zs), max(xs), 0, max(zs)))
    for mid in sorted(set(mats.values())):
        cells = {k for k, v in mats.items() if v == mid}
        for box in _boxes(cells):
            parts.append(_part("solid", mid, *box))
    for box in _boxes(air):
        parts.append(_part("air", 0, *box))
    return {
        "id": pid,
        "sx": sx,
        "sy": sy,
        "sz": sz,
        "parts": parts,
        "anchors": [],
        "source": os.path.relpath(path, ROOT).replace(os.sep, "/"),
        "door": door_box,
    }


def _interior_below(air, x, y, z):
    return (x, y - 1, z) in air and (x, y + 1, z) in air


def _door(mats, air, sx, sz):
    """Cut a doorway on the side where the model's door is: the side with the most dark wood
    (timber) on its outer face in the bottom DOOR_H voxels. Returns its box or None."""
    best = None
    sides = []
    for side in range(4):
        # Outer face voxels of this side at door height: the first solid voxel along the inward ray.
        dark = []
        span = sx if side in (0, 1) else sz
        for t in range(span):
            for y in range(1, DOOR_H + 1):
                depth_range = range(sz) if side == 0 else range(sz - 1, -1, -1) if side == 1 else range(sx) if side == 2 else range(sx - 1, -1, -1)
                for d in depth_range:
                    k = (t, y, d) if side in (0, 1) else (d, y, t)
                    if k in mats:
                        if mats[k] == MAT_TIMBER:
                            dark.append(t)
                        break
                    if k in air:
                        break
        sides.append((len(dark), side, dark, span))
    sides.sort(key=lambda s: (-s[0], s[1]))
    count, side, dark, span = sides[0]
    if span < DOOR_W + 2:
        return None
    centre = sorted(dark)[len(dark) // 2] if dark else span // 2
    t0 = max(1, min(span - DOOR_W - 1, centre - DOOR_W // 2))
    depth_range = list(range(sz)) if side == 0 else list(range(sz - 1, -1, -1)) if side == 1 else list(range(sx)) if side == 2 else list(range(sx - 1, -1, -1))
    cut = []
    # Carve inward until we reach the interior air (or 4 voxels past the first wall voxel).
    for t in range(t0, t0 + DOOR_W):
        walls = 0
        for d in depth_range:
            k0 = (t, 1, d) if side in (0, 1) else (d, 1, t)
            if k0 in air:
                break
            col = [((t, y, d) if side in (0, 1) else (d, y, t)) for y in range(1, DOOR_H + 1)]
            if any(k in mats for k in col):
                walls += 1
                for k in col:
                    if k in mats:
                        del mats[k]
                        air.add(k)
                        cut.append(k)
            elif walls:
                break
            if walls >= 4:
                break
    if not cut:
        return None
    xs = [k[0] for k in cut]
    zs = [k[2] for k in cut]
    return {"x0": min(xs), "y0": 1, "z0": min(zs), "x1": max(xs), "y1": DOOR_H, "z1": max(zs)}


def _boxes(cells):
    """Greedy merge of voxel cells into boxes: grow along x, then z, then y. Deterministic."""
    cells = set(cells)
    out = []
    for key in sorted(cells, key=lambda k: (k[1], k[2], k[0])):
        if key not in cells:
            continue
        x0, y0, z0 = key
        x1 = x0
        while (x1 + 1, y0, z0) in cells:
            x1 += 1
        z1 = z0
        while all((x, y0, z1 + 1) in cells for x in range(x0, x1 + 1)):
            z1 += 1
        y1 = y0
        while all((x, y1 + 1, z) in cells for x in range(x0, x1 + 1) for z in range(z0, z1 + 1)):
            y1 += 1
        for y in range(y0, y1 + 1):
            for z in range(z0, z1 + 1):
                for x in range(x0, x1 + 1):
                    cells.discard((x, y, z))
        out.append((x0, y0, z0, x1, y1, z1))
    return out


def _part(op, mat, x0, y0, z0, x1, y1, z1):
    return {"op": op, "mat": mat, "x0": x0, "y0": y0, "z0": z0, "x1": x1, "y1": y1, "z1": z1}


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("model")
    p.add_argument("--id", required=True)
    p.add_argument("--height", type=int, required=True, help="voxels tall (a Squirmling is 6, a storey 11)")
    p.add_argument("--out", default=DEFAULT_OUT)
    p.add_argument("--shell", type=int, default=2)
    p.add_argument("--storey", type=int, default=11)
    p.add_argument("--no-door", action="store_true")
    p.add_argument("--no-floors", action="store_true")
    p.add_argument("--avoid", default="", help="materials never to pick, comma separated (KayKit's red-brown wood "
                   "reads as brick otherwise: --avoid brick)")
    a = p.parse_args()
    avoid = tuple(x for x in a.avoid.split(",") if x)
    prefab = bake(a.model, a.id, a.height, a.shell, a.storey, not a.no_door, not a.no_floors, avoid)
    os.makedirs(a.out, exist_ok=True)
    out = os.path.join(a.out, a.id + ".json")
    with open(out, "w") as f:
        json.dump(prefab, f, separators=(",", ":"))
        f.write("\n")
    solid = sum(1 for q in prefab["parts"] if q["op"] == "solid")
    air = sum(1 for q in prefab["parts"] if q["op"] == "air")
    print(f"{out}: {prefab['sx']} x {prefab['sy']} x {prefab['sz']}, {solid} solid boxes, {air} air boxes, "
          f"door {'yes' if prefab['door'] else 'no'}, {os.path.getsize(out) // 1024} KB")


if __name__ == "__main__":
    main()
