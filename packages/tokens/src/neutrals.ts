// The neutral (non-accent) side of the role table: grounds, text and
// borders, reconciled from the Final composer's Shop and Draft variables
// (design/prototype/composer-theme-tokens.css) against the contrast floor
// in contracts.md / spec L768-L787 (4.5:1 text, 3:1 meaningful lines).
//
// Composer var -> role, and why:
//   field      -> ground        panel   -> panel        raised -> raised
//   sunken     -> ground-well   (code blocks, input wells: composer paints
//                                the search input and the cut-plan footer
//                                on `sunken`)
//   tone-2     -> sunken        (the role named "sunken": a recessed,
//                                pressed-looking surface for hover/selected
//                                controls, one step deeper than ground-well)
//   ink        -> text          ink-2   -> text-muted
//   ink-3      -> text-faint    (Draft's ink-3 already clears 4.5:1 on every
//                                ground; Shop's does not (3.46-3.91:1), so
//                                Shop's is nudged toward ink-2 - see
//                                `deriveShopTextFaint` - just far enough to
//                                clear 4.5:1 with margin)
//   hair       -> border-subtle (documented exempt: 1.3:1 Shop, 1.6:1
//                                Draft; decorative dividers only, per the
//                                brief and design/design-system-rules.md)
//   strong     -> border        (composer's own control-outline color;
//                                >=3:1 against every ground)
//   (none)     -> border-strong (design/tokens.json's own `border` role is
//                                full strength, {text}; composer has no
//                                fourth border tier, so this reuses `text`
//                                for edges that need more than `border`)
//   accent     -> border-focus  (design/design-system-rules.md: focus is
//                                `border-focus`, which is `text-accent`)
//   ink-4, tone-3, rule, grain: not exposed as roles. `rule` never reaches
//     3:1 (1.65-2.70:1 flattened) so it cannot serve `border`; `ink-4`
//     never reaches 4.5:1 (1.81-3.48:1) so it cannot serve a text role;
//     `grain` is a background texture the design system's "no elevation"
//     rule doesn't call for and the brief's role list omits; `tone-3` is
//     only ever used for the scrollbar thumb in the prototype.

import { contrastRatio, mix } from "./color-math.ts";
import type { ThemeId } from "./brand.ts";

export interface NeutralPalette {
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
  readonly dot: string;
}

interface ComposerNeutrals {
  readonly field: string;
  readonly panel: string;
  readonly raised: string;
  readonly sunken: string;
  readonly tone2: string;
  readonly ink: string;
  readonly ink2: string;
  readonly ink3: string;
  readonly hairAlpha: string; // rgba(), decorative only
  readonly strong: string;
  readonly dot: string; // rgba()
}

const SHOP: ComposerNeutrals = {
  field: "#0C0D0F",
  panel: "#131417",
  raised: "#181A1E",
  sunken: "#0A0B0D",
  tone2: "#1C1E22",
  ink: "#E9E7E1",
  ink2: "#9A9DA4",
  ink3: "#6B6F77",
  hairAlpha: "rgba(233,231,225,.12)",
  strong: "#6B6F77",
  dot: "rgba(233,231,225,.06)",
};

const DRAFT: ComposerNeutrals = {
  field: "#F3F1E9",
  panel: "#F7F5EF",
  raised: "#FBFAF5",
  sunken: "#E7E3D8",
  tone2: "#D2CDBF",
  ink: "#16150F",
  ink2: "#3C3931",
  ink3: "#635E52",
  hairAlpha: "rgba(22,21,15,.22)",
  strong: "#3C3931",
  dot: "rgba(22,21,15,.10)",
};

/**
 * Shop's `ink-3` is 3.46-3.91:1 on its own grounds and panel (below 4.5:1).
 * Nudges it toward `ink-2` — which clears 4.5:1 everywhere — by the smallest
 * amount that clears 4.5:1 against Shop's lightest ground (`raised`, the
 * worst case), plus a small margin.
 */
function deriveShopTextFaint(n: ComposerNeutrals): string {
  const candidate = mix(n.ink3, n.ink2, 0.45);
  const worstCase = Math.min(
    contrastRatio(candidate, n.field),
    contrastRatio(candidate, n.panel),
    contrastRatio(candidate, n.raised),
    contrastRatio(candidate, n.sunken),
  );
  if (worstCase < 4.5) {
    throw new Error(`Shop text-faint (${candidate}) only clears ${worstCase.toFixed(2)}:1`);
  }
  return candidate;
}

function fromComposer(n: ComposerNeutrals, textFaint: string): NeutralPalette {
  return {
    ground: n.field,
    groundWell: n.sunken,
    panel: n.panel,
    raised: n.raised,
    sunken: n.tone2,
    text: n.ink,
    textMuted: n.ink2,
    textFaint,
    border: n.strong,
    borderSubtle: n.hairAlpha,
    borderStrong: n.ink,
    dot: n.dot,
  };
}

const PALETTES: Record<ThemeId, NeutralPalette> = {
  shop: fromComposer(SHOP, deriveShopTextFaint(SHOP)),
  // Draft's own ink-3 already clears 4.5:1 everywhere (5.03-6.18:1).
  draft: fromComposer(DRAFT, DRAFT.ink3),
};

export function neutralPaletteForTheme(theme: ThemeId): NeutralPalette {
  return PALETTES[theme];
}
