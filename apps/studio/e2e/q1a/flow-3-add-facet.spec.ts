/**
 * Flow 3. Add a facet (spec L413-L430, IR "Sheet": card placement, "Left pane": Catalog, "Inspector": Catalog
 * preview and Requires, "Console drawer").
 *
 * Seven routes, one result: the card is placed and selected, the checks run, and the console says what happened.
 *   1. Drag a catalog row onto the sheet (pointer).
 *   2. Double-click a row, or press Enter on it.
 *   3. Place on sheet in the inspector's catalog preview.
 *   4. ⌘K, type the name, Enter.
 *   5. Console `place erc20`.
 *   6. Place {facet} on a missing-dependency note or in the inspector's Requires list.
 *   7. Add facet here… in the sheet's context menu.
 *
 * Two of the brief's stated "confirmed facts" don't hold once checked against the real catalog and are corrected
 * here instead of built around:
 *   - `ERC20Pausable` requires `Pausable` at `strength: "convention"`, not "hard" (packages/core/src/checks/dep.ts:
 *     `checkRequirements`). That raises DEP-02 (caption "Convention", a generic Note line), never DEP-01/"Missing
 *     dependency". The real single-option, hard, DEP-01 case in the catalog is `ERC4626` requires `ERC20` (checked
 *     directly against the built catalog), used below instead.
 *   - `dependencyMet`'s `facet` is the problem's own `params.facet` (`narrate.ts`'s `narrateResolvedDependencies`),
 *     which `checkRequirements` sets to the *requiring* facet, not the dependency just placed. So resolving
 *     ERC4626's requirement on ERC20 logs "Dependency met: ERC4626.", not "…: ERC20.".
 */
import type { Page } from "@playwright/test";
import { plural } from "@lattice-studio/core";
import { catalog } from "../_support/catalog.ts";
import { expect, test } from "../_support/fixtures.ts";
import { commandLine, pagePlatform, region } from "../_support/keys.ts";
import { openEmpty } from "../_support/seed.ts";
import { NARROW_WIDTHS, expectTier, tierAt, viewportAt } from "../_support/viewports.ts";
import { CatalogPage } from "./pages/catalog-page.ts";
import { ConsolePage } from "./pages/console-page.ts";
import { InspectorPage } from "./pages/inspector-page.ts";
import { SheetPage } from "./pages/sheet-page.ts";

/**
 * A console verb, keyboard-only, without `_support/keys.ts`'s `runConsole`. `runConsole`'s fallback path (Tab from
 * the Console region until the command line takes focus, capped at 20 presses) can't reach it here: the console
 * header carries a log-filter toolbar (Note, Placed, Resolved, Collision, Missing, Init, Deploy, Verify, Error —
 * one button per tag) that alone runs the count past 15 before the log or the command line are even reached, so
 * the cap trips before every real console interaction (reproduced identically against the shared smoke suite:
 * `_support/smoke/keys.spec.ts`'s "the console runs a verb", from a fresh `openEmpty`, no facet involved). That's a
 * `_support/keys.ts` bug outside this file's scope. `Locator.focus()` (used the same way flow-1's own keyboard-only
 * test uses `tourLink.focus()`) reaches the input directly without walking the Tab order.
 */
async function typeConsole(page: Page, line: string): Promise<void> {
  const input = commandLine(page);
  await input.waitFor({ state: "attached" });
  await input.focus();
  await expect(input).toBeFocused();
  await page.keyboard.type(line);
  await page.keyboard.press("Enter");
}

/**
 * `_support/keys.ts`'s `runInPalette`, but with the right modifier key. `MOD` ("ControlOrMeta") resolves against
 * the *host* OS running the test (this machine: macOS, so Meta), while the app binds the shortcut to what
 * `navigator.platform` reports *inside the browser* — Playwright's "Desktop Chrome" device profile always reports
 * a Windows UA, Mac host or not (`pagePlatform`'s own doc comment says as much), so on the `chromium` project the
 * app is listening for Control+K, not the Meta+K `openPalette` sends; Meta+K reaches the page (confirmed with a
 * capture-phase listener: `keydown` fires, `defaultPrevented` stays false) but nothing in the app answers it, so
 * `openPalette` times out waiting for the combobox. That's a `_support/keys.ts` bug outside this file's scope, and
 * reproduces identically in `_support/smoke/keys.spec.ts`'s own "⌘K opens the palette" from a fresh `openEmpty`.
 * This asks the page itself (`pagePlatform`) which key it's listening for instead of trusting Playwright's guess.
 */
