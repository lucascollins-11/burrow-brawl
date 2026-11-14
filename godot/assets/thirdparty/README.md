# Third-party assets

Library models, textures and sounds used by Burrow Brawl. Everything here is restyled to the
Storybook look before it reaches the screen, so it reads as part of our game.

## Rules

- **Licenses**: CC0 or clearly permissive only (CC0-1.0, CC-BY-4.0, MIT, Unlicense, OFL-1.1).
  `tools/assets/fetch.py` refuses anything else.
- **Layout**: one folder per source, one folder per asset: `thirdparty/<source>/<id>/`.
- **Manifest**: every asset is listed in `manifest.json` with its source, author, license, page,
  download URLs and SHA-256 of every file. `CREDITS.md` at the repo root is generated from it.
- **Git LFS**: models, textures and audio here are stored in LFS (see `.gitattributes`). Run
  `git lfs install` once; CI checks out with LFS.
- **Look**: never use a library material as is. Load models with
  `StorybookStyle.instance(path, opts)` (`godot/assets/storybook_style.gd`): toon-banded light,
  no photo detail maps, painted colours, and an optional `height` in world units (a Squirmling is 6).

## Adding assets

```
python3 tools/assets/fetch.py add-polyhaven Barrel_01 --res 1k
python3 tools/assets/fetch.py add-zip --source quaternius --id nature-pack --url <zip url> \
  --license CC0-1.0 --author Quaternius --page <page url> [--subdir <folder in the zip>]
python3 tools/assets/fetch.py credits    # rewrite CREDITS.md
python3 tools/assets/fetch.py check      # CI runs this: files, hashes, licenses, credits
```

Then open the project once (or run `godot --headless --path godot --import`) so Godot imports the
new files, and commit the generated `.import` files with them.

Sources that work from the cloud containers: Poly Haven (API), ambientCG, Quaternius, the Godot
Asset Library, and packs on GitHub (KayKit). kenney.nl blocks automated downloads, so Kenney packs
are not used.
