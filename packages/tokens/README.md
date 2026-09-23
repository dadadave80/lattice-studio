# @lattice-studio/tokens

Design tokens for Lattice Studio: CSS variables, typed TypeScript constants
and Shiki themes, generated from `design/tokens.json` reconciled with the
Final composer's Shop and Draft themes
(`design/prototype/composer-theme-tokens.css`), per decision D3
(HANDOFF.md §11).

Do not edit `dist/**` by hand. Run `bun run --cwd packages/tokens build`
after changing anything under `src/`, or `bun run tokens:pull` after
`design/tokens.json` changes upstream.

## Flipping D3

Decision D3 is `D3_ACCENT_BY_THEME` in `src/brand.ts`: which brand color
(`signal` or `blueprint`) leads each theme. It is the only thing that
needs to change to flip it:

```ts
export const D3_ACCENT_BY_THEME: Record<ThemeId, BrandId> = {
  shop: "signal",
  draft: "blueprint",
};
```

(the current default, matching the Final composer)

## Role table

| DS role (`tokens.css`) | Final composer variable | Shop value | Draft value |
| --- | --- | --- | --- |
| `--lx-ground` | `--field` | `#0C0D0F` | `#F3F1E9` |
| `--lx-ground-well` | `--sunken` | `#0A0B0D` | `#E7E3D8` |
| `--lx-panel` | `--panel` | `#131417` | `#F7F5EF` |
| `--lx-raised` | `--raised` | `#181A1E` | `#FBFAF5` |
| `--lx-sunken` | `--sunken (composer draws one recessed surface; ground-well and sunken share it)` | `#0A0B0D` | `#E7E3D8` |
| `--lx-text` | `--ink` | `#E9E7E1` | `#16150F` |
| `--lx-text-muted` | `--ink-2` | `#9A9DA4` | `#3C3931` |
| `--lx-text-faint` | `--ink-3 (Shop nudged toward --ink-2 for AA)` | `#80848B` | `#635E52` |
| `--lx-border` | `--strong` | `#6B6F77` | `#3C3931` |
| `--lx-border-subtle` | `--hair` | `rgba(233,231,225,.12)` | `rgba(22,21,15,.22)` |
| `--lx-border-strong` | `--ink (reused; composer has no fourth border tier)` | `#E9E7E1` | `#16150F` |
| `--lx-border-focus` | `--accent` | `#FF5A1F` | `#1F4FE0` |
| `--lx-accent` | `--accent` | `#FF5A1F` | `#1F4FE0` |
| `--lx-accent-strong` | `--accent-strong` | `#FF7A45` | `#173FBE` |
| `--lx-on-accent` | `--on-accent` | `#0C0D0F` | `#F7F5EF` |
| `--lx-accent-soft` | `--accent-soft` | `rgba(255,90,31,.12)` | `rgba(31,79,224,.10)` |
| `--lx-accent-line` | `--accent-line` | `rgba(255,90,31,.45)` | `rgba(31,79,224,.40)` |
| `--lx-dot` | `--dot` | `rgba(233,231,225,.06)` | `rgba(22,21,15,.10)` |
| `--lx-hatch` | `derived from --accent-soft` | `repeating-linear-gradient(45deg, var(--lx-accent-soft) 0 5px, transparent 5px 10px)` | `repeating-linear-gradient(45deg, var(--lx-accent-soft) 0 5px, transparent 5px 10px)` |

`border-subtle` is exempt from the 4.5:1 / 3:1 contrast floor: it is
decorative only (dividers, card edges), never the sole edge of a control,
per `design/design-system-rules.md` and the spec's color rule
(L768-L787).

`themeColors.*.hatch` (in `dist/tokens.ts`) is a CSS `background-image`
value that references `var(--lx-accent-soft)`; it only resolves inside
`tokens.css`, not as a plain color in TypeScript.

### Porting composer CSS

The Final composer (`design/prototype/Composer-Final.dc.html`) uses a few
variables this package doesn't expose as roles. When porting its CSS:

| Composer var | Use instead |
| --- | --- |
| `--rule` | `--lx-border-subtle` for a structural divider, `--lx-border` for a control outline (never reaches 3:1 on its own) |
| `--ink-4` | `--lx-text-muted` (`design/design-system-rules.md` L25: `label` is always `text-muted`; `--ink-4` never reaches 4.5:1) |
| `--tone-2`, `--tone-3` | `--lx-raised` (composer already uses `raised` for hover) |
| `--grain` | none; the design system has no elevation beyond lines |

## Type, spacing, radius, stroke

Pulled straight from `design/tokens.json` (same in both themes): the type
scale as `--lx-font-*` / `--lx-tracking-*` pairs, spacing as `--lx-space-*`
on the 4px grid, `--lx-radius: 0px` (the system has no rounded corners) and
`--lx-stroke-hair` / `--lx-stroke-heavy`.

## Layout sizes

`dist/tokens.ts` also exports `layoutSizes`: the grid, snap, drag
threshold, nudge steps and card/row/note metrics core and the sheet share.
See `src/layout.ts` for where each value comes from.
