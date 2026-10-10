/**
 * Flow 10 steps 6-7, "Share" and "Opening a link" (spec L503-L504, IR L71, L178-L179, L203-L206): Share copies
 * a link and announces its length, or (over 2,000 characters) opens the Share dialog; opening a link creates a
 * new project named after the recipe, banners its short hash, steps through every LINK-01 address one at a
 * time before it counts, and either opens read-only with Migrate (a catalog this build doesn't bundle) or is
 * refused (a newer schema).
 *
 * See the file's closing comment for the interpretations this spec had to make.
 */
import type { Recipe } from "@lattice-studio/core";
import { blankDiamond, decodeShareLink } from "@lattice-studio/core";
import { expect, test } from "../_support/fixtures.ts";
import { catalog as builtCatalog } from "../_support/catalog.ts";
import { projectFor, recipeProject, shareLink } from "../_support/projects.ts";
import { expectProject, openEmpty, seedProject } from "../_support/seed.ts";
import { expectTier, NARROW_WIDTHS, tierAt, viewportAt } from "../_support/viewports.ts";
import { catalogVersion, linkCopied, migrateTitle, migratedLine, PLACE_FACETS_FIRST } from "../../src/flows/copy.ts";
import { banner, bannerAction, sharedLinkBanner, UNBUNDLED } from "./pages/banners.ts";
import { expectLogLine } from "./pages/console.ts";
import { confirmCard, inspector } from "./pages/inspector.ts";
import { runInPalette } from "./pages/keys.ts";
import { copyAnyway, expectShareDialog, saveFileInstead, shareDialogDescription } from "./pages/share-dialog.ts";
import { expectMigrateDialog, keepReadOnly, migrateSummary, migrateTo } from "./pages/migrate-dialog.ts";
import { clickShare, expectSaveStatus, openOverflowMenu, titleBar } from "./pages/shell.ts";

const from = builtCatalog();

/**
 * `open-link.ts`'s `sharedName`, mirrored here rather than imported: that module also imports `@/contracts`
 * (React, env, the whole entry graph) at its top level, which crashes outside Vite's own build (Playwright
 * loads spec files directly under Node/esbuild, where `import.meta.env` isn't statically replaced). Every
 * other app-source import this spec uses (`src/flows/copy.ts`) is pure and side-effect free; this one line of
 * logic is copied instead of pulled in. Flagged as a Follow-up to Q0 in the closing comment.
 */
function sharedName(recipe: Recipe): string {
  const base = (recipe.name ?? recipe.template?.name ?? "Untitled").replace(/ \(shared\)$/, "").trim();
  return `${base === "" ? "Untitled" : base} (shared)`;
}

/**
 * Waits for the "Link copied · N characters" toast (any N: `copyText` awaits the clipboard write before it
 * toasts, so the toast's presence proves the write already landed), then reads the clipboard and asserts the
 * exact count. The toast (not the console log) works at every width: below 1024 px the console starts
 * collapsed (`Expand console`), so `getByRole("log")` finds nothing there even though the same line reached
 * it (contracts: every toast is a console line) — see Interpretation 6. Reading the clipboard right after the
 * click races the async write; waiting for the toast first removes the race instead of adding a sleep.
 */
async function expectLinkCopied(page: import("@playwright/test").Page): Promise<string> {
  await expect(page.getByRole("dialog", { name: /^Link copied · [\d,]+ characters$/ })).toBeVisible();
  const clipped = await page.evaluate(() => navigator.clipboard.readText());
  await expect(page.getByRole("dialog", { name: linkCopied(clipped.length) })).toBeVisible();
  return clipped;
}

/** The first number in "This link is 7,887 characters, over the 2,000 …" (never the "2,000" that follows it). */
function leadingCount(text: string): number {
  const match = /This link is ([\d,]+) characters/.exec(text);
  return Number((match?.[1] ?? "").replace(/,/g, ""));
}

/** A recipe over 2,000 characters once shared (brief note 4): every facet, every selector owned. */
function everythingRecipe(): Recipe {
  const base = blankDiamond(from);
  const facets = [...new Set([...base.facets, ...from.facets.map((f) => f.name)])];
  const owners: Record<string, string> = {};
  for (const facet of from.facets) for (const selector of facet.selectors) owners[selector.hex] = facet.name;
  return { ...base, facets, owners };
}

