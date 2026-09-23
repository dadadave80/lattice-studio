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

| DS role | Final composer variable | Shop value | Draft value |
| --- | --- | --- | --- |
| ground | `--field` | `#0C0D0F` | `#F3F1E9` |
| groundWell | `--sunken` | `#0A0B0D` | `#E7E3D8` |
| panel | `--panel` | `#131417` | `#F7F5EF` |
| raised | `--raised` | `#181A1E` | `#FBFAF5` |
| sunken | `--tone-2` | `#1C1E22` | `#D2CDBF` |
| text | `--ink` | `#E9E7E1` | `#16150F` |
| textMuted | `--ink-2` | `#9A9DA4` | `#3C3931` |
| textFaint | `--ink-3 (Shop nudged toward --ink-2 for AA)` | `#80848b` | `#635E52` |
| border | `--strong` | `#6B6F77` | `#3C3931` |
| borderSubtle | `--hair` | `rgba(233,231,225,.12)` | `rgba(22,21,15,.22)` |
| borderStrong | `--ink (reused; composer has no fourth border tier)` | `#E9E7E1` | `#16150F` |
| borderFocus | `--accent` | `#FF5A1F` | `#1F4FE0` |
| accent | `--accent` | `#FF5A1F` | `#1F4FE0` |
| accentStrong | `--accent-strong` | `#FF7A45` | `#173FBE` |
| onAccent | `--on-accent` | `#0C0D0F` | `#F7F5EF` |
| accentSoft | `--accent-soft` | `rgba(255,90,31,.12)` | `rgba(31,79,224,.10)` |
| accentLine | `--accent-line` | `rgba(255,90,31,.45)` | `rgba(31,79,224,.40)` |
| dot | `--dot` | `rgba(233,231,225,.06)` | `rgba(22,21,15,.10)` |
| hatch | `derived from --accent-soft` | `repeating-linear-gradient(45deg, var(--lx-accent-soft) 0 5px, transparent 5px 10px)` | `repeating-linear-gradient(45deg, var(--lx-accent-soft) 0 5px, transparent 5px 10px)` |

`border-subtle` is exempt from the 4.5:1 / 3:1 contrast floor: it is
decorative only (dividers, card edges), never the sole edge of a control,
per `design/design-system-rules.md` and the spec's color rule
(L768-L787).

## Type, spacing, radius, stroke

Pulled straight from `design/tokens.json` (same in both themes): the type
scale as `--lx-font-*` / `--lx-tracking-*` pairs, spacing as `--lx-space-*`
on the 4px grid, `--lx-radius: 0px` (the system has no rounded corners) and
`--lx-stroke-hair` / `--lx-stroke-heavy`.

## Layout sizes

`dist/tokens.ts` also exports `layoutSizes`: the grid, snap, drag
threshold, nudge steps and card/row/note metrics core and the sheet share.
See `src/layout.ts` for where each value comes from.
