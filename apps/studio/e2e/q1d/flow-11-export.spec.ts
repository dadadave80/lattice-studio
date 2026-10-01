/**
 * Flow 11, Export (spec L507-L528; IR L132 console header, L157 console verbs, L180 Safe batch dialog): the
 * same exits from the Export menu, the palette and the console command line — Foundry script, Agent brief,
 * Recipe JSON, Project file (S7b's `project.exportFile`), Safe batch and Image (v1.1, always disabled).
 *
 * `zeroAckGovernedVault` builds a zero-blocker, zero-acknowledgement fixture offline: it overrides every field
 * INIT-05 flags as an unchanged example on the GovernedVault template (`overlay/inits/defi.yaml`'s `name`,
 * `symbol`, `decimalsOffset`, `minDelay`, `votingDelay`, `votingPeriod`, `proposalThreshold`, `quorumNumerator`)
 * with a different, still-valid value, and lets `fillMissingArgs` fill the one field the template leaves empty
 * (`asset`, which only carries an online `code(token)` rule — never checked without a chain). Verified once
 * against core's own `analyze` before writing this file (recorded in the WP report): zero blockers, zero
 * `severity: "warning"` problems at all, so Safe batch's enablement (`safeExportable`, which on top of
 * `deployableExport` requires every ack-eligible warning ticked for this recipe hash) needs nothing ticked —
 * the deploy review's acknowledgement flow (WP-S8b) is out of this spec's reach either way.
 */
import type { Download, Locator, Page } from "@playwright/test";
import { analyze, importFile, loadTemplate, lines, normalizeRecipe, recipeHash, toChecksum, type Recipe } from "@lattice-studio/core";
import { fillMissingArgs } from "@lattice-studio/core/testing";
import { expect, test } from "../_support/fixtures.ts";
import { SAFE } from "../_support/anvil.ts";
import { catalog } from "../_support/catalog.ts";
import { projectFor, recipeProject } from "../_support/projects.ts";
import { openEmpty, seedProject } from "../_support/seed.ts";
import { region, runConsole } from "../_support/keys.ts";
import { NARROW_WIDTHS, tierAt, viewportAt, expectTier } from "../_support/viewports.ts";
import { blockerCount, PLACE_FACETS_FIRST, resolveToExport } from "../../src/panels/console/export-enablement.ts";
import { console_, expectLogLine, openExportMenu, openExportMenuByKeyboard } from "./pages/console.ts";
import { disableFileSystemAccess } from "./pages/file-system-access.ts";
import { runInPalette } from "./pages/keys.ts";
import { openOverflowMenu } from "./pages/shell.ts";
import * as safeBatch from "./pages/safe-batch-dialog.ts";

/**
 * An Export menu item by its exact label. `console.ts`'s own `exportItem` matches substrings ("Agent brief"
 * also matches "Copy agent brief"), which this spec needs disambiguated.
 */
function exportItem(menu: Locator, label: string): Locator {
  return menu.getByRole("menuitem", { name: label, exact: true });
}

/** GovernedVault with every INIT-05 example field changed, so nothing needs acknowledging (see the file header). */
function zeroAckGovernedVault(from = catalog()): Recipe {
  const loaded = loadTemplate(from, "GovernedVault");
  if (!loaded.ok) throw new Error(loaded.error);
  const filled = fillMissingArgs(loaded.value, from);
  if (filled.init.kind !== "bundle") throw new Error("GovernedVault's init should be a bundle");
  const p = filled.init.args["p"];
  if (p === undefined || typeof p !== "object" || Array.isArray(p) || "$ref" in p) throw new Error("p should be a struct");
  return {
    ...filled,
    init: {
      ...filled.init,
      args: {
        ...filled.init.args,
        p: {
          ...p,
          name: "E2E vault",
          symbol: "E2EV",
          decimalsOffset: "1",
          minDelay: "600",
          votingDelay: "120",
          votingPeriod: "1200",
          proposalThreshold: "1",
          quorumNumerator: "10",
        },
      },
    },
  };
}

/** A project with zero blockers and zero acknowledgements to tick: every export is reachable. */
function deployableProject(name: string) {
  return projectFor(zeroAckGovernedVault(), name);
}