/** SafeDiamondCut, filled: its one authority literal (`steps[0].safe`) is the only LINK-01 this build's
 * catalog offers among its loadable templates (see the closing comment, Interpretation 2). */
function safeDiamondCutRecipe(): Recipe {
  return recipeProject("SafeDiamondCut", { filled: true }).recipe;
}

test.describe("Flow 10 step 6: Share (spec L503, IR L71)", () => {
  test("copies the link and announces the exact character count", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const project = recipeProject("GovernedVault", { name: "ShareVault" });
    await seedProject(page, { project });
    await page.bringToFront();

    await clickShare(page);
    const clipped = await expectLinkCopied(page);

    const decoded = decodeShareLink(clipped, [from]);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.value.recipe.name).toBe(project.name);
  });

  test("is disabled on an empty sheet with 'Place facets first'", async ({ page }) => {
    await openEmpty(page);
    const share = titleBar(page).getByRole("button", { name: "Share", exact: true });
    await expect(share).toHaveAccessibleDescription(PLACE_FACETS_FIRST);
    await expect(share).toHaveAttribute("aria-disabled", "true");
  });

  test("keyboard-only: Copy share link runs from the palette @smoke", async ({ page, context, browserName }) => {
    // WebKit has no clipboard permission model Playwright can grant: accept either the toast or the
    // clipboard-blocked fallback ("Press ⌘C to copy", spec/PA L32) there, instead of asserting one outcome.
    if (browserName !== "webkit") await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const project = recipeProject("GovernedVault", { name: "ShareVaultKeys" });
    await seedProject(page, { project });
    await page.bringToFront();

    await runInPalette(page, "Copy share link");
    if (browserName === "webkit") {
      const toast = page.getByRole("dialog", { name: /^Link copied · [\d,]+ characters$/ });
      const fallback = page.getByText(/^Press (⌘C|Ctrl\+C) to copy$/);
      await expect(toast.or(fallback)).toBeVisible();
    } else {
      await expectLinkCopied(page);
    }
  });

  for (const width of NARROW_WIDTHS) {
    test.describe(`at ${width} px`, () => {
      test.use({ viewport: viewportAt(width) });

      test(`Share is disabled with 'Place facets first' from the overflow menu`, async ({ page }) => {
        await openEmpty(page);
        await expectTier(page, tierAt(width));
        // clickShare opens the overflow menu below 1024 px (`pages/shell.ts`); the item itself carries the
        // same disabled reason as the wide title-bar button, so this asserts the item without activating it.
        const menu = await openOverflowMenu(page);
        const item = menu.getByRole("menuitem", { name: "Share" });
        await expect(item).toHaveAccessibleDescription(PLACE_FACETS_FIRST);
      });

      test(`copies the link from the overflow menu`, async ({ page, context }) => {
        await context.grantPermissions(["clipboard-read", "clipboard-write"]);
        const project = recipeProject("GovernedVault", { name: `ShareVault${width}` });
        await seedProject(page, { project });
        await expectTier(page, tierAt(width));
        await page.bringToFront();
        await clickShare(page);
        await expectLinkCopied(page);
      });
    });
  }
});

