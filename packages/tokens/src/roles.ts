// The role table: every `--lx-*` role, per theme, in one place. This is
// what the brief means by "the mapping in one table so flipping D3 is a
// one-line change" — the values themselves come from `brand.ts` (accent)
// and `neutrals.ts` (everything else); this module only assembles them and
// adds the two roles that combine both (`border-focus`, `hatch`).

import { accentPackageForTheme, type ThemeId } from "./brand.ts";
import { neutralPaletteForTheme } from "./neutrals.ts";

export type { ThemeId } from "./brand.ts";

export interface ThemeRoles {
  readonly ground: string;
  readonly groundWell: string;
  readonly panel: string;
  readonly raised: string;
  readonly sunken: string;
  readonly text: string;
  readonly textMuted: string;
  readonly textFaint: string;
  readonly border: string;
  readonly borderSubtle: string;
  readonly borderStrong: string;
  readonly borderFocus: string;
  readonly accent: string;
  readonly accentStrong: string;
  readonly onAccent: string;
  readonly accentSoft: string;
  readonly accentLine: string;
  readonly dot: string;
  /** A 45deg repeating stripe of `accent-soft`, for hatched collisions (spec: "collisions are hatched and labelled"). */
  readonly hatch: string;
}

export const THEMES: readonly ThemeId[] = ["dark", "light"];

export function themeRoles(theme: ThemeId): ThemeRoles {
  const neutrals = neutralPaletteForTheme(theme);
  const accentPkg = accentPackageForTheme(theme);
  return {
    ground: neutrals.ground,
    groundWell: neutrals.groundWell,
    panel: neutrals.panel,
    raised: neutrals.raised,
    sunken: neutrals.sunken,
    text: neutrals.text,
    textMuted: neutrals.textMuted,
    textFaint: neutrals.textFaint,
    border: neutrals.border,
    borderSubtle: neutrals.borderSubtle,
    borderStrong: neutrals.borderStrong,
    borderFocus: accentPkg.accent,
    accent: accentPkg.accent,
    accentStrong: accentPkg.accentStrong,
    onAccent: accentPkg.onAccent,
    accentSoft: accentPkg.accentSoft,
    accentLine: accentPkg.accentLine,
    dot: neutrals.dot,
    hatch: "repeating-linear-gradient(45deg, var(--lx-accent-soft) 0 5px, transparent 5px 10px)",
  };
}
