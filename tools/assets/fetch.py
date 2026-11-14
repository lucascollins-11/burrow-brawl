#!/usr/bin/env python3
"""Third-party asset pipeline for Burrow Brawl.

Every outside asset is listed in godot/assets/thirdparty/manifest.json with its source, author,
license and page, and lives in godot/assets/thirdparty/<source>/<id>/. The big files go through
Git LFS (see .gitattributes). CREDITS.md at the repo root is generated from the manifest.

  fetch.py add-polyhaven ID [--res 1k]   add a Poly Haven model (CC0) and download it
  fetch.py add-zip --source S --id ID --url URL --license L --author A --page P [--subdir DIR]
                                          add any zip pack (CC0 or permissive only) and unpack it
  fetch.py sync                           download whatever is listed but missing, check hashes
  fetch.py credits                        rewrite CREDITS.md from the manifest
  fetch.py check                          fail if a file, hash, license or credit is missing

Standard library only, so it runs in CI and in any container.
"""
import argparse
import hashlib
import io
import json
import os
import sys
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TP = os.path.join(ROOT, "godot", "assets", "thirdparty")
MANIFEST = os.path.join(TP, "manifest.json")
CREDITS = os.path.join(ROOT, "CREDITS.md")
ALLOWED = {"CC0-1.0", "CC-BY-4.0", "MIT", "Unlicense", "OFL-1.1"}
UA = {"User-Agent": "burrow-brawl-asset-fetch/1.0"}


def load():
    if not os.path.exists(MANIFEST):
        return {"assets": []}
    with open(MANIFEST) as f:
        return json.load(f)


def save(m):
    m["assets"].sort(key=lambda a: (a["source"], a["id"]))
    with open(MANIFEST, "w") as f:
        json.dump(m, f, indent=2)
        f.write("\n")


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
        return r.read()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def folder(a):
    return os.path.join(TP, a["source"], a["id"])


def write_file(a, rel, data):
    path = os.path.join(folder(a), rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)


def replace(m, entry):
    m["assets"] = [a for a in m["assets"] if not (a["source"] == entry["source"] and a["id"] == entry["id"])]
    m["assets"].append(entry)


def add_polyhaven(args):
    info = json.loads(get(f"https://api.polyhaven.com/info/{args.id}"))
    files = json.loads(get(f"https://api.polyhaven.com/files/{args.id}"))
    g = files["gltf"][args.res]["gltf"]
    entry = {
        "source": "polyhaven", "id": args.id, "name": info["name"],
        "author": ", ".join(info["authors"].keys()), "license": "CC0-1.0",
        "page": f"https://polyhaven.com/a/{args.id}", "files": [],
    }
    wanted = [(f"{args.id}.gltf", g["url"])] + [(k, v["url"]) for k, v in g.get("include", {}).items()]
    for rel, url in wanted:
        data = get(url)
        write_file(entry, rel, data)
        entry["files"].append({"path": rel, "url": url, "sha256": sha(data)})
    m = load()
    replace(m, entry)
    save(m)
    print(f"added polyhaven/{args.id}: {len(entry['files'])} files")


def add_zip(args):
    if args.license not in ALLOWED:
        sys.exit(f"license {args.license} is not on the allowed list {sorted(ALLOWED)}")
    data = get(args.url)
    entry = {
        "source": args.source, "id": args.id, "name": args.name or args.id, "author": args.author,
        "license": args.license, "page": args.page, "zip": {"url": args.url, "sha256": sha(data), "subdir": args.subdir},
        "files": [],
    }
    _unzip(entry, data)
    m = load()
    replace(m, entry)
    save(m)
    print(f"added {args.source}/{args.id}: {len(entry['files'])} files")


def _unzip(entry, data):
    sub = (entry["zip"].get("subdir") or "").strip("/")
    entry["files"] = []
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for n in z.namelist():
            if n.endswith("/") or (sub and not n.startswith(sub + "/")):
                continue
            rel = n[len(sub) + 1:] if sub else n
            body = z.read(n)
            write_file(entry, rel, body)
            entry["files"].append({"path": rel, "sha256": sha(body)})


def sync(_args):
    m = load()
    for a in m["assets"]:
        missing = [f for f in a["files"] if not os.path.exists(os.path.join(folder(a), f["path"]))]
        if not missing:
            continue
        if "zip" in a:
            data = get(a["zip"]["url"])
            if sha(data) != a["zip"]["sha256"]:
                sys.exit(f"{a['source']}/{a['id']}: zip changed upstream")
            _unzip(a, data)
        else:
            for f in missing:
                write_file(a, f["path"], get(f["url"]))
        print(f"synced {a['source']}/{a['id']}")


def credits(_args):
    m = load()
    lines = [
        "# Credits",
        "",
        "Burrow Brawl's own art, code, names and maps are original. These third-party assets are used",
        "under the licenses below and restyled to the game's Storybook look. This file is generated by",
        "`tools/assets/fetch.py credits` from `godot/assets/thirdparty/manifest.json`.",
        "",
        "| Asset | Source | Author | License | Folder |",
        "| - | - | - | - | - |",
    ]
    for a in m["assets"]:
        lines.append(
            f"| [{a['name']}]({a['page']}) | {a['source']} | {a['author']} | {a['license']} | "
            f"`godot/assets/thirdparty/{a['source']}/{a['id']}/` |"
        )
    with open(CREDITS, "w") as f:
        f.write("\n".join(lines) + "\n")
    print(f"wrote CREDITS.md with {len(m['assets'])} assets")


def check(_args):
    m = load()
    bad = []
    text = open(CREDITS).read() if os.path.exists(CREDITS) else ""
    for a in m["assets"]:
        key = f"{a['source']}/{a['id']}"
        if a.get("license") not in ALLOWED:
            bad.append(f"{key}: license {a.get('license')} not allowed")
        if f"thirdparty/{key}/" not in text:
            bad.append(f"{key}: missing from CREDITS.md (run fetch.py credits)")
        for f in a["files"]:
            p = os.path.join(folder(a), f["path"])
            if not os.path.exists(p):
                bad.append(f"{key}: missing {f['path']} (run fetch.py sync, or git lfs pull)")
                continue
            with open(p, "rb") as fh:
                body = fh.read()
            if body.startswith(b"version https://git-lfs"):
                bad.append(f"{key}: {f['path']} is an LFS pointer (check out with LFS)")
            elif sha(body) != f["sha256"]:
                bad.append(f"{key}: {f['path']} does not match its hash")
    listed = {(a["source"], a["id"]) for a in m["assets"]}
    for src in sorted(os.listdir(TP)):
        d = os.path.join(TP, src)
        if os.path.isdir(d):
            for i in sorted(os.listdir(d)):
                if os.path.isdir(os.path.join(d, i)) and (src, i) not in listed:
                    bad.append(f"{src}/{i}: folder is not in the manifest")
    for b in bad:
        print("ASSET CHECK:", b)
    print(f"asset check: {len(m['assets'])} assets, {len(bad)} problems")
    sys.exit(1 if bad else 0)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    ph = sub.add_parser("add-polyhaven")
    ph.add_argument("id")
    ph.add_argument("--res", default="1k")
    ph.set_defaults(fn=add_polyhaven)
    z = sub.add_parser("add-zip")
    for k in ("source", "id", "url", "license", "author", "page"):
        z.add_argument("--" + k, required=True)
    z.add_argument("--name")
    z.add_argument("--subdir", default="")
    z.set_defaults(fn=add_zip)
    for name, fn in (("sync", sync), ("credits", credits), ("check", check)):
        sub.add_parser(name).set_defaults(fn=fn)
    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