test.describe("Flow 10 step 6: Share over 2,000 characters (IR L179)", () => {
  test("opens the Share dialog; Copy anyway copies and closes", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const project = projectFor(everythingRecipe(), "Everything", {}, from);
    await seedProject(page, { project });
    await page.bringToFront();

    await clickShare(page);
    const dialog = await expectShareDialog(page);
    const description = (await dialog.getByText(/^This link is [\d,]+ characters, over the 2,000 a Discord message holds\.$/).textContent()) ?? "";
    const characters = leadingCount(description);
    expect(characters).toBeGreaterThan(2000);
    await expect(dialog).toHaveAccessibleDescription(shareDialogDescription(characters));

    await copyAnyway(page).click();
    await expect(dialog).toHaveCount(0);
    const clipped = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipped.length).toBe(characters);
    await expectLogLine(page, linkCopied(clipped.length));
  });

  test("Save a file instead downloads recipe.json carrying the same facets", async ({ page }) => {
    const recipe = everythingRecipe();
    const project = projectFor(recipe, "EverythingFile", {}, from);
    await seedProject(page, { project });
    await page.bringToFront();

    await clickShare(page);
    const dialog = await expectShareDialog(page);
    const [download] = await Promise.all([page.waitForEvent("download"), saveFileInstead(page).click()]);
    expect(download.suggestedFilename()).toBe("recipe.json");
    await expect(dialog).toHaveCount(0);
    // `recipe.json` itself carries no header (`export/docs/recipe-json.ts`), but the export is tied to the
    // recipe's hash through the console line every export logs (spec L729): "Exported recipe.json · recipe 0x…".
    await expectLogLine(page, "Exported recipe.json · recipe ");

    const filePath = await download.path();
    expect(filePath).toBeTruthy();
    const fs = await import("node:fs/promises");
    const text = await fs.readFile(filePath as string, "utf8");
    const json = JSON.parse(text) as { $schema?: string; facets: string[] };
    expect(json.$schema).toBeTruthy();
    expect(new Set(json.facets)).toEqual(new Set(project.recipe.facets));
  });

  test("keyboard-only: Save a file instead is the dialog's initial focus @smoke", async ({ page }) => {
    // This path never touches the clipboard (it downloads a file), so no clipboard permission is needed —
    // WebKit has none Playwright can grant, and this test runs there too.
    const project = projectFor(everythingRecipe(), "EverythingKeys", {}, from);
    await seedProject(page, { project });
    await page.bringToFront();

    // Share isn't reachable from the palette when the sheet would open the dialog (it still runs `share.copyLink`);
    // running it from the palette and pressing Enter on the dialog's initial focus reaches Save a file instead.
    await runInPalette(page, "Copy share link");
    const dialog = await expectShareDialog(page);
    await expect(saveFileInstead(page)).toBeFocused();
    const [download] = await Promise.all([page.waitForEvent("download"), page.keyboard.press("Enter")]);
    expect(download.suggestedFilename()).toBe("recipe.json");
    await expect(dialog).toHaveCount(0);
  });
});

