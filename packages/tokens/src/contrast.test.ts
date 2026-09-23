import { describe, expect, test } from "bun:test";
import { compositeOver, contrastRatio } from "./color-math.ts";
import { THEMES, themeRoles, type ThemeRoles } from "./roles.ts";

// The brief's "Done when" names exactly two backgrounds for the 4.5:1 text
// floor: "every text role on every ground and panel". `ground-well`,
// `raised` and `sunken` still get the softer 3:1 floor below (this
// package's role table adds them beyond design/tokens.json's own two
// documented backgrounds, and the Final composer never sets extended text
// on them — e.g. its `.seg-btn-on` puts `text`, not `accent`, on `sunken`).
const ALL_BACKGROUNDS: readonly (keyof ThemeRoles)[] = ["ground", "groundWell", "panel", "raised", "sunken"];
const AA_TEXT_BACKGROUNDS: readonly (keyof ThemeRoles)[] = ["ground", "panel"];
const TEXT_ROLES: readonly (keyof ThemeRoles)[] = ["text", "textMuted", "textFaint"];

function isRgba(value: string): boolean {
  return value.startsWith("rgba(");
}

function parseRgbaAlpha(value: string): number {
  const match = /rgba\([^,]+,[^,]+,[^,]+,([^)]+)\)/.exec(value);
  if (!match) throw new Error(`not an rgba(): ${value}`);
  return Number(match[1]);
}

function toHex(value: string): string {
  if (!value.startsWith("rgba(")) return value;
  const [r, g, b] = value
    .slice(5, -1)
    .split(",")
    .map((n) => Number(n.trim()));
  const hex = (n: number | undefined): string => (n ?? 0).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

describe("contrast · text roles vs ground and panel (>= 4.5:1)", () => {
  for (const theme of THEMES) {
    const roles = themeRoles(theme);
    for (const textRole of TEXT_ROLES) {
      for (const groundRole of AA_TEXT_BACKGROUNDS) {
        test(`${theme}: ${textRole} on ${groundRole}`, () => {
          const ratio = contrastRatio(roles[textRole], roles[groundRole]);
          expect(ratio).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
  }
});

describe("contrast · text roles vs every background (>= 3:1, the floor for a meaningful element)", () => {
  for (const theme of THEMES) {
    const roles = themeRoles(theme);
    for (const textRole of TEXT_ROLES) {
      for (const groundRole of ALL_BACKGROUNDS) {
        test(`${theme}: ${textRole} on ${groundRole}`, () => {
          expect(contrastRatio(roles[textRole], roles[groundRole])).toBeGreaterThanOrEqual(3);
        });
      }
    }
  }
});

describe("contrast · accent as text/border-focus (>= 4.5:1 on ground+panel, >= 3:1 as a line everywhere)", () => {
  for (const theme of THEMES) {
    const roles = themeRoles(theme);
    for (const groundRole of AA_TEXT_BACKGROUNDS) {
      test(`${theme}: accent on ${groundRole}`, () => {
        expect(contrastRatio(roles.accent, roles[groundRole])).toBeGreaterThanOrEqual(4.5);
      });
    }
    for (const groundRole of ALL_BACKGROUNDS) {
      test(`${theme}: border-focus on ${groundRole} (focus ring, >= 3:1)`, () => {
        expect(contrastRatio(roles.borderFocus, roles[groundRole])).toBeGreaterThanOrEqual(3);
      });
    }
  }
});

describe("contrast · meaningful lines vs every background (>= 3:1)", () => {
  const LINE_ROLES: readonly (keyof ThemeRoles)[] = ["border", "borderStrong"];
  for (const theme of THEMES) {
    const roles = themeRoles(theme);
    for (const lineRole of LINE_ROLES) {
      for (const groundRole of ALL_BACKGROUNDS) {
        test(`${theme}: ${lineRole} on ${groundRole}`, () => {
          const value = roles[lineRole];
          const flattened = isRgba(value) ? compositeOver(toHex(value), parseRgbaAlpha(value), roles[groundRole]) : value;
          const ratio = contrastRatio(flattened, roles[groundRole]);
          expect(ratio).toBeGreaterThanOrEqual(3);
        });
      }
    }
  }
});

describe("contrast · border-subtle is documented exempt, not asserted", () => {
  for (const theme of THEMES) {
    test(`${theme}: border-subtle exists as an rgba() (decorative only, no contrast floor)`, () => {
      const roles = themeRoles(theme);
      expect(roles.borderSubtle.startsWith("rgba(")).toBe(true);
    });
  }
});

describe("contrast · on-accent vs accent fill (>= 4.5:1)", () => {
  for (const theme of THEMES) {
    test(theme, () => {
      const roles = themeRoles(theme);
      expect(contrastRatio(roles.onAccent, roles.accent)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
