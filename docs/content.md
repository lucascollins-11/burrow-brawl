# Burrow Brawl 3D: modes, maps and characters (v1, 2026-11-10)

This is the full content scope for the genre, all our own designs. Nothing here is modeled
on a specific existing game's modes, maps or characters.

## Modes
| Mode | Players | What it is |
|---|---|---|
| **Brawl** | 2-8 | Standard last-team-standing match. All settings are customizable. |
| **Fort Wars** | 2-4 | A build phase first: each side gets 60s and a stack of Build Blocks to fortify its half. Then a classic brawl. A wall of soda splits the map until the build phase ends. |
| **Burrow Dash** | 1-8 | A race through checkpoints using only mobility tools (rope, jetpack, umbrella, springs). Fastest time wins. Ghost replays come later. |
| **Hot Potato** | 3-8 | A ticking bomb sits on one critter. Pass it by hitting another critter with any melee move. Whoever holds it at zero is out. |
| **Crate Rush** | 2-8 | Weapons only come from crates, which drop every turn. |
| **King of the Toybox** | 2-8 | Hold a glowing hill zone at the end of your turn to score. First to N points wins. |
| **Challenges** | 1 | Single-player puzzles and trick shots ("knock all 5 out with 3 shots", "reach the flag in 1 turn"), each with bronze, silver and gold. We ship 20 at launch. |
| **Training** | 1 | A sandbox with infinite ammo, target dummies and a wind slider. |

**Custom rules** apply to every mode: turn time, retreat time, starting HP, critters per team, a
wind range, crate frequency, the sudden death round and type (rising sea, 1 HP, or a hazard),
the weapon set (presets plus per-weapon ammo), fall damage on or off, hat perks on or off, and
the map seed or a fixed map. These are saved as named rule sets.

## Maps (themed 3D islands, our own)
Each theme comes with a hand-tuned set plus procedural variants from the map generator.
1. **Picnic Table**: checkered-cloth plateaus, sandwich towers, a spilled-juice lake
2. **Toy Chest**: stacked blocks, a train-track bridge, a jack-in-the-box tower
3. **Candy Mountain**: gumdrop hills, licorice ropes, a chocolate river (the sea)
4. **Junk Drawer**: battery cliffs, rubber-band bridges, paperclip scaffolds
5. **Bathtub Bay**: soap-bar islands, a sponge reef, a drain whirlpool hazard
6. **Garden Patch**: flowerpot towers, a watering-can fort, a pond
7. **Attic Storm**: dusty boxes, a rocking chair, lightning hazard events
8. **Snow Globe Village**: a frozen glass dome, a slippery-ice modifier

Maps come in sizes S/M/L/XL, which scale with team count (XL for 7-8 teams). Map hazards and
modifiers (ice, wind gusts, rising tide) are optional per match.

## Characters
- **Molekins**: our own round clay moles. They're customizable per team and per critter:
  - Hats: 30+ at launch (miner, chef, traffic cone, propeller, crown, flowerpot…)
  - Fur and skin colors, eyes, accessories (goggles, scarf, bandana), a gravestone style when knocked out
  - Team name, individual critter names (with a random silly-name generator), and a team flag
  - Voice packs: 8 original gibberish voice sets (Squeaky, Grumpy, Royal, Pirate-ish,
    Robot, Sleepy, Cheerful, Dramatic) with lines for hurt, victory, taunt, fall and idle,
    recorded or synthesized by us
  - Victory dances and idle animations
- **Profiles**: saved in the browser for guests. Optional cloud save comes later.
- **Unlocks**: challenge medals unlock hats, voices and maps.

## Build order (added to 3d-plan.md milestones)
- 3D-M3 (online): Brawl + custom rules, 2 maps (Picnic Table, Toy Chest), basic Molekin customization
- 3D-M4a: Fort Wars, Crate Rush, Training, 2 more maps, voice packs, 15 hats
- 3D-M4b: Burrow Dash, Hot Potato, King of the Toybox, 10 challenges, 4 more maps
- 3D-M5: the remaining challenges, unlocks, more hats and accessories, polish
