/**
 * Types that mirror weapons/weapon.schema.json (shared/weapons/).
 * Keep these in sync with the schema when either changes.
 */

export const WEAPON_CATEGORIES = [
  "projectile",
  "hitscan",
  "melee",
  "utility",
  "placed",
  "strike",
  "super",
  "pass",
] as const;
export type WeaponCategory = (typeof WEAPON_CATEGORIES)[number];

export const WEAPON_TARGETING = [
  "none",
  "aim-angle",
  "aim-power",
  "aim-angle-power",
  "click-point",
  "placement",
] as const;
export type WeaponTargeting = (typeof WEAPON_TARGETING)[number];

export interface WeaponData {
  /** Stable kebab-case id, also the filename without .json. */
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: WeaponCategory;
  /** Id of the behavior script that runs this weapon. */
  readonly behavior: string;
  readonly targeting: WeaponTargeting;
  /** Uses per match per team. null means unlimited. */
  readonly ammo: number | null;
  /** Only obtainable from supply crates. */
  readonly crateOnly: boolean;
  /** The turn ends after the weapon resolves. */
  readonly endsTurn: boolean;
  /** The projectile is pushed by wind. */
  readonly windAffected: boolean;
  /** Damage at the blast centre or per hit, before falloff (0 to 100). */
  readonly damage: number;
  /** Splash radius in cells. 0 means no area effect. */
  readonly blastRadius: number;
  /** Knockback impulse at the blast centre. */
  readonly knockback: number;
  /** Behavior-specific tuning, defined by the behavior script. */
  readonly params: Readonly<Record<string, unknown>>;
}
