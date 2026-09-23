// Renders README.md's role table: DS role, Final composer variable, Shop
// value, Draft value — so the D3 mapping (brand.ts) and the neutral
// reconciliation (neutrals.ts) stay visible in one place, as the brief asks.

import { D3_ACCENT_BY_THEME } from "./brand.ts";
import { kebab } from "./render-css.ts";
import { themeRoles, type ThemeRoles } from "./roles.ts";

const COMPOSER_VAR: Record<keyof ThemeRoles, string> = {
  ground: "--field",
  groundWell: "--sunken",
  panel: "--panel",
  raised: "--raised",
  sunken: "--sunken (composer draws one recessed surface; ground-well and sunken share it)",
  text: "--ink",
  textMuted: "--ink-2",
  textFaint: "--ink-3 (Shop nudged toward --ink-2 for AA)",
  border: "--strong",
  borderSubtle: "--hair",
  borderStrong: "--ink (reused; composer has no fourth border tier)",
  borderFocus: "--accent",
  accent: "--accent",
  accentStrong: "--accent-strong",
  onAccent: "--on-accent",
  accentSoft: "--accent-soft",
  accentLine: "--accent-line",
  dot: "--dot",
  hatch: "derived from --accent-soft",
};

const ROLE_ORDER: readonly (keyof ThemeRoles)[] = [
  "ground",
  "groundWell",
  "panel",
  "raised",
  "sunken",
  "text",
  "textMuted",
  "textFaint",
  "border",
  "borderSubtle",
  "borderStrong",
  "borderFocus",
  "accent",
  "accentStrong",
  "onAccent",
  "accentSoft",
  "accentLine",
  "dot",
  "hatch",
];

function roleTable(): string {
  const shop = themeRoles("shop");
  const draft = themeRoles("draft");
  const rows = ROLE_ORDER.map(
    (role) => `| \`--lx-${kebab(role)}\` | \`${COMPOSER_VAR[role]}\` | \`${shop[role]}\` | \`${draft[role]}\` |`,
  );
  return `| DS role (\`tokens.css\`) | Final composer variable | Shop value | Draft value |
| --- | --- | --- | --- |
${rows.join("\n")}`;
}

export function renderReadme(): string {
  return `# @lattice-studio/tokens

Design tokens for Lattice Studio: CSS variables, typed TypeScript constants
and Shiki themes, generated from \`design/tokens.json\` reconciled with the
Final composer's Shop and Draft themes
(\`design/prototype/composer-theme-tokens.css\`), per decision D3
(HANDOFF.md §11).

Do not edit \`dist/**\` by hand. Run \`bun run --cwd packages/tokens build\`
after changing anything under \`src/\`, or \`bun run tokens:pull\` after
\`design/tokens.json\` changes upstream.

## Flipping D3

Decision D3 is \`D3_ACCENT_BY_THEME\` in \`src/brand.ts\`: which brand color
(\`signal\` or \`blueprint\`) leads each theme. It is the only thing that
needs to change to flip it:

\`\`\`ts
export const D3_ACCENT_BY_THEME: Record<ThemeId, BrandId> = {
  shop: "${D3_ACCENT_BY_THEME.shop}",
  draft: "${D3_ACCENT_BY_THEME.draft}",
};
\`\`\`

(the current default, matching the Final composer)

## Role table

${roleTable()}

\`border-subtle\` is exempt from the 4.5:1 / 3:1 contrast floor: it is
decorative only (dividers, card edges), never the sole edge of a control,
per \`design/design-system-rules.md\` and the spec's color rule
(L768-L787).

\`themeColors.*.hatch\` (in \`dist/tokens.ts\`) is a CSS \`background-image\`
value that references \`var(--lx-accent-soft)\`; it only resolves inside
\`tokens.css\`, not as a plain color in TypeScript.

### Porting composer CSS

The Final composer (\`design/prototype/Composer-Final.dc.html\`) uses a few
variables this package doesn't expose as roles. When porting its CSS:

| Composer var | Use instead |
| --- | --- |
| \`--rule\` | \`--lx-border-subtle\` for a structural divider, \`--lx-border\` for a control outline (never reaches 3:1 on its own) |
| \`--ink-4\` | \`--lx-text-muted\` (\`design/design-system-rules.md\` L25: \`label\` is always \`text-muted\`; \`--ink-4\` never reaches 4.5:1) |
| \`--tone-2\`, \`--tone-3\` | \`--lx-raised\` (composer already uses \`raised\` for hover) |
| \`--grain\` | none; the design system has no elevation beyond lines |

## Type, spacing, radius, stroke

Pulled straight from \`design/tokens.json\` (same in both themes): the type
scale as \`--lx-font-*\` / \`--lx-tracking-*\` pairs, spacing as \`--lx-space-*\`
on the 4px grid, \`--lx-radius: 0px\` (the system has no rounded corners) and
\`--lx-stroke-hair\` / \`--lx-stroke-heavy\`.

## Layout sizes

\`dist/tokens.ts\` also exports \`layoutSizes\`: the grid, snap, drag
threshold, nudge steps and card/row/note metrics core and the sheet share.
See \`src/layout.ts\` for where each value comes from.
`;
}