/** GovernedVault as Flow 2 loads it: `asset` is missing, an INIT-01 blocker. */
function blockedProject(name: string) {
  return recipeProject("GovernedVault", { name });
}

/** The reason Foundry script and Safe batch give for `project`'s current blockers. */
function blockedReason(project: ReturnType<typeof blockedProject>): string {
  return resolveToExport(blockerCount(analyze(project.recipe, catalog())));
}

/** A download's text, read as a stream (works the same on Chromium and WebKit; no reliance on a saved path). */
async function downloadText(download: Download): Promise<string> {
  const stream = await download.createReadStream();
  if (!stream) throw new Error(`${download.suggestedFilename()} produced no readable stream.`);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * A toast by its text, scoped to the Notifications region (`ToastRegion.tsx`): a plain `page.getByText` can
 * also match the console log's own persistent live region, which repeats a copy's text for screen readers.
 */
function toast(page: Page, text: string | RegExp): Locator {
  return region(page, "Notifications").getByText(text);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A code tab's blocker banner by its exact text (`Banner.tsx` renders it in a `<p>`, same convention
 * `pages/banners.ts` uses): a plain `getByText` also matches the hidden reason span on the tab's own
 * disabled Copy and Download buttons, which carry the identical text for their tooltip and description.
 */
function codeBanner(page: Page, text: string): Locator {
  return console_(page).locator("p").filter({ hasText: new RegExp(`^${escapeRegExp(text)}$`) });
}

test.describe("Export menu: item labels and enabled state (spec L507-L521)", () => {
  test("empty sheet: Foundry script and Safe batch need facets first; the brief, JSON and project file are always available; Image never is", async ({ page }) => {
    await openEmpty(page);
    const menu = await openExportMenu(page);
    await expect(exportItem(menu, "Foundry script")).toHaveAccessibleDescription(PLACE_FACETS_FIRST);
    await expect(exportItem(menu, "Safe batch…")).toHaveAccessibleDescription(PLACE_FACETS_FIRST);
    await expect(exportItem(menu, "Agent brief")).not.toHaveAttribute("aria-disabled", "true");
    await expect(exportItem(menu, "Recipe JSON")).not.toHaveAttribute("aria-disabled", "true");
    await expect(exportItem(menu, "Project file")).not.toHaveAttribute("aria-disabled", "true");
    await expect(exportItem(menu, "Image")).toHaveAccessibleDescription("Arrives in v1.1");
  });

  test("a recipe with blockers: Foundry script and Safe batch read 'Resolve n blockers to export · F8'", async ({ page }) => {
    const project = blockedProject("BlockedMenuVault");
    const reason = blockedReason(project);
    await seedProject(page, { project });
    const menu = await openExportMenu(page);
    await expect(exportItem(menu, "Foundry script")).toHaveAccessibleDescription(reason);
    await expect(exportItem(menu, "Safe batch…")).toHaveAccessibleDescription(reason);
    await expect(exportItem(menu, "Agent brief")).not.toHaveAttribute("aria-disabled", "true");
  });

  test("a clean recipe: every export but Image is enabled, Safe batch included with nothing to acknowledge", async ({ page }) => {
    const project = deployableProject("CleanMenuVault");
    await seedProject(page, { project });
    const menu = await openExportMenu(page);
    for (const label of ["Foundry script", "Agent brief", "Recipe JSON", "Project file", "Safe batch…"]) {
      await expect(exportItem(menu, label)).not.toHaveAttribute("aria-disabled", "true");
    }
    await expect(exportItem(menu, "Image")).toHaveAccessibleDescription("Arrives in v1.1");
  });

  test("keyboard-only: Tab to the Export button, Enter opens it, the same states show", async ({ page }) => {
    const project = blockedProject("KeyboardMenuVault");
    const reason = blockedReason(project);
    await seedProject(page, { project });
    const menu = await openExportMenuByKeyboard(page);
    await expect(exportItem(menu, "Foundry script")).toHaveAccessibleDescription(reason);
    await expect(exportItem(menu, "Agent brief")).not.toHaveAttribute("aria-disabled", "true");
  });
});

test.describe("Foundry script (spec L513, L520-L528)", () => {
  test("export foundry: downloads standalone Solidity naming the recipe hash and the run command @smoke", async ({ page }) => {
    const project = deployableProject("FoundryVault");
    const hash = recipeHash(project.recipe, catalog());
    await seedProject(page, { project });

    // `export foundry` only opens the maximized Script tab (`definitions.ts`'s run body); Download is the tab's
    // own button.
    await runConsole(page, "export foundry");
    await expect(page.getByRole("tab", { name: "Script" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("button", { name: "Restore console" })).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      console_(page).getByRole("button", { name: "Download" }).click(),
    ]);
    const text = await downloadText(download);
    expect(download.suggestedFilename()).toMatch(/^Deploy.*\.s\.sol$/);
    expect(text).toContain(`Recipe hash: ${hash}`);
    expect(text).toContain(`forge script ${download.suggestedFilename()} --rpc-url $RPC_URL --account deployer --broadcast`);
    expect(text).toContain("// SPDX-License-Identifier: MIT");
    // The Log tab (`role="log"`) unmounts from the accessibility tree while the Script tab is active
    // (`ConsoleBody.tsx`'s panels aren't all `keepMounted`); switch back to read the line it logged.
    await console_(page).getByRole("tab", { name: "Log" }).click();
    const line = lines.exported({ filename: download.suggestedFilename(), recipeHash: hash });
    await expectLogLine(page, line.text);
  });

  test("Foundry script: opening the Script tab maximizes the console; Copy copies the same text", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const project = deployableProject("FoundryCopyVault");
    await seedProject(page, { project });
    const menu = await openExportMenu(page);
    await exportItem(menu, "Foundry script").click();
    await expect(page.getByRole("tab", { name: "Script" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("button", { name: "Restore console" })).toBeVisible();

    const filename = await console_(page).getByText(/^Deploy.*\.s\.sol$/).first().textContent();
    await console_(page).getByRole("button", { name: "Copy" }).click();
    if (filename) await expect(toast(page, `Copied ${filename.trim()}`)).toBeVisible();
  });

  test("a recipe with blockers: the Script tab reads the same 'Resolve n blockers' banner", async ({ page }) => {
    const project = blockedProject("BlockedFoundryVault");
    const reason = blockedReason(project);
    await seedProject(page, { project });
    const menu = await openExportMenu(page);
    await expect(exportItem(menu, "Foundry script")).toHaveAccessibleDescription(reason);
    await page.keyboard.press("Escape");
    // The command itself won't run while disabled (IR "a disabled item is focusable, inert"), so the banner is
    // reached instead through the Script tab directly, over whatever the console last generated.
    await console_(page).getByRole("tab", { name: "Script" }).click();
    await expect(codeBanner(page, reason)).toBeVisible();
  });

  test("keyboard-only: export foundry, then Tab/Enter to Download", async ({ page }) => {
    const project = deployableProject("FoundryKeyboardVault");
    const hash = recipeHash(project.recipe, catalog());
    await seedProject(page, { project });
    await runConsole(page, "export foundry");
    await expect(page.getByRole("tab", { name: "Script" })).toHaveAttribute("aria-selected", "true");
    // Stabilizes under load (known flaky at 6 workers, ledger L449): `.focus()` doesn't wait for the tab's
    // maximize transition or the script to finish generating the way `.click()` does, so under load it could
    // focus (or not) a Download button that's still `aria-disabled`, or one about to re-render. Waiting for
    // the console to finish maximizing and the button to become usable (matching the pointer test above)
    // before focusing it removes the race.
    await expect(page.getByRole("button", { name: "Restore console" })).toBeVisible();
    const downloadButton = console_(page).getByRole("button", { name: "Download" });
    await expect(downloadButton).not.toHaveAttribute("aria-disabled", "true");
    await downloadButton.focus();
    await expect(downloadButton).toBeFocused();
    const [download] = await Promise.all([page.waitForEvent("download"), page.keyboard.press("Enter")]);
    const text = await downloadText(download);
    expect(text).toContain(`Recipe hash: ${hash}`);
  });
});

test.describe("Agent brief (spec L514, L920-L923)", () => {
  test("export brief: downloads a self-contained .brief.md with the cut plan, init plan, authority table, problems and acceptance checks @smoke", async ({ page }) => {
    const project = deployableProject("BriefVault");
    const hash = recipeHash(project.recipe, catalog());
    await seedProject(page, { project });

    const [download] = await Promise.all([page.waitForEvent("download"), runConsole(page, "export brief")]);
    expect(download.suggestedFilename()).toMatch(/\.brief\.md$/);
    const text = await downloadText(download);
    expect(text).toContain(`Recipe hash: \`${hash}\``);
    expect(text).toContain("- Studio:");
    expect(text).toContain("## Cut plan");
    expect(text).toContain("## Init plan");
    expect(text).toContain("## Authority table");
    expect(text).toContain("## Open problems");
    expect(text).toContain("## Acceptance checks");
    // Spec L923's exact acceptance command and closing line.
    expect(text).toContain('cast call <diamond> "facets()((address,bytes4[])[])" --rpc-url $RPC_URL');
    expect(text).toContain("Do not redeploy facets; check their codehashes.");

    const line = lines.exported({ filename: download.suggestedFilename(), recipeHash: hash });
    await expectLogLine(page, line.text);
  });

  test("Copy agent brief copies the same text (contracts §6's copy helper)", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const project = deployableProject("BriefCopyVault");
    await seedProject(page, { project });
    const menu = await openExportMenu(page);
    await menu.getByRole("menuitem", { name: "Copy agent brief" }).click();
    await expect(toast(page, /^Copied .*\.brief\.md$/)).toBeVisible();
  });

  test("an empty sheet: the brief is still available (spec L514 'Always')", async ({ page }) => {
    await openEmpty(page);
    const [download] = await Promise.all([page.waitForEvent("download"), runConsole(page, "export brief")]);
    const text = await downloadText(download);
    // Nothing placed, yet the core is cut: its two Adds lead the plan.
    expect(text).toContain("- Facets: DiamondLoupeFacet 0.2.0, ERC165Facet 0.2.0");
    const plan = text.slice(text.indexOf("## Cut plan"));
    expect(plan).toContain("DiamondLoupeFacet");
    expect(plan).toContain("ERC165Facet");
    expect(text).not.toContain("No cuts");
  });
});

test.describe("Recipe JSON (spec L515, L920)", () => {
  test("export json: opens the tab; Download gives recipe.json with $schema and the recipe's facets, leaving out layout and deployments @smoke", async ({ page }) => {
    const project = deployableProject("JsonVault");
    const normalized = normalizeRecipe(project.recipe, catalog());
    await seedProject(page, { project });

    // `export json` only opens the Recipe JSON tab (`definitions.ts`'s run body); Download is the tab's own
    // button.
    await runConsole(page, "export json");
    await expect(page.getByRole("tab", { name: "Recipe JSON" })).toHaveAttribute("aria-selected", "true");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      console_(page).getByRole("button", { name: "Download" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("recipe.json");

    const text = await downloadText(download);
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(typeof parsed["$schema"]).toBe("string");
    expect(parsed["facets"]).toEqual(normalized.facets);
    expect(parsed).not.toHaveProperty("layout");
    expect(parsed).not.toHaveProperty("deploy");
    expect(parsed).not.toHaveProperty("deployments");
  });

  test("Copy in the Recipe JSON tab copies the same recipe.json", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const project = deployableProject("JsonCopyVault");
    await seedProject(page, { project });
    const menu = await openExportMenu(page);
    await exportItem(menu, "Recipe JSON").click();
    await console_(page).getByRole("button", { name: "Copy" }).click();
    await expect(toast(page, "Copied recipe.json")).toBeVisible();
  });
});

test.describe("Project file (spec L502, L516; S7b's project.exportFile)", () => {
  test("Project file opens Save a copy…; downloading gives a .lattice.json that round-trips through importFile", async ({ page }) => {
    await disableFileSystemAccess(page.context());
    const project = deployableProject("ProjectFileVault");
    await seedProject(page, { project });

    const menu = await openExportMenu(page);
    await exportItem(menu, "Project file").click();
    const dialog = page.getByRole("dialog", { name: "Save a copy" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("File name")).toHaveValue(/\.lattice\.json$/);
    // Ruling R6: the dialog states the recipe hash, catalog tag and Studio version (the .lattice.json body
    // itself is checked below to stay exactly what core writes).
    const hash = recipeHash(project.recipe, catalog());
    await expect(dialog.getByText(hash.slice(0, 6), { exact: false })).toBeVisible();
    await expect(dialog.getByText(`catalog Lattice ${catalog().lattice.tag}`, { exact: false })).toBeVisible();
    await expect(dialog.getByText(/Studio \S+/)).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      dialog.getByRole("button", { name: "Save" }).click(),
    ]);
    await expect(dialog).toHaveCount(0);
    const text = await downloadText(download);
    const parsed = JSON.parse(text) as { project: unknown; deployments: unknown[] };
    expect(parsed).toHaveProperty("project");
    expect(parsed).toHaveProperty("deployments");

    const imported = importFile(text, download.suggestedFilename(), [catalog()]);
    if (!imported.ok) throw new Error(`${download.suggestedFilename()} doesn't import: ${JSON.stringify(imported.error)}`);
    if (imported.value.kind !== "project") throw new Error("Imports as a recipe, not a project.");
    expect(imported.value.project.recipe.facets).toEqual(project.recipe.facets);
  });
});

test.describe("Safe batch (spec L517, L580, IR L180)", () => {
  test("opens from the Export menu, rejects a malformed address with the exact reason, then downloads a Transaction Builder batch @smoke", async ({ page }) => {
    const project = deployableProject("SafeVault");
    const hash = recipeHash(project.recipe, catalog());
    await seedProject(page, { project });

    const menu = await openExportMenu(page);
    await exportItem(menu, "Safe batch…").click();
    await safeBatch.expectOpen(page);

    await safeBatch.fillSafeAddress(page, "not-an-address");
    await safeBatch.downloadBatchButton(page).click();
    await expect(safeBatch.safeAddressField(page)).toHaveAttribute("aria-invalid", "true");
    await expect(safeBatch.safeBatchDialog(page).getByText(safeBatch.NOT_AN_ADDRESS)).toBeVisible();

    await safeBatch.fillSafeAddress(page, SAFE);
    await safeBatch.chooseChain(page, "Sepolia");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      safeBatch.downloadBatchButton(page).click(),
    ]);
    await safeBatch.expectClosed(page);
    expect(download.suggestedFilename()).toMatch(/\.safe\.json$/);

    const text = await downloadText(download);
    const batch = JSON.parse(text) as {
      version: string;
      chainId: string;
      transactions: { to: string; value: string; data?: string }[];
      meta: { checksum?: string; createdFromSafeAddress?: string };
    };
    expect(batch.version).toBe("1.0");
    expect(batch.chainId).toBe("11155111");
    expect(batch.transactions).toHaveLength(1);
    expect(typeof batch.transactions[0]?.value).toBe("string");
    expect(batch.meta.checksum).toBeTruthy();
    expect(batch.meta.createdFromSafeAddress).toBe(toChecksum(SAFE));

    const line = lines.exported({ filename: download.suggestedFilename(), recipeHash: hash });
    await expectLogLine(page, line.text);
  });

  test("`export safe` with no arguments opens the dialog; with a Safe address and chain it skips the dialog entirely (keyboard only)", async ({ page }) => {
    const project = deployableProject("SafeConsoleVault");
    await seedProject(page, { project });

    await runConsole(page, "export safe");
    await safeBatch.expectOpen(page);
    await page.keyboard.press("Escape");
    await safeBatch.expectClosed(page);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      runConsole(page, `export safe ${SAFE} sepolia`),
    ]);
    await safeBatch.expectClosed(page);
    expect(download.suggestedFilename()).toMatch(/\.safe\.json$/);
    const batch = JSON.parse(await downloadText(download)) as { chainId: string };
    expect(batch.chainId).toBe("11155111");
  });

  test("keyboard-only: fills the Safe address and chooses the chain without a pointer", async ({ page }) => {
    const project = deployableProject("SafeKeyboardVault");
    await seedProject(page, { project });
    await runConsole(page, "export safe");
    await safeBatch.expectOpen(page);
    await safeBatch.fillSafeAddress(page, SAFE);
    await safeBatch.chooseChainByKeyboard(page, "Sepolia");
    await safeBatch.downloadBatchButton(page).focus();
    const [download] = await Promise.all([page.waitForEvent("download"), page.keyboard.press("Enter")]);
    await safeBatch.expectClosed(page);
    expect(download.suggestedFilename()).toMatch(/\.safe\.json$/);
  });

  test("a recipe with blockers: Safe batch reads the same 'Resolve n blockers' reason as Foundry script", async ({ page }) => {
    const project = blockedProject("BlockedSafeVault");
    const reason = blockedReason(project);
    await seedProject(page, { project });
    const menu = await openExportMenu(page);
    await expect(exportItem(menu, "Safe batch…")).toHaveAccessibleDescription(reason);
  });
});