test.describe("Flow 10 step 7: opening a share link (spec L504, IR L203)", () => {
  test("creates a project named after the recipe, banners the short hash, and steps through Confirm addresses", async ({
    page,
  }) => {
    const recipe = safeDiamondCutRecipe();
    const link = shareLink(recipe);
    const decoded = decodeShareLink(link, [from]);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const { hash, unconfirmed } = decoded.value;
    expect(unconfirmed).toEqual(["steps[0].safe"]);
    const { init } = decoded.value.recipe;
    const safeArg = init.kind === "steps" ? init.steps[0]?.args["safe"] : undefined;
    const address = typeof safeArg === "string" ? safeArg : "";
    expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);

    await page.goto(`/${link}`);
    await expectProject(page, sharedName(recipe));

    const bannerText = sharedLinkBanner(hash);
    await expect(banner(page, bannerText)).toBeVisible();
    await expectLogLine(page, "Opened a shared link");
    await expectLogLine(page, "1 address to confirm");

    // Confirm addresses…: the field's label, the full un-truncated address, Confirm address.
    const confirmAddressesAction = await bannerAction(page, bannerText, "Confirm addresses…");
    await confirmAddressesAction.click();
    await expect(inspector(page).getByRole("heading", { level: 3, name: "Confirm addresses" })).toBeVisible();
    await expect(inspector(page).getByText("Address 1 of 1")).toBeVisible();
    await expect(confirmCard(page).getByText(address, { exact: true })).toBeVisible();
    // Only one authority address in this build's catalog (Interpretation 2): no "Next address" button.
    await expect(confirmCard(page).getByRole("button", { name: "Next address" })).toHaveCount(0);

    await confirmCard(page).getByRole("button", { name: "Confirm address" }).click();
    await expectLogLine(page, `: ${address}.`);
    await expect(inspector(page).getByText("Every address that came from a link or a file is confirmed.")).toBeVisible();

    // LINK-01 cleared: the same banner action is now disabled with the "nothing to confirm" reason.
    const cleared = page.getByRole("button", { name: "Confirm addresses…" });
    await expect(cleared).toHaveAccessibleDescription("No address is waiting to be confirmed");
  });

  test("keyboard-only: Confirm addresses… and Confirm address run without a pointer @smoke", async ({ page }) => {
    const recipe = safeDiamondCutRecipe();
    const link = shareLink(recipe);
    await page.goto(`/${link}`);
    await expectProject(page, sharedName(recipe));

    await runInPalette(page, "Confirm addresses");
    await expect(inspector(page).getByRole("heading", { level: 3, name: "Confirm addresses" })).toBeVisible();

    const confirmButton = confirmCard(page).getByRole("button", { name: "Confirm address" });
    await confirmButton.focus();
    await page.keyboard.press("Enter");
    await expect(inspector(page).getByText("Every address that came from a link or a file is confirmed.")).toBeVisible();
  });

  test("a link naming a catalog this build doesn't bundle opens read-only with Migrate; Migrate applies it", async ({
    page,
  }) => {
    const recipe = recipeProject("GovernedVault", { name: "OldVault" }).recipe;
    const fakeHash = `0x${"cd".repeat(32)}` as const;
    const unbundled: Recipe = { ...recipe, catalog: { tag: "v0.1.0", hash: fakeHash } };
    const link = shareLink(unbundled);

    await page.goto(`/${link}`);
    await expectProject(page, sharedName(unbundled));

    // The Migrate dialog opens by itself the first time a project resolves unbundled (IR L178): that's the
    // first observable here, asserted directly rather than through the read-only banner or save status first.
    const targetTag = catalogVersion(from.lattice.tag);
    const dialog = await expectMigrateDialog(page);
    // "Keep read-only" (not "Cancel") is this dialog's own tell for the unbundled path (`MigrateDialog.tsx`).
    await expect(keepReadOnly(page)).toBeVisible();
    await expect(migrateSummary(page)).toBeVisible();
    await migrateTo(page, targetTag).click();
    await expect(dialog).toHaveCount(0);

    // Migrated: the recipe re-pins to the loaded catalog (`migrate-diff.ts`'s `migrateRecipe`), so read-only
    // clears for real, not just the save status (which never reflected UNBUNDLED to begin with — see the
    // closing comment). The name button, disabled with `UNBUNDLED` while read-only, is enabled again.
    await expectLogLine(page, migratedLine(from.lattice.tag));
    await expect(banner(page, UNBUNDLED)).toHaveCount(0);
    const nameButton = titleBar(page).getByRole("button", { name: sharedName(unbundled) });
    await expect(nameButton).not.toHaveAttribute("aria-disabled", "true");
    await expectSaveStatus(page, "Saved");
  });

  test("Keep read-only leaves the project read-only", async ({ page }) => {
    const recipe = recipeProject("GovernedVault", { name: "OldVaultKept" }).recipe;
    const fakeHash = `0x${"ab".repeat(32)}` as const;
    const unbundled: Recipe = { ...recipe, catalog: { tag: "v0.1.0", hash: fakeHash } };
    const link = shareLink(unbundled);

    await page.goto(`/${link}`);
    await expectProject(page, sharedName(unbundled));

    const dialog = await expectMigrateDialog(page);
    await expect(keepReadOnly(page)).toBeVisible();
    await keepReadOnly(page).click();
    await expect(dialog).toHaveCount(0);

    // Read-only here means the catalog pin, not the edit lock (`persist/persistence.ts`'s save status only
    // reflects the lock, spec L505's "Editing moved to another tab" case): editing commands are refused with
    // the project name button's accessible description, exactly the two-tabs spec's pattern (`ELSEWHERE`).
    const nameButton = titleBar(page).getByRole("button", { name: sharedName(unbundled) });
    await expect(nameButton).toHaveAccessibleDescription(UNBUNDLED);
    await expect(banner(page, UNBUNDLED)).toBeVisible();
    const bannerAction2 = await bannerAction(page, UNBUNDLED, migrateTitle(from.lattice.tag));
    await expect(bannerAction2).toBeVisible();
  });

  test("keyboard-only: Keep read-only, then Migrate to {tag} run from the palette @smoke", async ({ page }) => {
    const recipe = recipeProject("GovernedVault", { name: "OldVaultKeys" }).recipe;
    const fakeHash = `0x${"12".repeat(32)}` as const;
    const unbundled: Recipe = { ...recipe, catalog: { tag: "v0.1.0", hash: fakeHash } };
    const link = shareLink(unbundled);

    await page.goto(`/${link}`);
    await expectProject(page, sharedName(unbundled));
    const dialog = await expectMigrateDialog(page);
    // Esc is this kit's keyboard-only way to reach "Keep read-only" without a pointer (every dialog closes on
    // Esc, IR "Dialogs"); the same command re-opens the dialog from the palette by its dynamic title.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    const nameButton = titleBar(page).getByRole("button", { name: sharedName(unbundled) });
    await expect(nameButton).toHaveAccessibleDescription(UNBUNDLED);

    const targetTag = catalogVersion(from.lattice.tag);
    await runInPalette(page, migrateTitle(from.lattice.tag));
    const reopened = await expectMigrateDialog(page);
    await migrateTo(page, targetTag).click();
    await expect(reopened).toHaveCount(0);
    await expectSaveStatus(page, "Saved");
  });

  test("a newer schema (the recipe's schemaVersion) is refused with the version it needs", async ({ page }) => {
    const recipe = recipeProject("GovernedVault", { name: "NewerSchema" }).recipe;
    const newer = { ...recipe, schemaVersion: 2 } as unknown as Recipe;
    const link = shareLink(newer);

    await page.goto(`/${link}`);
    await expectProject(page, "Untitled");
    await expectLogLine(page, "This link needs Studio schema v2. This Studio reads v1.");
  });

  test("a newer share-link format version is refused with the version it needs @smoke", async ({ page }) => {
    const recipe = recipeProject("GovernedVault", { name: "NewerFormat" }).recipe;
    const link = shareLink(recipe).replace(/^#s=1\./, "#s=2.");

    await page.goto(`/${link}`);
    await expectProject(page, "Untitled");
    await expectLogLine(page, "This link needs Studio share format v2. This Studio reads v1. Open it in the latest Studio.");
  });
});

