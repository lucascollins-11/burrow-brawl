# Credits and asset sources

Burrow Brawl ships no third-party art, audio or fonts so far. Everything below is our own work.

## Audio (`godot/audio/`)

- **Sound effects** (fire, explosion in three sizes, bounce, jump, land, hurt, knockout, splash,
  turn start, timer tick, UI click, hover and confirm): generated in code at startup by
  `godot/audio/synth.gd` and `godot/audio/sfx_recipes.gd` from a few numbers per sound (oscillator
  shape, pitch slide, envelope, noise). The synth is a port of our own `client/src/audio/synth.ts`.
  No recordings and no samples from anywhere.
- **Music** (menu loop and match loop): original note tables in `godot/audio/music.gd`, rendered
  with the same synth. Nothing sampled or transcribed from another piece.

## Visuals

- Characters, terrain, effects and HUD are drawn from code and primitive meshes in `godot/`. The
  Squirmling concept sheet is our own placeholder art (`art/squirmlings-concept.png`).

When a real asset is added (a font, a texture, a recording), list it here with its author, source
URL, licence and the file that uses it, in the same PR.