test.describe("Image (v1.1)", () => {
  test("is always disabled, with the exact reason (spec L521)", async ({ page }) => {
    const project = deployableProject("ImageVault");
    await seedProject(page, { project });
    const menu = await openExportMenu(page);
    const image = exportItem(menu, "Image");
    await expect(image).toHaveAttribute("aria-disabled", "true");
    await expect(image).toHaveAccessibleDescription("Arrives in v1.1");
  });
});

test.describe("The command palette reaches the same exports", () => {
  test("Export agent brief and Export recipe JSON run from the command palette (keyboard only)", async ({ page }) => {
    const project = deployableProject("PaletteVault");
    await seedProject(page, { project });

    const [briefDownload] = await Promise.all([page.waitForEvent("download"), runInPalette(page, "Export agent brief")]);
    expect(briefDownload.suggestedFilename()).toMatch(/\.brief\.md$/);

    // The command only opens the tab; Download is the tab's own button (`definitions.ts`'s run body).
    await runInPalette(page, "Export recipe JSON");
    await expect(page.getByRole("tab", { name: "Recipe JSON" })).toHaveAttribute("aria-selected", "true");
    const [jsonDownload] = await Promise.all([
      page.waitForEvent("download"),
      console_(page).getByRole("button", { name: "Download" }).click(),
    ]);
    expect(jsonDownload.suggestedFilename()).toBe("recipe.json");
  });
});