/**
 * Interpretations
 *
 * 1. The catalog tag this e2e build serves is "dev-6c8db45" (`catalog/manifest.json`'s default entry), not the
 *    spec's illustrative "0.4.1"/"0.4.0" or the brief's stated "0.2.0" (stale by the time this ran): every tag
 *    and hash assertion above reads `_support/catalog.ts`'s `catalog()` at run time instead of hardcoding one.
 *    Flagged as a Follow-up: the brief's catalog-tag note should be dropped or read live in future briefs.
 *
 * 2. "Confirm addresses…" stepping through "every LINK-01 field one at a time": this build's catalog has only
 *    one loadable v1 template with an authority-marked address literal once filled (SafeDiamondCut's
 *    `steps[0].safe`; GovernedVault's only address argument, `p.asset`, isn't authority-marked, and ERC20 has
 *    none). So the multi-address "Next address" path (`items.length > 1`) can't be exercised with a real
 *    recipe from this build; the spec above exercises the one-address case fully (heading, "Address 1 of 1",
 *    the full un-truncated address, Confirm address, and the terminal "Every address … is confirmed." line)
 *    and asserts "Next address" is absent. A synthetic two-item case belongs to S13's own component test
 *    (`ConfirmAddressesView.browser.test.tsx`), not an e2e recipe that has to parse and analyze for real.
 *
 * 3. "A link naming a catalog this build doesn't bundle": built by taking a real, valid recipe (from
 *    `recipeProject`, which round-trips it through `parseProject` against the real catalog) and then
 *    overwriting only its extracted `recipe.catalog` field with a hash `parseRecipe` proves it accepts for an
 *    unrecognized catalog (`packages/core/src/canonical/parse.test.ts`, "a catalog this build doesn't bundle").
 *    No bypass of `projectFor`'s validation was needed: the mutation happens on the plain `Recipe` object
 *    after `recipeProject` has already validated the real one, and the link is built from that recipe with
 *    the ordinary `shareLink()`/`encodeShareLink()`.
 *
 * 4. `syncReadOnly` opens the Migrate dialog itself the first time a project resolves "unbundled" (IR L178:
 *    "opening an old project or link"), so "a link naming a catalog this build doesn't bundle opens read-only
 *    with Migrate to {tag}…" is observed as that dialog already being open after the link loads, not as a
 *    banner click; the banner and its own "Migrate to {tag}…" action are asserted separately, once the dialog
 *    is dismissed with Keep read-only (the dialog only auto-opens once per project, per `controller.offered`).
 *    "Read-only" here is asserted on the project name button's accessible description (`UNBUNDLED`), not the
 *    title bar's save status: `persist/persistence.ts`'s save status only turns "Read-only" for the edit-lock
 *    reasons (`ELSEWHERE`, `HANDED_OVER`); an unbundled catalog blocks editing commands (and is banner-shown)
 *    without changing what the save status itself reports, since there's nothing left unsaved by it. This
 *    e2e-discovered fact would be worth confirming with S13/S7a and, if intended, noting next to
 *    `readOnlyReason` for the next agent who reads it expecting one save-status story for every read-only
 *    reason.
 *
 * 5. "A newer schema is refused with the version it needs" (spec L505) is tested against the recipe's own
 *    `schemaVersion` field (`parseRecipe`'s check, message "This link needs Studio schema v2…"), which is what
 *    "schema" names in the spec and in `formatParseIssue`'s tests. The share-link fragment's own wrapper
 *    version (`#s=N.`, a different, lower-level format than the recipe schema) is asserted too, tagged
 *    `@smoke`, since both are real "refused, newer version" paths a person could hit and the wording differs
 *    ("Studio schema" vs "Studio share format").
 *
 * 6. Narrow widths (768, 375): only Share's own control relocates for this flow, into the title bar's overflow
 *    "More" menu (`clickShare`, confirmed by both narrow describes' `expectTier` + overflow-menu tests passing
 *    at both widths). One more thing changes shape there, found empirically rather than read in advance: below
 *    1024 px the Console drawer starts collapsed ("Expand console" in the accessibility snapshot), so a "Link
 *    copied · N characters" line lands in it exactly as `_support/README.md` says every toast does, but
 *    `getByRole("log")` finds nothing until the drawer opens. `expectLinkCopied` reads the toast itself
 *    (`role="dialog"`, its name is the message) instead, which is visible at every width and needs no drawer
 *    state. Opening a link, Confirm addresses and Migrate are Inspector/dialog content this spec never drove
 *    narrow: the Inspector's narrow-tier drawer isn't a region this WP builds page objects for, and nothing
 *    in `commands.ts` or `ConfirmAddressesView.tsx` suggested their behavior depends on viewport width, so this
 *    is a gap left open rather than a verified "nothing changes," and is worth a light pass by whichever WP
 *    does own the Inspector's narrow layout.
 *
 * 7. `parseProject`'s catalog-match behavior for the seeded "Everything" project (over-2,000-characters cases):
 *    that project is seeded directly (never round-tripped through a share link), so its `recipe.catalog` is
 *    the real, matching one throughout; only the *link-opening* tests (Interpretation 3) touch a foreign hash.
 *
 * Follow-up (Q0): `src/flows/open-link.ts` (and, more generally, any module reachable only through
 * `@/contracts`) can't be imported directly from a `.spec.ts` file: Playwright loads spec files under
 * Node/esbuild, not through Vite's build, so `src/contracts/env.ts`'s `import.meta.env.VITE_STUDIO_E2E` throws
 * ("Cannot read properties of undefined") the moment such a module is evaluated, and the whole run reports
 * "No tests found." `src/flows/copy.ts` is safe (pure, no runtime imports); `open-link.ts` isn't, because it
 * imports `@/contracts` for its other exports. This spec works around it by mirroring `sharedName` locally
 * instead of importing it. Worth a documented rule in `_support/README.md`'s "app source" guidance, or a
 * `@lattice-studio/core`-style pure re-export for the handful of pure helpers (`sharedName`, `tidiedLayout`'s
 * shape) that currently live only in files with side-effecting imports.
 */
