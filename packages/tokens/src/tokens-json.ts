// Parses the theme-independent parts of the vendored design/tokens.json:
// type scale, spacing, radius, stroke. Color comes from `brand.ts` and
// `neutrals.ts` instead, reconciled with the Final composer per D3.

export interface TypeStyle {
  readonly name: string;
  readonly family: "sans" | "mono";
  readonly fontSize: string;
  readonly lineHeight: string;
  readonly fontWeight: number;
  readonly letterSpacing: string;
}

export interface SpacingStep {
  readonly name: string;
  readonly value: string;
}

export interface TokensJson {
  readonly fontFamilies: { readonly sans: string; readonly mono: string };
  readonly typeStyles: readonly TypeStyle[];
  readonly spacing: readonly SpacingStep[];
  readonly radiusNone: string;
  readonly strokeHair: string;
  readonly strokeHeavy: string;
}

interface RawTypeGroup {
  readonly family: string;
  readonly styles: readonly {
    readonly name: string;
    readonly fontSize: string;
    readonly lineHeight: string;
    readonly fontWeight: number;
    readonly letterSpacing: string;
  }[];
}

interface RawTokensJson {
  readonly type: {
    readonly families: { readonly sans: string; readonly mono: string };
    readonly groups: readonly RawTypeGroup[];
  };
  readonly spacing: { readonly tokens: readonly { readonly name: string; readonly value: string }[] };
  readonly radius: { readonly tokens: readonly { readonly name: string; readonly value: string }[] };
  readonly stroke: { readonly tokens: readonly { readonly name: string; readonly value: string }[] };
}

function findStrokeValue(
  tokens: readonly { readonly name: string; readonly value: string }[],
  name: string,
): string {
  const found = tokens.find((t) => t.name === name);
  if (!found) throw new Error(`tokens.json: missing stroke token "${name}"`);
  return found.value;
}

export function parseTokensJson(text: string): TokensJson {
  const raw = JSON.parse(text) as RawTokensJson;

  const typeStyles: TypeStyle[] = [];
  for (const group of raw.type.groups) {
    if (group.family !== "sans" && group.family !== "mono") {
      throw new Error(`tokens.json: unexpected type family "${group.family}"`);
    }
    for (const style of group.styles) {
      typeStyles.push({
        name: style.name,
        family: group.family,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        fontWeight: style.fontWeight,
        letterSpacing: style.letterSpacing,
      });
    }
  }

  const radiusNone = raw.radius.tokens.find((t) => t.name === "radius-none")?.value;
  if (!radiusNone) throw new Error('tokens.json: missing radius token "radius-none"');

  return {
    fontFamilies: raw.type.families,
    typeStyles,
    spacing: raw.spacing.tokens.map((t) => ({ name: t.name, value: t.value })),
    radiusNone,
    strokeHair: findStrokeValue(raw.stroke.tokens, "stroke-hair"),
    strokeHeavy: findStrokeValue(raw.stroke.tokens, "stroke-heavy"),
  };
}