async function typeInPalette(page: Page, query: string): Promise<void> {
  const mod = (await pagePlatform(page)) === "mac" ? "Meta" : "Control";
  await page.keyboard.press(`${mod}+k`);
  const input = page.getByRole("combobox");
  await expect(input).toBeFocused();
  await chooseInPalette(page, query);
}

/**
 * The palette is already open (route 7: a menu command opens it filtered to facets); type `query` and wait for it
 * to rank the right row before pressing Enter. The palette's search is a plain substring filter over each row's
 * full title in catalog order, not fuzzy-ranked, so a bare facet name that's also another facet's suffix (e.g.
 * "ERC20" inside "BridgeERC20", "Pausable" inside "ERC20Pausable") can rank the wrong one first; queries below use
 * "place <name>" to exclude those (their titles don't contain "place " immediately before a different facet name).
 */
async function chooseInPalette(page: Page, query: string): Promise<void> {
  const input = page.getByRole("combobox");
  await input.fill(query);
  await expect
    .poll(
      async () => {
        const text = await input.evaluate((el) => {
          const id = el.getAttribute("aria-activedescendant");
          const option = id ? document.getElementById(id) : null;
          return option?.textContent ?? null;
        });
        return text?.toLowerCase().includes(query.toLowerCase()) ?? false;
      },
      { message: `the palette's active row should be "${query}"` },
    )
    .toBe(true);
  await page.keyboard.press("Enter");
}

/** "Placed {facet} · {n} selectors · erc7201:{namespace}" (spec L430, `lines.placed`), from the real catalog. */
function placedLine(name: string): string {
  const facet = catalog().facets.find((f) => f.name === name);
  if (!facet) throw new Error(`${name} isn't in the built catalog.`);
  const ns = facet.storage ? ` · erc7201:${facet.storage.id}` : "";
  return `Placed ${name} · ${plural(facet.selectors.length, "selector")}${ns}`;
}

/** "{facet} requires {requires}: {reason}." (`lines.missing`), from the real catalog's own requirement. */
function missingLine(facet: string, requires: string): string {
  const detail = catalog().facets.find((f) => f.name === facet);
  if (!detail) throw new Error(`${facet} isn't in the built catalog.`);
  const req = detail.requires.find((r) => r.anyOf.includes(requires));
  if (!req) throw new Error(`${facet} doesn't require ${requires} in the built catalog.`);
  return `${facet} requires ${requires}: ${req.reason.replace(/\.$/, "")}.`;
}

/** "Dependency met: {facet}." (`lines.dependencyMet`) — `facet` is the one that *had* the requirement. */
function dependencyMetLine(facet: string): string {
  return `Dependency met: ${facet}.`;
}

