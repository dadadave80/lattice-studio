// The accent side of the role table: which brand color leads each theme
// (decision D3), and the fill/text-safe values each brand needs on a dark
// or a light ground.
//
// Flip D3 by editing `D3_ACCENT_BY_THEME` alone; every consumer (CSS, the
// typed constants, the Shiki themes, the README table) is generated from it.

import { mix, withAlpha } from "./color-math.ts";

export type ThemeId = "shop" | "draft";
export type BrandId = "signal" | "blueprint";
export type GroundTone = "dark" | "light";

export interface AccentPackage {
  readonly accent: string;
  readonly accentStrong: string;
  readonly onAccent: string;
  readonly accentSoft: string;
  readonly accentLine: string;
}

interface Brand {
  readonly id: BrandId;
  readonly dark: AccentPackage;
  readonly light: AccentPackage;
}

// Brand-Signal, exact from `logomark-signal-1024.png` (design/tokens.json).
const SIGNAL_BASE = "#FF5A1F";
// Brand-Blueprint, exact from `logomark-blueprint-1024.png`.
const BLUEPRINT_BASE = "#1F4FE0";
const BRAND_INK = "#16150F";
const BRAND_OFFWHITE = "#E9E7E1";

// Hover/pressed shift: lighten toward white on a dark ground, darken toward
// black on a light ground. The magnitude matches the Final composer's own
// shop accent-strong (#FF5A1F -> #FF7A45) and draft accent-strong
// (#1F4FE0 -> #173FBE).
const STRONG_SHIFT = 0.18;

const SIGNAL: Brand = {
  id: "signal",
  // Signal on dark: exact from Composer-Final.dc.html's Shop theme (the
  // current D3 default). 5.8:1 as text on Ink per design/tokens.json.
  dark: {
    accent: SIGNAL_BASE,
    accentStrong: "#FF7A45",
    onAccent: "#0C0D0F",
    accentSoft: "rgba(255,90,31,.12)",
    accentLine: "rgba(255,90,31,.45)",
  },
  // Signal on light: raw Signal is 2.5:1 on Off-white (fails AA text), so
  // this uses design/tokens.json's `text-signal.light` (#AC3401, 5.2:1) and
  // derives the rest the same way the composer derives its own pairs. Not
  // drawn in the Final composer (D3 keeps Signal on the dark theme); flip
  // D3 to exercise it.
  light: {
    accent: "#AC3401",
    accentStrong: mix("#AC3401", "#000000", STRONG_SHIFT),
    onAccent: BRAND_OFFWHITE,
    accentSoft: withAlpha("#AC3401", 0.1),
    accentLine: withAlpha("#AC3401", 0.4),
  },
};

const BLUEPRINT: Brand = {
  id: "blueprint",
  // Blueprint on light: exact from Composer-Final.dc.html's Draft theme
  // (the current D3 default). 5.2:1 as text on Off-white.
  light: {
    accent: BLUEPRINT_BASE,
    accentStrong: "#173FBE",
    onAccent: "#F7F5EF",
    accentSoft: "rgba(31,79,224,.10)",
    accentLine: "rgba(31,79,224,.40)",
  },
  // Blueprint on dark: raw Blueprint is 2.8:1 on Ink (fails AA text), so
  // this uses design/tokens.json's `text-accent.dark` (#5A8BFE, 5.7:1).
  // Not drawn in the Final composer; flip D3 to exercise it.
  dark: {
    accent: "#5A8BFE",
    accentStrong: mix("#5A8BFE", "#FFFFFF", STRONG_SHIFT),
    onAccent: BRAND_INK,
    accentSoft: withAlpha("#5A8BFE", 0.12),
    accentLine: withAlpha("#5A8BFE", 0.45),
  },
};

const BRANDS: Record<BrandId, Brand> = { signal: SIGNAL, blueprint: BLUEPRINT };

const THEME_TONE: Record<ThemeId, GroundTone> = { shop: "dark", draft: "light" };

/**
 * Decision D3 (HANDOFF §11): which brand color leads each theme. Signal
 * leads Shop, Blueprint leads Draft. The design system's own README has
 * Blueprint lead everywhere and Signal only alert; the Final composer,
 * which David chose, gives each theme one accent instead. Edit this map to
 * flip D3 — everything downstream follows.
 */
export const D3_ACCENT_BY_THEME: Record<ThemeId, BrandId> = {
  shop: "signal",
  draft: "blueprint",
};

export function accentPackageForTheme(theme: ThemeId): AccentPackage {
  const brand = BRANDS[D3_ACCENT_BY_THEME[theme]];
  const tone = THEME_TONE[theme];
  return brand[tone];
}