test.describe("Narrow layouts (IR: Export moves with the title bar's tier)", () => {
  for (const width of NARROW_WIDTHS) {
    test.describe(`at ${width} px`, () => {
      test.use({ viewport: viewportAt(width) });

      test(`an export still works through the ${tierAt(width)} tier's path`, async ({ page }) => {
        const project = deployableProject(`NarrowVault${width}`);
        await seedProject(page, { project });
        await expectTier(page, tierAt(width));

        if (tierAt(width) === "phone") {
          // Phone (375 px): the console is a switcher pane of its own and starts on Sheet (`panes.narrow`
          // defaults to "sheet"), so the console header's own Export button isn't in the accessibility tree
          // until Console is shown. The title bar's More menu reaches Export directly instead
          // (`OverflowMenu.tsx`: `partial={!phone}`, so `phone` gets the full menu, Export submenu included).
          const more = await openOverflowMenu(page);
          await more.getByRole("menuitem", { name: "Export" }).click();
          const submenu = page.getByRole("menu", { name: "Export" });
          await expect(submenu).toBeVisible();
          const [download] = await Promise.all([
            page.waitForEvent("download"),
            submenu.getByRole("menuitem", { name: "Agent brief" }).click(),
          ]);
          expect(download.suggestedFilename()).toMatch(/\.brief\.md$/);
        } else {
          // Narrow (768 px): only the left and inspector panes become drawers; the console (and its header's
          // Export button) stays exactly where it is at every wider tier, so no overflow path is needed, and
          // the More menu carries no Export submenu at all (`OverflowMenu.tsx`'s `partial={!phone}`).
          const more = await openOverflowMenu(page);
          await expect(more.getByRole("menuitem", { name: "Export" })).toHaveCount(0);
          await page.keyboard.press("Escape");
          const menu = await openExportMenu(page);
          const [download] = await Promise.all([
            page.waitForEvent("download"),
            exportItem(menu, "Agent brief").click(),
          ]);
          expect(download.suggestedFilename()).toMatch(/\.brief\.md$/);
        }
      });
    });
  }
});
