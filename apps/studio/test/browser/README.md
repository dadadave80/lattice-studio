# Visual baselines for the States boards (WP-Q3)

Every state drawn on the Claude Design States boards (`.handoff/design/boards/*.png`, 18 files) gets a browser
test and a screenshot baseline in both themes (shop, draft), with forced colors where the board draws lines
(traces, cables, ties, pins, the init-order path, the minimap). Baselines already built elsewhere in the app
(S4a's `FacetCard.screens.browser.test.tsx`) are referenced, not duplicated.

`provisional-*` tests and screenshots are for surfaces PA (`.handoff/spec/prototype-audit.md`) L72-L84 lists as
not designed yet, plus the surfaces the orchestrator listed as built without a board (the Start block, the
init-order legend and path, the title block's collapsed and strip forms, the Choose per selector dialog,
PaneSizeMenu, the copy fallback, NotBuiltDialog). They are a starting point for David's design pass, not a
claim that the pixel layout is final.

## Board coverage

| # | Board | State | Test | Notes |
| - | ----- | ----- | ---- | ----- |
| 1 | current-catalog-row | Draft/Shop two-line rows: rest, hover, selected, in cut, verified | `catalog-row.browser.test.tsx` | |
| 1 | current-catalog-row | "Recipe segment" (area groups, X/Y cut counts) | `structure-tab.browser.test.tsx` (provisional) | This is the Structure tab's tree (S5b), which PA L78 lists as not designed yet even though this board draws it; see Interpretations |
| 2 | current-selector-pin | Pin default/cut/excluded/collision, Draft square + Shop jack | covered by `src/sheet/card/FacetCard.screens.browser.test.tsx` (S4a) | The gallery's ERC20/ERC20Pausable/Axelar-Hyperlane cards show cut, excluded and conflicting pins in both themes; no new test |
| 3 | current-trace-and-cable | Trace (Draft), cable (Shop), conflict trace/cable | `trace-and-cable.browser.test.tsx` | + provisional forced-colors variant (PA L82) |
| 4 | current-selector-collision-callout | Callout, override typed, override accepted | dropped, no test | PA L59: "no override in this spec" |
| 5 | current-console | All resolved, collisions, running, deployed, Script tab, JSON tab | `console.browser.test.tsx` | |
| 6 | current-inspector | Facet, assembly (nothing selected), Shop facet, resolved+live assembly | `inspector.browser.test.tsx` | |
| 7 | current-deploy-surface | Sign & deploy / Hold to deploy | `deploy-surface.browser.test.tsx` | PA L13, L74: hold-to-deploy dropped; superseded by the real deploy review (Flow 12). Extra review phases (missing contracts, proposed, mismatch, failed, live) are `provisional-*` in the same file since PA L74 lists the review as not designed |
| 8 | current-title-block | Unresolved, predicted, live | `title-block.browser.test.tsx` | |
| 9 | current-command-palette | Filtered query, groups, active row | `command-palette.browser.test.tsx` | |
| 10 | current-init-order-mode | Dimmed sheet, dashed dependency path, order legend | `provisional-init-order-mode.browser.test.tsx` | Orchestrator: the legend and path were built without a board even though this board exists; see Interpretations |
| 11 | current-empty-sheet | Draft dot grid / Shop rack rails | `empty-sheet.browser.test.tsx` | |
| 12 | current-module-card | Pin strip, labelled pins, hover, conflict, selected, Shop faceplate/selected/conflict | covered by `src/sheet/card/FacetCard.screens.browser.test.tsx` (S4a) | No new test |
| 13 | former-facet-card | Collapsed/hover/selected/expanded 176x80 card, in the palette | superseded by current-module-card, no test | The 232 px card fully replaces this size and layout |
| 14 | former-edges-and-the-overlap-tie | Dependency edges, tie popover, overlap reconciled | superseded by current-trace-and-cable + `provisional-seam-pins.browser.test.tsx`'s SEM-01 note | The "Keep/Use" tie popover became the owner menu + collision note (contracts §6 owner-by-default ruling); no separate test |
| 15 | former-empty-sheet | Pinned strip, presets, tool strip with M/N | `provisional-start-block.browser.test.tsx` covers the presets; M (Move to…) and N (Comment) are dropped (PA L70) | |
| 16 | former-init-order-mode-and-the-minimap | Init order (superseded, see #10); minimap open | `provisional-minimap.browser.test.tsx` | Minimap adopted, off by default (PA L67) |
| 17 | former-recipe-script | Script/JSON drawer, Sheet + Script split view | superseded by `console.browser.test.tsx`'s Script/JSON tabs; the split view is not in v1 (PA L68: two-way editing in v1.1) | |
| 18 | former-side-panels | Inspector nothing selected / dependency selected; palette Recipe segment | superseded by `inspector.browser.test.tsx` and `structure-tab.browser.test.tsx` | |
| — | former-status-rail | Four checks, running, minimap toggle | superseded by `console.browser.test.tsx` (summary) and `title-block.browser.test.tsx`; minimap toggle in `provisional-minimap.browser.test.tsx` | PA L61, L66 |

## Provisional baselines (PA L72-L84 and the orchestrator's list)

| Surface | Test | PA / note |
| ------- | ---- | --------- |
| Deploy review: path choice (current-deploy-surface), plus provisional missing-contracts, pending, proposed and live phases | `deploy-surface.browser.test.tsx` | PA L74. Mismatch/failed/verifying skipped for scope; cheap to add later with the same helper pattern (Follow-up) |
| Init plan editor: units, example dot, references, From marks, reorder, bundle order | `provisional-init-editor.browser.test.tsx` | PA L75 |
| Choose an upgrade mechanism dialog + Authority table | `provisional-choose-mechanism.browser.test.tsx` | PA L76 |
| Seam pins, the SEM-01 note, Move to… crosshair | `provisional-seam-pins.browser.test.tsx` | PA L77 |
| The Structure tab | `structure-tab.browser.test.tsx` | PA L78 |
| Narrow layouts (1024, 768), pane switcher, title bar chip/Deploy/overflow | `provisional-narrow-layouts.browser.test.tsx` | PA L79 |
| Settings, Share, Projects (Recently deleted), banners | `provisional-settings-share-projects-banners.browser.test.tsx` | PA L80 |
| Console Script/Recipe JSON tabs | `console.browser.test.tsx` | Already drawn on current-console (PA L81 appears stale here; see Interpretations) |
| Forced-colors trace/cable variant | `trace-and-cable.browser.test.tsx` | PA L82 |
| Compact cards below 40% / off-screen | compact: covered by S4a's `compact-*` screenshots; off-screen: not built as a distinct visual, no test | PA L83 |
| v1 Start block (GovernedVault, ERC20, SafeDiamondCut) | `provisional-start-block.browser.test.tsx` | PA L84 |
| The init-order legend and path | `provisional-init-order-mode.browser.test.tsx` | orchestrator's note |
| Title block's collapsed and strip forms | `title-block.browser.test.tsx` (provisional tests) | orchestrator's note |
| Choose per selector dialog | `provisional-choose-per-selector.browser.test.tsx` | orchestrator's note |
| PaneSizeMenu | `provisional-misc.browser.test.tsx` | orchestrator's note |
| Copy fallback ("Press ⌘C to copy") | `provisional-misc.browser.test.tsx` | orchestrator's note |
| NotBuiltDialog | `provisional-misc.browser.test.tsx` | orchestrator's note |

## Differences from the boards, not spec decisions

- **Structure tab is flat, boards show it grouped by area.** `current-catalog-row.png`'s "RECIPE SEGMENT" panel
  and `former-side-panels.png`'s "PALETTE, RECIPE SEGMENT" panel both draw the placed-facets list grouped under
  PINNED/ACCESS/DEFI/... area headers. The real `StructurePanel` (S5b) renders a flat list of placed facets in
  recipe order, each with its own X/Y cut count, and no area grouping. This is a real shape difference, not a
  copy or data substitution — worth a decision in David's pass (group by area, or confirm flat-by-placement is
  intended). See `structure-tab.browser.test.tsx`.
- **The empty-sheet's terse headline copy was never built.** `current-empty-sheet.png` draws "PLACE A MODULE.
  ROUTE ITS SELECTORS." (Draft) / "PATCH A MODULE. ROUTE ITS JACKS." (Shop) over a bare grid with no cards. PA
  L64-65 supersedes this with the Start block (v1's GovernedVault/ERC20/SafeDiamondCut cards, adopted), which is
  what actually renders — "Start a diamond", the three recipe cards, Browse all recipes, the drag/⌘K hint and
  the tour line. The terse headline text itself doesn't exist anywhere in the app (grepped). Shop's rack rails
  (PA L63, called "optional") also aren't implemented — no rack/rail CSS in the repo — so Shop's empty ground is
  the same dot grid as Draft, just themed. Not a gap against the spec's decision, but worth flagging that the
  board's own headline copy has no home.
- **Catalog rows group by area; the board doesn't.** `current-catalog-row.png`'s Draft/Shop columns show a flat
  list. `CatalogPanel` groups rows under area headers ("Tokens", "Crosschain") and uses "ON SHEET" (IR L86) where
  the board says "IN CUT" — both are adopted decisions, not gaps.
- **Catalog board's example facets aren't in our catalog.** current-catalog-row.png's RateLimiter/CircuitBreaker
  don't exist in the fixture catalog; `catalog-row.browser.test.tsx` uses ERC20/ERC20Votes/ERC20Pausable to
  demonstrate the same rest/hover/selected/on-sheet/verified/unavailable states instead.
- **Command palette's groups are the spec's, not the board's.** current-command-palette.png shows "PLACE MODULE
  / BUILD / SESSION"; the built palette groups Suggested/Recent/Commands/Place facet/Recipes per spec L902 and
  contracts §5.3 — an adopted decision (PA doesn't call this out explicitly, but the spec's palette order is
  authoritative), not a gap.
- **`current-deploy-surface.png`'s hold-to-deploy is gone.** Superseded exactly as PA L13/L74 anticipate by the
  real 9-section deploy review (path choice, missing contracts, the phase ladder) — confirmed with no
  unexplained differences beyond that documented decision.
- **The sheet's title block can sit over facet cards.** In `trace-and-cable.browser.test.tsx`'s trace scene, the
  fixed bottom-right title block panel visually overlaps part of the AccessControl card (a `.react-flow__renderer`
  element screenshot captures whatever is visually on top of that area, including the title block chrome). This
  is real, spec-consistent behavior (spec L362: "Bottom right of the sheet") rather than a bug — it just happens
  because this test's 3-column card layout runs a card into that corner. Not fixed here since it doesn't affect
  what the baseline demonstrates (the trace itself, top-left of the same shot).
- **`provisional-init-order-mode`'s facet combination has a genuine SEL-01 collision** (ERC4626 and VaultCore
  both expose `deposit`/`mint`/`redeem`/`withdraw`), so the owner-choice popover briefly touches the top edge of
  the 700 px screenshot region in that scene. Cosmetic; a different facet subset would avoid it if a cleaner
  baseline is wanted later.
- **`GovernedVaultInit`'s bundle has a locked order, not draggable steps.** For `provisional-init-editor`'s
  ↑/↓ reorder screenshot, a synthetic 3-step recipe was used instead (GovernedVault's own production recipe uses
  the locked bundle, already covered by `SheetChrome.browser.test.tsx`'s "a bundle shows its fixed order" test).
- **PA L81 ("the console's Script and Recipe JSON tabs") looks stale.** `current-console.png` already draws both
  tabs in detail (a script line diff and JSON keys), so this isn't an undesigned surface; `console.browser.test.tsx`
  treats it as a `current-console` state, not a provisional one.
- **The NotBuiltDialog screenshot forces a real dialog id to fall through.** `DialogId` is a frozen contracts
  enum with no placeholder entry, so `provisional-misc.browser.test.tsx` uses `overrideDialog("deploy-review", null)`
  (the same pattern `DialogHost.browser.test.tsx` proves) to show "Not built yet · WP-S8b" rather than inventing
  an id like "WP-Q9", which would need a CCR to `DIALOG_IDS`.

## Baselines masked against dev's own drift

`provisional-share-over-length` builds its over-2,000-character link from a project name generated by `noise()`,
so its exact character count (and thus the description text's rendered width) depends on how the link encodes
the recipe — the project's name and the catalog hash among other things. Two later `dev` merges (FX22: the
project's name now goes into the recipe; FX20: the catalog carries solc's long version string, changing its
hash) shifted that count and broke the merge gate on a pixel diff confined to that text. The description is now
masked (`toMatchScreenshot`'s `screenshotOptions.mask`) so the baseline is stable against anything that changes
what the link encodes; the surrounding dialog chrome (title, note, buttons, focus) is still asserted and still
screenshotted. Checked every other provisional and board test for the same class of dependence (a length or
digit count baked into a screenshot from non-fixture, encoding-sensitive data): none found. Addresses and hashes
elsewhere are fixed-width hex regardless of value, and count text ("N facets · M selectors", blocker/warning
counts) comes from the static fixture catalog and its own template recipes, not from anything `dev` churns.

## A note on flakiness under heavy load

`bun run test:browser apps/studio/test/browser` passes clean (19/19 files, 86/86 tests) when the machine isn't
under heavy concurrent load. While other work packages' own Chromium-heavy suites were running at the same time
in sibling worktrees (observed: load average 15-18, up to 55 concurrent `chromium` processes from ~8 other
active WPs), individual tests here intermittently failed — always one of two shapes, never a wrong-content diff:
a 1-3% pixel difference with identical content on re-diff (font-hinting/antialiasing timing under CPU
contention), or a timeout in `sheet-harness.tsx`'s `settled()` poll (S4b's shared testing helper, not ours to
edit) or a "warm-up" lazy-chunk load. This is the same class of flake the orchestrator flagged for S4a's
`FacetCard.screens.browser.test.tsx` forced-colors screenshot: reproduced directly in this run (912 px / 1%
diff, border antialiasing only, on a full run with ~125 files and 578% CPU) with no evidence of a forced-colors
state leaking between test files (each Vitest Browser Mode session gets its own Playwright browser context and
page, confirmed by reading `@vitest/browser-playwright`'s provider code: `createContext`/`openBrowserPage` key
everything by `sessionId`). Two genuine test bugs were found and fixed along the way (not load-related): a
`getByRole` name match against a multi-word accessible name needed a regex instead of a plain string
(`provisional-narrow-layouts.browser.test.tsx`), and two screenshots needed to wait for the Start block's
`fitView`-computed position to hold still across a few animation frames before shooting
(`empty-sheet.browser.test.tsx`, `provisional-narrow-layouts.browser.test.tsx`, `provisional-init-order-mode.browser.test.tsx`'s
DEP-02 note). Fixing the remaining load-driven flakiness further would mean a pixel-diff tolerance or reduced
file parallelism in `vitest.config.ts`, which is frozen — a CCR, not a `test/browser/**` change.

## For David's design pass

Every `provisional-*` baseline above is a placeholder built from the design system and the nearest drawn board,
not a design. The Structure tab, the deploy review's later phases, the init editor's field furniture, the
Choose-mechanism dialog, seam pins, narrow layouts, Settings/Share/Projects/banners, the choose-per-selector
dialog, PaneSizeMenu, the copy fallback and NotBuiltDialog all need a real pass in Claude Design.
