# Burrow Brawl 3D: full arsenal (v1, 2026-11-10)

This is a big arsenal that covers every gameplay role the genre expects. Every item is our
own: an original name, a toy-box look and a twist of its own. None of them is a one-for-one
copy of another game's signature weapon. No iconic animal bombs or holy items, and no named
weapons borrowed from existing games.

Weapons are data (`shared/weapons/*.json`) built on about 12 shared **behavior primitives**, so
adding one is mostly a data file plus a small script. Each weapon also gets a row in the online
determinism table (`weaponCases.ts`).

Primitives: `ballistic`, `bouncer` (fuse), `splitter` (cluster), `seeker` (homing),
`steerable` (player-driven), `walker`, `airstrike`, `hitscan`, `melee`, `placeable`
(mines/traps/blocks), `zone` (fire/glue/freeze areas), `status` (buffs/debuffs), `mover` (mobility).

| # | Name | Role | Twist |
|---|---|---|---|
| **Artillery** ||||
| 1 | Acorn Mortar | Charged artillery shell | The classic arc, wind affected |
| 2 | Pinecone Popper | Player-triggered cluster | Click mid-flight to burst it into 5 seeds |
| 3 | Fizz Rocket | Straight-line rocket | Flies flat for 1s, then gravity takes over |
| 4 | Paper Plane Seeker | Homing | Mark a target. It glides there, and wind still pushes it |
| 5 | Slingshot | Precise shot | No wind, small blast, great for finishing |
| **Grenades** ||||
| 6 | Fizz Grenade | Timed grenade | 1-5s fuse, bouncy |
| 7 | Gumball Cluster | Cluster grenade | Explodes into sticky gumballs that cling where they land |
| 8 | Snow Globe | Control grenade | No damage. It freezes critters in the radius for their next turn |
| 9 | Hot Sauce Flask | Fire | Leaves burning puddles that hurt anyone who stands in them for 3 turns |
| **Air strikes** ||||
| 10 | Beehive Strike | Air strike | 5 bombs in a line across your click point |
| 11 | Lantern Drift | Wind air strike | Paper lanterns float in on the wind and pop on contact |
| 12 | Toy Block Drop | Crusher | One giant block falls straight down and stays as terrain |
| **Walkers and steerables** ||||
| 13 | Wind-up Robot | Walking bomb | Marches forward, climbs small steps, explodes on click or after 8s |
| 14 | Marble Roller | Rolling bomb | Rolls downhill along the terrain, gaining speed |
| 15 | RC Racer | Steerable ground bomb | You drive it for 8s with WASD, then it detonates |
| 16 | Kite Bomber | Steerable flyer | You steer a kite for 6s. It's wind-assisted and drops one charge |
| **Guns** ||||
| 17 | Pepper Shotgun | Hitscan | 2 blasts per turn |
| 18 | Pea Gatling | Spray | A 3s stream of peas you sweep across targets |
| 19 | Water Pistol | Knockback beam | Low damage, pushes critters toward edges |
| **Melee** ||||
| 20 | Root Punch | Uppercut | Big vertical launch |
| 21 | Spatula Swat | Wide swing | Hits everyone in a frontal arc |
| 22 | Pillow Bash | Ring-out | No damage, huge sideways knockback |
| **Mines and traps** ||||
| 23 | Jelly Mine | Proximity mine | Arms after 2s |
| 24 | Mousetrap Snapper | Launch trap | Snaps any critter that steps on it high into the air |
| 25 | Glue Puddle | Movement trap | Critters inside can't walk or jump on their next turn |
| **Mobility** ||||
| 26 | Rope Claw | Grapple | Swing and release, with chaining in a later version |
| 27 | Spring Boots | Super jump | One giant leap |
| 28 | Umbrella Glide | Slow fall | Open it mid-air to drift down safely |
| 29 | Soda Jetpack | Flight | Fuel-limited fizzy thrust |
| 30 | Teleport Burrow | Teleport | Go anywhere open. Ends your turn |
| 31 | Drill Hat | Dig | Tunnel in the facing direction for 3s |
| **Utilities** ||||
| 32 | Build Block | Construction | Place a toy block as new terrain (bridges, walls) |
| 33 | Feather Charm | Low gravity | Your critter and its shots fall slower this turn |
| 34 | Bubble Shield | Defense | Absorbs the next hit on this critter |
| 35 | Cookie Snack | Heal | +25 HP to self or an adjacent teammate |
| 36 | Skip Turn / White Hanky | Pass / surrender | Pass, or concede the match |
| **Super weapons (crate-only)** ||||
| 37 | Boulder of Doom | Rolling super-bomb | Slow, huge, unstoppable |
| 38 | Marble Meteor Shower | Map-wide strike | 20 marbles rain over 4s |
| 39 | Party Piñata | Cluster super | Drops on a target and bursts into a ring of candy bombs |
| 40 | Tabletop Quake | Map event | Shakes everyone, knocks critters toward the water |

## Build order
- **Wave 1 (3D-M2/M3):** 1, 6, 17, 20, 23, 26, 27, 30, 36. These are the existing 2.5D set, ported to 3D.
- **Wave 2 (3D-M4a):** 2, 3, 4, 7, 9, 10, 13, 21, 28, 31, 32, 37, plus crates.
- **Wave 3 (3D-M4b):** everything else, plus balance passes from playtests.