test.describe("Flow 3. Add a facet", () => {
  test("route 2: double-click a catalog row places it @smoke", async ({ page }) => {
    await openEmpty(page);
    const catalogPage = new CatalogPage(page);
    const sheet = new SheetPage(page);
    const console_ = new ConsolePage(page);

    await catalogPage.placeByDoubleClick("ERC20");

    await sheet.expectSelected("ERC20");
    await console_.expectLastLine(placedLine("ERC20"));
  });

  test("route 2: Enter on a focused catalog row places it", async ({ page }) => {
    await openEmpty(page);
    const catalogPage = new CatalogPage(page);
    const sheet = new SheetPage(page);
    const console_ = new ConsolePage(page);

    await catalogPage.placeByKeyboard("Pausable");

    await sheet.expectSelected("Pausable");
    await console_.expectLastLine(placedLine("Pausable"));
  });

  test("route 3: Place on sheet in the inspector's catalog preview", async ({ page }) => {
    await openEmpty(page);
    const catalogPage = new CatalogPage(page);
    const inspector = new InspectorPage(page);
    const sheet = new SheetPage(page);
    const console_ = new ConsolePage(page);

    // A single click (not double-click, which places) opens the Catalog preview (S5a's `onItemClick`).
    await catalogPage.searchFor("ERC20");
    await catalogPage.row("ERC20").click();
    await expect(inspector.placeOnSheetButton).toBeVisible();
    await inspector.placeOnSheetButton.click();

    await sheet.expectSelected("ERC20");
    await console_.expectLastLine(placedLine("ERC20"));
  });

  test("route 4: ⌘K, type the name, Enter @smoke", async ({ page }) => {
    await openEmpty(page);
    const sheet = new SheetPage(page);
    const console_ = new ConsolePage(page);

    // "ERC20" alone (the spec's literal wording) ranks "Place BridgeERC20" first: the palette's search is a plain
    // substring filter over each row's full title in catalog order, not fuzzy-ranked, and "BridgeERC20" (Crosschain
    // area) sorts ahead of the standalone "ERC20" facet. "place erc20" excludes it (its title has no "erc20"
    // right after "place ") and keeps "ERC20" first among what's left ("ERC20Burnable" etc. sort after it).
    await typeInPalette(page, "place erc20");

    await sheet.expectSelected("ERC20");
    await console_.expectLastLine(placedLine("ERC20"));
  });

  test("route 5: console `place erc20` @smoke", async ({ page }) => {
    await openEmpty(page);
    const sheet = new SheetPage(page);
    const console_ = new ConsolePage(page);

    await typeConsole(page, "place erc20");

    await sheet.expectSelected("ERC20");
    await console_.expectLastLine(placedLine("ERC20"));
  });

  test("already placed: selects and locates the existing card instead of duplicating it", async ({ page }) => {
    await openEmpty(page);
    const sheet = new SheetPage(page);
    const console_ = new ConsolePage(page);

    await typeConsole(page, "place erc20");
    await sheet.expectSelected("ERC20");
    await console_.expectLastLine(placedLine("ERC20"));

    await typeConsole(page, "place erc20");

    await console_.expectLastLine("ERC20 is already on the sheet.");
    await sheet.expectSelected("ERC20");
    await expect(sheet.card("ERC20")).toHaveCount(1);
  });

  test.describe("route 6: missing dependency (DEP-01, a real ERC4626 → ERC20 case)", () => {
    test("placing ERC4626 alone raises a missing-dependency note and console line", async ({ page }) => {
      await openEmpty(page);
      const sheet = new SheetPage(page);
      const console_ = new ConsolePage(page);

      await typeConsole(page, "place erc4626");

      await sheet.expectSelected("ERC4626");
      const note = sheet.note("Missing dependency");
      await expect(note).toBeVisible();
      await expect(note.getByRole("button", { name: "Place ERC20" })).toBeVisible();
      await console_.expectLastLine(missingLine("ERC4626", "ERC20"));
    });

    test("Place ERC20 on the missing-dependency note resolves it @smoke", async ({ page }) => {
      await openEmpty(page);
      const sheet = new SheetPage(page);
      const console_ = new ConsolePage(page);

      await typeConsole(page, "place erc4626");
      const note = sheet.note("Missing dependency");
      await expect(note).toBeVisible();

      await note.getByRole("button", { name: "Place ERC20" }).click();

      await expect(sheet.card("ERC20")).toBeVisible();
      await expect(sheet.note("Missing dependency")).toHaveCount(0);
      await console_.expectLastLine(dependencyMetLine("ERC4626"));
    });

    test("Place ERC20 from the inspector's Requires list resolves it", async ({ page }) => {
      await openEmpty(page);
      const sheet = new SheetPage(page);
      const inspector = new InspectorPage(page);
      const console_ = new ConsolePage(page);

      await typeConsole(page, "place erc4626");
      // Double-clicking the card opens it in the Facet view (Selectors focused; Requires is on the same view).
      await sheet.card("ERC4626").dblclick();
      // `InspectorPage.placeRequirementButton` matches by name alone, and the Facet view also lists the card's own
      // problems (its DEP-01) with the identical "Place ERC20" fix button, so two match; scoped to the Requires
      // section (a `<section aria-labelledby>`, an implicit `role="region"`, per `Section.tsx`) it's unique.
      const requires = inspector.root.getByRole("region", { name: "Requires" });
      const placeErc20 = requires.getByRole("button", { name: "Place ERC20" });
      await expect(placeErc20).toBeVisible();

      await placeErc20.click();

      await expect(sheet.card("ERC20")).toBeVisible();
      await expect(sheet.note("Missing dependency")).toHaveCount(0);
      await console_.expectLastLine(dependencyMetLine("ERC4626"));
    });
  });

  test.describe("route 1: drag a catalog row onto the sheet (pointer)", () => {
    // The sheet's canvas, the drop target, arrives after the first paint: a drag that ends before it has loaded
    // lands on the bare region and places nothing (this was the "1 run in 3" flake, and on a busy machine every
    // run). So the drag waits for the drop target itself: the canvas marks its root `data-drop-target="ready"`
    // once the interactions layer's shell has registered it (it doesn't wait for the layer's lazy overlays: a drop
    // before they load is placed all the same, `DropEarly.browser.test.tsx`). The tool strip isn't that condition:
    // it comes from a different chunk.
    test("drops the card near the pointer, selected", async ({ page }) => {
      await openEmpty(page);
      const catalogPage = new CatalogPage(page);
      const sheet = new SheetPage(page);
      await expect(sheet.root.locator('.react-flow[data-drop-target="ready"]')).toBeVisible();
      const console_ = new ConsolePage(page);

      const box = await sheet.root.boundingBox();
      if (!box) throw new Error("The Sheet region has no box to drop onto.");
      const target = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

      await catalogPage.dragRowToSheet("ERC20", target);

      await sheet.expectSelected("ERC20");
      await console_.expectLastLine(placedLine("ERC20"));
    });
  });

  test.describe("route 7: Add facet here… in the sheet's context menu", () => {
    test("opens the palette filtered to facets and places at the pointer", async ({ page }) => {
      await openEmpty(page);
      const sheet = new SheetPage(page);
      const console_ = new ConsolePage(page);

      // A facet placed first (spec's default landing: center of the view), so the empty Start block (which floats
      // centered over the canvas and would otherwise eat the right-click) is gone.
      await typeConsole(page, "place erc20");
      await sheet.expectSelected("ERC20");

      const box = await sheet.root.boundingBox();
      if (!box) throw new Error("The Sheet region has no box to right-click.");
      // Mid-height, far from the card: the sheet's chrome (the tool strip, the title block) floats over its
      // corners, so `.react-flow__pane` (what the app's own contextmenu listener requires the click to land on,
      // `use-pane-context-menu.ts`'s `onPane`) isn't reachable there — confirmed empty-canvas hit-testing at this
      // point instead.
      await sheet.root.click({ button: "right", position: { x: 30, y: box.height / 2 } });
      const menu = page.getByRole("menu", { name: "Sheet actions" });
      await expect(menu).toBeVisible();
      await menu.getByRole("menuitem", { name: "Add facet here…" }).click();

      // The palette is now open, filtered to facets (S6's `mode: "facets"`); type the name and press Enter.
      // "place pausable" (not bare "Pausable") for the same ranking reason as route 4 above.
      await expect(page.getByRole("combobox")).toBeFocused();
      await chooseInPalette(page, "place pausable");

      await sheet.expectSelected("Pausable");
      await console_.expectLastLine(placedLine("Pausable"));
    });
  });

  test("keyboard-only: places facets through the palette, the console and Enter on a catalog row, no pointer events", async ({
    page,
  }) => {
    await openEmpty(page);
    const sheet = new SheetPage(page);
    const console_ = new ConsolePage(page);
    const catalogPage = new CatalogPage(page);

    // Route 5: the console verb.
    await typeConsole(page, "place erc20");
    await sheet.expectSelected("ERC20");
    await console_.expectLastLine(placedLine("ERC20"));

    // Route 4: the palette ("place pausable" over bare "Pausable" for the same reason as route 4 above: it
    // excludes "Place ERC20Pausable", which would otherwise sort first).
    await typeInPalette(page, "place pausable");
    await sheet.expectSelected("Pausable");
    await console_.expectLastLine(placedLine("Pausable"));

    // Route 2: Enter on a focused catalog row. `placeByKeyboard` types into Search (a real keystroke, no pointer)
    // and presses Enter; it never clicks.
    await catalogPage.placeByKeyboard("AccessControl");
    await sheet.expectSelected("AccessControl");
    await console_.expectLastLine(placedLine("AccessControl"));

    // Route 3 (a single click on an unplaced row) has no keyboard equivalent: Enter on a catalog row activates
    // (places) it directly rather than opening the Catalog preview (S5a's Tree `onKeyDown`), so it's left out of
    // this keyboard-only chain rather than reached through a heavier context-menu-and-arrow-keys path.
  });

  for (const width of NARROW_WIDTHS) {
    test.describe(`at ${width} px`, () => {
      test.use({ viewport: viewportAt(width) });

      test(`places a facet through the ${tierAt(width)} tier's catalog control`, async ({ page }) => {
        await openEmpty(page);
        await expectTier(page, tierAt(width));
        const sheet = new SheetPage(page);
        const catalogPage = new CatalogPage(page);
        const console_ = new ConsolePage(page);

        // Enter on the row (route 2's keyboard path), not a double-click: at both narrow tiers the catalog shows
        // as an overlay (a drawer at 768, the switcher's own pane at 375) sharing its slot with the Inspector or
        // the Sheet. A double-click's first click alone runs `catalog.preview`, which shows the Inspector — at
        // 768 that swaps the one open drawer away from Catalog, and the row (and the second click's target) is
        // gone before it lands; the double-click never completes and nothing gets placed. Enter places in one
        // keystroke, so there's no second click to lose.
        if (width === 375) {
          const switcher = page.getByRole("tablist", { name: "Panes" });
          await switcher.getByRole("tab", { name: "Catalog" }).click();
          await catalogPage.placeByKeyboard("ERC20");
          await switcher.getByRole("tab", { name: "Sheet" }).click();
        } else {
          const catalogToggle = page.getByRole("region", { name: "Title bar" }).getByRole("button", { name: "Catalog" });
          await catalogToggle.click();
          await catalogPage.placeByKeyboard("ERC20");
          // Placing from the drawer hides it again on its own (the live region announces "Hid the catalog." right
          // after "Placed …"), landing back on the sheet — no second toggle needed.
        }

        await expect(sheet.card("ERC20")).toBeVisible();
        if (width === 768) {
          // The console starts collapsed at this tier (a fresh `openEmpty` here shows "Expand console" before any
          // interaction) to save vertical space alongside the drawers; expand it, then wait for its body (its own
          // lazy chunk — see `typeConsole`'s doc comment) before reading the log.
          await region(page, "Console").getByRole("button", { name: "Expand console" }).click();
          await commandLine(page).waitFor({ state: "attached" });
          await console_.expectLastLine(placedLine("ERC20"));
        }
      });
    });
  }
});

/*
 * Scope calls (documented, never a silent skip):
 * - "Not on the selected chain" (spec L428) needs a checked chain, which is the chain module's territory (a
 *   different WP, may still show its "Not built yet" placeholder). Left out here; a chain-availability chip on a
 *   placed card belongs with that WP's own e2e coverage once it's built, or a follow-up here with
 *   `skipUnlessBuilt`.
 * - "Placed again after removal" (spec L429: seams and owners reset, a fresh SEL-01) needs a two-facet
 *   selector-overlap pair, a place → remove → place-again sequence and a collision-note assertion — a materially
 *   bigger scenario than the other routes here. Left out to keep this suite's scope to the seven placement routes
 *   plus the DEP-01 case; a good candidate for the collisions-focused suite that already has `collisionsProject()`
 *   and SEL-01 coverage.
 */

