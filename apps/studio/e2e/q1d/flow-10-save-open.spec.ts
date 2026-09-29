/**
 * Flow 10 steps 1-5, "Save, open and share" (spec L496-L502): autosave, ⌘/Ctrl+S and Save a copy…, persistent
 * storage and the Safari tip, Open (⌘/Ctrl+O, the App menu, dropping a file), and the Projects dialog (Recent,
 * Recently deleted, Delete for good, Clear data). Flow 10 steps 6-8 (Share, opening a link, two tabs) and Flow
 * 11 (Export) belong to the other Q1d helpers' spec files.
 *
 * Interpretations:
 * - The File System Access API is real in this Chromium build (env fact #2), so every Save/Open test installs
 *   `disableFileSystemAccess` or `stubSaveFilePicker` via `context.addInitScript` before the first navigation,
 *   never leaving the real native picker to open (it would hang the test).
 * - "The browser's own Save Page never fires" (spec L497) has no positive Playwright assertion for a native
 *   browser feature that isn't part of the page; every ⌘S test instead proves Studio's own handler ran (its
 *   dialog opened, or its download/write happened), which is the only observable half of that claim.
 * - The catalog tag this build bundles isn't the spec's illustrative "0.4.0"/"0.4.1" (env fact #3): the bad-file
 *   test computes the expected error with core's own `importFile`/`formatParseIssue` against the real built
 *   catalog, rather than hardcoding the spec's example numbers or facet name.
 * - The Safari tip (spec L500) is gated only by `isSafari(userAgent)` (`persistence.ts`), which reads the
 *   string, not the engine: overriding the browser context's `userAgent` forces and clears the real code path
 *   deterministically on `chromium`, and it also fires for real on `webkit-smoke` (a genuine Safari UA) - the
 *   persist-spy test is chromium-only because WebKit has no `navigator.storage.persist`.
 * - Clear data's "including the only record of N deployed addresses" branch uses the same `plural`/counting
 *   pattern Delete for good's does (spec L502); to keep this file from ballooning, only Delete for good covers
 *   both count branches, and Clear data covers the no-deployments branch plus Export first's download fan-out.
 * - Narrow widths (768, 375 px): the only Flow 10 control that relocates there is the title bar's save status,
 *   which TitleBar.tsx hides outright below 1024 px while "Saved" (`showSave`, spec L353-L370 territory, not
 *   Flow 10's own words). Save a copy, Open and the Projects dialog don't reflow further at these widths (they
 *   already run at `size="wide"` regardless of viewport), so no other narrow variant is written for this slice.
 */
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { exportProjectFile, formatParseIssue, importFile, plural, type Recipe } from "@lattice-studio/core";
import { expect, test } from "../_support/fixtures.ts";
import { catalog } from "../_support/catalog.ts";
import { deploymentFor, filePayload, projectFile, recipeProject } from "../_support/projects.ts";
import { expectProject, openEmpty, seedProject, storeProject } from "../_support/seed.ts";
import { tierAt, viewportAt, expectTier } from "../_support/viewports.ts";
import { region } from "../_support/keys.ts";
import { banner } from "./pages/banners.ts";
import { expectLogLine, log } from "./pages/console.ts";
import { disableFileSystemAccess, fakeSaveContents, stubSaveFilePicker } from "./pages/file-system-access.ts";
import { pressOpen, pressSave, runInPalette } from "./pages/keys.ts";
import {
  clearDataCancelButton, clearDataDialog, clearDataExportFirstButton, clickClearData, clickDeleteForGood,
  confirmClearData, confirmDeleteForGood, deleteForGoodCancelButton, deleteForGoodDialog,
  deleteForGoodExportFirstButton, deleteRow, duplicateRow, exportRow, openProjectRow, openProjectsDialog, projectRow,
  recentTab, renameRow, restoreTrashRow, rowNameButton, rowStatusChip, startRenameRow, switchToTab, trashRow,
} from "./pages/projects-dialog.ts";
import { clickCancel, clickSave, expectSaveCopyDialog, fileName, fileNameField, saveCopyDialog, submitWithEnter } from "./pages/save-copy-dialog.ts";
import { appMenuItem, expectSaveStatus, openAppMenu, saveStatusButton, titleBar } from "./pages/shell.ts";

const SAFARI_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const SAFARI_TIP = "Safari can clear site data after 7 days without a visit, so keep a file copy.";

/** A GovernedVault project under its own name, so every test's rows and files stay distinct. */
function vault(name: string, opts: { filled?: boolean } = {}) {
  return recipeProject("GovernedVault", { name, filled: opts.filled ?? true });
}

/** The title bar's project name button (its accessible name is the project's own name, `ProjectName.tsx`). */
function projectNameButton(page: Page, name: string) {
  return titleBar(page).getByRole("button", { name, exact: true });
}

/** Renames the open project in place from the title bar (pointer path): click, type, Enter commits. */
async function renameInPlace(page: Page, from: string, to: string): Promise<void> {
  await projectNameButton(page, from).click();
  const input = titleBar(page).getByRole("textbox", { name: "Project name" });
  await input.fill(to);
  await input.press("Enter");
}

/** Renames the open project in place from the title bar, keyboard-only: focus, Enter opens the field. */
async function renameInPlaceByKeyboard(page: Page, from: string, to: string): Promise<void> {
  await projectNameButton(page, from).focus();
  await page.keyboard.press("Enter");
  const input = titleBar(page).getByRole("textbox", { name: "Project name" });
  await expect(input).toBeFocused();
  await input.fill(to);
  await input.press("Enter");
}

/** Dispatches a synthetic `drop` with one file, exactly as `file-drop.ts`'s `installFileDrop(window)` expects. */
async function dropFileOnWindow(page: Page, file: { filename: string; text: string }): Promise<void> {
  await page.evaluate(({ filename, text }) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([text], filename, { type: "application/json" }));
    window.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, file);
}

/** Reads a completed download's text content from disk. */
async function downloadText(download: { path(): Promise<string | null> }): Promise<string> {
  const path = await download.path();
  if (!path) throw new Error("The download has no local path (was it saved with acceptDownloads off?).");
  return readFileSync(path, "utf8");
}

test.describe("Flow 10 step 1: autosave (spec L497)", () => {
  test("the status settles on Saved after a change (Saving… while the debounce and write are pending)", async ({ page }) => {
    const project = vault("AutosaveVault");
    await seedProject(page, { project });
    await expectSaveStatus(page, "Saved");

    // A document edit (renaming in the title bar) dirties the doc: the status flips to "Saving…" at once
    // (persistence.ts's `schedule()` sets the debounce timer synchronously, and `computeStatus` reads a
    // pending timer as "Saving…"), then back to "Saved" once the 750 ms debounce and the write both finish.
    await renameInPlace(page, "AutosaveVault", "AutosaveVault Renamed");
    await expectSaveStatus(page, "Saving…");
    await expectSaveStatus(page, "Saved");
  });

  test("an explicit save toasts \"Saved to {filename}\" as its one console line (spec L497, L733)", async ({
    page,
    context,
  }) => {
    await disableFileSystemAccess(context);
    const project = vault("AutosaveExplicitVault");
    await seedProject(page, { project });
    const filename = exportProjectFile(project, []).filename;

    const download = page.waitForEvent("download");
    await pressSave(page);
    await expectSaveCopyDialog(page);
    await clickSave(page);
    await download;

    const text = `Saved to ${filename}`;
    await expectLogLine(page, text);
    await expect(region(page, "Notifications").getByText(text, { exact: true })).toBeVisible();
    // One line per toast (spec L733): the toast's own log line, not a second, separately-worded one.
    await expect(log(page).getByText(text, { exact: true })).toHaveCount(1);
  });
});

test.describe("Flow 10 step 2: Ctrl/Cmd+S and Save a copy, File System Access off (spec L497)", () => {
  test.beforeEach(async ({ context }) => {
    await disableFileSystemAccess(context);
  });

  test("Ctrl/Cmd+S with nothing linked opens Save a copy, pre-filled with the project's export filename", async ({ page }) => {
    const project = vault("PromptedVault");
    await seedProject(page, { project });
    const expectedName = exportProjectFile(project, []).filename;

    await pressSave(page);
    await expectSaveCopyDialog(page);
    await expect(fileNameField(page)).toHaveValue(expectedName);
    await expect(fileNameField(page)).toBeFocused();
  });

  test("the App menu's Save a copy… opens the same dialog", async ({ page }) => {
    const project = vault("MenuSaveCopyVault");
    await seedProject(page, { project });
    const menu = await openAppMenu(page);
    await appMenuItem(menu, "Save a copy…").click();
    await expectSaveCopyDialog(page);
    await expect(fileNameField(page)).toHaveValue(exportProjectFile(project, []).filename);
  });

  test("Save a copy downloads the file, and its content is the project's own recipe @smoke", async ({ page }) => {
    const project = vault("DownloadedVault");
    await seedProject(page, { project });

    await pressSave(page);
    await expectSaveCopyDialog(page);
    const filename = await fileName(page);
    const download = page.waitForEvent("download");
    await clickSave(page);
    const file = await download;
    expect(file.suggestedFilename()).toBe(filename);

    const text = await downloadText(file);
    const parsed = JSON.parse(text) as { project: { id: string; name: string }; deployments: unknown[] };
    expect(parsed.project.id).toBe(project.id);
    expect(parsed.project.name).toBe("DownloadedVault");
    expect(parsed.deployments).toEqual([]);

    await expectLogLine(page, `Saved to ${filename}`);
  });

  test("Cancel closes Save a copy without saving anything", async ({ page }) => {
    const project = vault("CancelledSaveVault");
    await seedProject(page, { project });
    await pressSave(page);
    await expectSaveCopyDialog(page);
    await clickCancel(page);
    await expect(saveCopyDialog(page)).toHaveCount(0);
  });
});

test.describe("Flow 10 step 2: Ctrl/Cmd+S and Save a copy, File System Access stubbed (spec L497)", () => {
  test.beforeEach(async ({ context }) => {
    await stubSaveFilePicker(context);
  });

  test("Save a copy links the file; a second Ctrl/Cmd+S writes it directly and says \"Saved to {name}\" @smoke", async ({
    page,
  }) => {
    const project = vault("LinkedVault");
    await seedProject(page, { project });

    await pressSave(page);
    await expectSaveCopyDialog(page);
    const filename = await fileName(page);
    await clickSave(page);

    const firstWrite = await fakeSaveContents(page, filename);
    expect(firstWrite).not.toBeNull();
    const firstParsed = JSON.parse(firstWrite ?? "null") as { project: { id: string } };
    expect(firstParsed.project.id).toBe(project.id);
    await expectLogLine(page, `Saved to ${filename}`);

    // A second Ctrl/Cmd+S: the linked handle means no dialog opens this time, and it writes directly. One
    // console line per toast (spec L733) means the identical text repeats onto the same line (IR L134's ×n
    // collapse) rather than adding a second, differently-worded line the way the pre-logged duplicate did.
    await pressSave(page);
    await expect(saveCopyDialog(page)).toHaveCount(0);
    await expect(log(page).getByText(`Saved to ${filename}`)).toHaveCount(1);
    await expect(log(page).getByText("×2", { exact: false })).toBeVisible();
  });
});

test.describe("Flow 10 step 3: persistent storage and the Safari tip (spec L500)", () => {
  test("the first explicit save asks for persistent storage (navigator.storage.persist)", async ({ page, context }) => {
    test.skip(test.info().project.name !== "chromium", "navigator.storage.persist doesn't exist on WebKit.");
    await disableFileSystemAccess(context);
    await context.addInitScript(() => {
      const calls: string[] = [];
      (window as unknown as { __persistCalls: string[] }).__persistCalls = calls;
      const storage = navigator.storage as unknown as { persist?(): Promise<boolean>; persisted?(): Promise<boolean> };
      storage.persist = async () => {
        calls.push("persist");
        return true;
      };
      storage.persisted = async () => {
        calls.push("persisted");
        return true;
      };
    });

    const project = vault("PersistVault");
    await seedProject(page, { project });

    // First explicit save: asks for persistent storage once (`markExplicitSave`'s `first` branch).
    const download1 = page.waitForEvent("download");
    await pressSave(page);
    await expectSaveCopyDialog(page);
    await clickSave(page);
    await download1;
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __persistCalls: string[] }).__persistCalls))
      .toEqual(["persist"]);

    // A later explicit save checks `persisted()` instead, never asking again.
    const download2 = page.waitForEvent("download");
    await pressSave(page);
    await expectSaveCopyDialog(page);
    await clickSave(page);
    await download2;
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __persistCalls: string[] }).__persistCalls))
      .toEqual(["persist", "persisted"]);
  });

  test("Safari's one-time tip shows after the first explicit save on a Safari user agent", async ({
    page, context, browserName,
  }) => {
    await disableFileSystemAccess(context);
    // WebKit already reports a real Safari UA; Chromium is forced to one so the branch runs deterministically
    // there too (Interpretations, above): `isSafari` reads the string, and `pagePlatform`/Studio's own
    // `detectPlatform` still resolve from Client Hints first, so `pressSave` keeps working.
    if (browserName === "chromium") await context.addInitScript((ua: string) => {
      Object.defineProperty(navigator, "userAgent", { get: () => ua, configurable: true });
    }, SAFARI_UA);

    const project = vault("SafariTipVault");
    await seedProject(page, { project });
    await expect(banner(page, SAFARI_TIP)).toHaveCount(0);

    const download = page.waitForEvent("download");
    await pressSave(page);
    await expectSaveCopyDialog(page);
    await clickSave(page);
    await download;

    await expect(banner(page, SAFARI_TIP)).toBeVisible();
  });

  test("the tip never shows on a non-Safari user agent", async ({ page, context }) => {
    test.skip(test.info().project.name !== "chromium", "Only chromium's UA is guaranteed non-Safari here.");
    await disableFileSystemAccess(context);
    const project = vault("NoSafariTipVault");
    await seedProject(page, { project });

    const download = page.waitForEvent("download");
    await pressSave(page);
    await expectSaveCopyDialog(page);
    await clickSave(page);
    await download;

    await expect(banner(page, SAFARI_TIP)).toHaveCount(0);
  });
});

test.describe("Flow 10 step 4: Open (spec L501)", () => {
  test.beforeEach(async ({ context }) => {
    await disableFileSystemAccess(context);
  });

  test("the App menu's Open… opens a .lattice.json project file", async ({ page }) => {
    await openEmpty(page);
    const project = vault("MenuOpenedVault");
    const file = projectFile(project, []);

    const chooser = page.waitForEvent("filechooser");
    const menu = await openAppMenu(page);
    await appMenuItem(menu, "Open…").click();
    (await chooser).setFiles(filePayload(file));

    await expectProject(page, "MenuOpenedVault");
    await expectLogLine(page, `Opened MenuOpenedVault · ${plural(project.recipe.facets.length, "facet")}.`);
  });

  test("Ctrl/Cmd+O opens a .lattice.json project file, whose deployment record is marked From file", async ({ page }) => {
    await openEmpty(page);
    const project = vault("OpenedVault");
    const deployment = deploymentFor(project);
    const file = projectFile(project, [deployment]);

    const chooser = page.waitForEvent("filechooser");
    await pressOpen(page);
    (await chooser).setFiles(filePayload(file));

    await expectProject(page, "OpenedVault");
    await expectLogLine(page, `Opened OpenedVault · ${plural(project.recipe.facets.length, "facet")}.`);

    await runInPalette(page, "Show deployments");
    const row = region(page, "Inspector").locator(`[data-record="${deployment.chainId}:${deployment.address}"]`);
    await expect(row).toBeVisible();
    await expect(row).toContainText("From file");
  });

  test("dropping a file on the window opens it as a new project", async ({ page }) => {
    await openEmpty(page);
    // `loadTemplate` sets the recipe's own `name` to the template's display name ("ERC20"), so a plain
    // recipe.json dropped here opens under that name, not the filename's stem (`import-file.ts`'s
    // `recipe.name ?? stem(filename)`).
    const recipe: Recipe = recipeProject("ERC20").recipe;

    await dropFileOnWindow(page, { filename: "dropped-recipe.json", text: JSON.stringify(recipe) });

    await expectProject(page, "ERC20");
    await expectLogLine(page, `Opened ERC20 · ${plural(recipe.facets.length, "facet")}.`);
  });

  test("a bad file's error names the file and the reason (importFile/formatParseIssue against the real catalog)", async ({
    page,
  }) => {
    await openEmpty(page);
    const goodRecipe = recipeProject("GovernedVault").recipe;
    expect(goodRecipe.facets.length).toBeGreaterThan(0);
    const badRecipe: Recipe = { ...goodRecipe, facets: [...goodRecipe.facets] };
    badRecipe.facets[0] = "NotARealFacetName";
    const text = JSON.stringify(badRecipe);
    const filename = "recipe.json";

    const parsed = importFile(text, filename, [catalog()]);
    if (parsed.ok) throw new Error("Expected the mutated recipe to fail to parse.");
    const expectedLine = formatParseIssue(parsed.error[0]!);
    expect(expectedLine).toContain("NotARealFacetName");

    const chooser = page.waitForEvent("filechooser");
    await pressOpen(page);
    (await chooser).setFiles({ name: filename, mimeType: "application/json", buffer: Buffer.from(text, "utf8") });

    // Routed through FX33's `showOpenFailure` (spec L696's sheet error state), not a toast: the console gets
    // its one Error line, and the sheet names the file, the path and the reason in the Start block's place.
    const failureText = `This project couldn't be opened: ${expectedLine}`;
    await expectLogLine(page, failureText);
    // Scoped to the Sheet region: the console's own Error line carries the identical text too.
    await expect(region(page, "Sheet").getByText(failureText, { exact: true })).toBeVisible();
    await expect(region(page, "Notifications").getByText(expectedLine)).toHaveCount(0);
    // The file never opened as a project: the boot's "Untitled" project is still showing.
    await expectProject(page, "Untitled");
  });
});

test.describe("Flow 10 step 5: Projects (spec L502)", () => {
  test.beforeEach(async ({ context }) => {
    await disableFileSystemAccess(context);
  });

  test("the App menu's Projects opens the dialog on Recent, listing stored projects with status chips", async ({ page }) => {
    const stored = vault("StoredNotOpenVault", { filled: false });
    await storeProject(page, { project: stored });
    const open = vault("OpenProjectsListVault");
    await seedProject(page, { project: open });

    await openProjectsDialog(page);
    await expect(recentTab(page)).toHaveAttribute("aria-selected", "true");
    await expect(projectRow(page, "StoredNotOpenVault")).toBeVisible();
    await expect(rowStatusChip(page, "StoredNotOpenVault")).toContainText("Not deployed");
    await expect(projectRow(page, "OpenProjectsListVault")).toBeVisible();
  });

  test("a row's name opens it and closes the dialog", async ({ page }) => {
    // FX32 (ProjectRow.module.css): the name now wraps onto its own full-width line (`flex-basis: 100%`) so
    // it stays a real, clickable target at the Projects dialog's 640 px "wide" width, even once the status
    // chip, "saved …" text and four action buttons wrap onto the line(s) below it.
    const other = vault("OtherRowVault", { filled: false });
    await storeProject(page, { project: other });
    const open = vault("StartingProjectVault");
    await seedProject(page, { project: open });

    await openProjectsDialog(page);
    await openProjectRow(page, "OtherRowVault");
    await expectProject(page, "OtherRowVault");
  });

  test("a row's name opens it and closes the dialog (keyboard-only)", async ({
    page,
  }) => {
    const other = vault("OtherRowKeyboardVault", { filled: false });
    await storeProject(page, { project: other });
    const open = vault("StartingProjectKeyboardVault");
    await seedProject(page, { project: open });

    await openProjectsDialog(page);
    await rowNameButton(page, "OtherRowKeyboardVault").focus();
    await page.keyboard.press("Enter");
    await expectProject(page, "OtherRowKeyboardVault");
  });

  test("Rename from the Projects dialog's row (a project that isn't open)", async ({ page }) => {
    const other = vault("RenameRowVault", { filled: false });
    await storeProject(page, { project: other });
    const open = vault("RenameRowOpenVault");
    await seedProject(page, { project: open });

    await openProjectsDialog(page);
    await renameRow(page, "RenameRowVault", "RenameRowVault Renamed");
    // Checked via the row (found by its stable "Rename …" action button), not the row's own name button.
    await expect(projectRow(page, "RenameRowVault Renamed")).toBeVisible();
    await expect(projectRow(page, "RenameRowVault Renamed")).toContainText("RenameRowVault Renamed");
  });

  test("renaming the open project from its own row routes to the same in-place rename as the title bar, live", async ({
    page,
  }) => {
    // `renameStoredProject` (actions.ts): when the row's project is the one open, it runs `project.rename`
    // (the same command the title bar's own rename uses) instead of writing the stored record directly, so
    // the open document (and the title bar) update at once. That command edits the document only and never
    // calls persist's `emitProjects()` (frozen), so `renameStoredProject` flushes the rename to storage and
    // notifies the dialog itself (`list-refresh.ts`): the row updates without closing and reopening.
    const open = vault("SelfRenameVault");
    await seedProject(page, { project: open });
    await openProjectsDialog(page);
    const field = await startRenameRow(page, "SelfRenameVault");
    await field.fill("SelfRenameVault Renamed");
    await field.press("Enter");
    await expectProject(page, "SelfRenameVault Renamed");

    // Still the same dialog session, no close/reopen: the row already carries the new name.
    await expect(projectRow(page, "SelfRenameVault Renamed")).toBeVisible();
  });

  test("Rename in place from the title bar (pointer)", async ({ page }) => {
    const project = vault("InPlaceRenameVault");
    await seedProject(page, { project });
    await renameInPlace(page, "InPlaceRenameVault", "InPlaceRenameVault Renamed");
    await expectProject(page, "InPlaceRenameVault Renamed");
  });

  test("Rename in place from the title bar (keyboard-only: focus, Enter opens the field)", async ({ page }) => {
    const project = vault("InPlaceKeyboardRenameVault");
    await seedProject(page, { project });
    await renameInPlaceByKeyboard(page, "InPlaceKeyboardRenameVault", "InPlaceKeyboardRenameVault Renamed");
    await expectProject(page, "InPlaceKeyboardRenameVault Renamed");
  });

  test("Duplicate copies a row as \"{name} copy\"", async ({ page }) => {
    const other = vault("DuplicateRowVault", { filled: false });
    await storeProject(page, { project: other });
    const open = vault("DuplicateRowOpenVault");
    await seedProject(page, { project: open });

    await openProjectsDialog(page);
    await duplicateRow(page, "DuplicateRowVault");
    await expect(projectRow(page, "DuplicateRowVault copy")).toBeVisible();
  });

  test("Export downloads a .lattice.json with the row's project and deployment records @smoke", async ({ page }) => {
    const other = vault("ExportRowVault", { filled: false });
    const deployment = deploymentFor(other);
    await storeProject(page, { project: other, deployments: [deployment] });
    const open = vault("ExportRowOpenVault");
    await seedProject(page, { project: open });

    await openProjectsDialog(page);
    const [download] = await Promise.all([page.waitForEvent("download"), exportRow(page, "ExportRowVault")]);
    const text = await downloadText(download);
    const parsed = JSON.parse(text) as { project: { id: string }; deployments: unknown[] };
    expect(parsed.project.id).toBe(other.id);
    expect(parsed.deployments).toHaveLength(1);
  });

  test("Delete moves a row to Recently deleted with an Undo toast; Undo restores it", async ({ page }) => {
    const other = vault("DeleteRowVault", { filled: false });
    await storeProject(page, { project: other });
    const open = vault("DeleteRowOpenVault");
    await seedProject(page, { project: open });

    await openProjectsDialog(page);
    await deleteRow(page, "DeleteRowVault");
    await expect(projectRow(page, "DeleteRowVault")).toHaveCount(0);
    // spec L733: the toast is the one console line (no separate, period-terminated line).
    await expectLogLine(page, "Moved DeleteRowVault to Recently deleted");
    const notifications = region(page, "Notifications");
    await expect(notifications.getByText("Moved DeleteRowVault to Recently deleted", { exact: true })).toBeVisible();
    const undo = notifications.getByRole("button", { name: "Undo" });
    await expect(undo).toBeVisible();

    await undo.click();
    await expect(projectRow(page, "DeleteRowVault")).toBeVisible();
    await expectLogLine(page, "Restored DeleteRowVault.");
  });

  test("Recently deleted: Restore puts a row back in Recent", async ({ page }) => {
    const other = vault("RestoreRowVault", { filled: false });
    await storeProject(page, { project: other });
    const open = vault("RestoreRowOpenVault");
    await seedProject(page, { project: open });

    await openProjectsDialog(page);
    await deleteRow(page, "RestoreRowVault");
    await switchToTab(page, "deleted");
    await expect(trashRow(page, "RestoreRowVault")).toBeVisible();
    await restoreTrashRow(page, "RestoreRowVault");
    await expect(trashRow(page, "RestoreRowVault")).toHaveCount(0);
    await switchToTab(page, "recent");
    await expect(projectRow(page, "RestoreRowVault")).toBeVisible();
  });

  test("Delete for good with no deployment records: \"This can't be undone.\"", async ({ page }) => {
    const other = vault("DeleteForGoodPlainVault", { filled: false });
    await storeProject(page, { project: other });
    const open = vault("DeleteForGoodPlainOpenVault");
    await seedProject(page, { project: open });

    await openProjectsDialog(page);
    await deleteRow(page, "DeleteForGoodPlainVault");
    await switchToTab(page, "deleted");
    await clickDeleteForGood(page, "DeleteForGoodPlainVault");
    await expect(deleteForGoodDialog(page)).toBeVisible();
    await expect(deleteForGoodDialog(page).getByText("This can't be undone.", { exact: true })).toBeVisible();
    // IR "Delete for good" row: initial focus is Cancel (`DeleteForGoodDialogPanel.tsx`'s `initialFocus={cancelRef}`).
    await expect(deleteForGoodCancelButton(page)).toBeFocused();

    await confirmDeleteForGood(page);
    await expect(trashRow(page, "DeleteForGoodPlainVault")).toHaveCount(0);
    await expectLogLine(page, "Deleted DeleteForGoodPlainVault for good.");
  });

  test("Delete for good with a deployment record counts it: \"This deletes the only record of…\"", async ({ page }) => {
    const other = vault("DeleteForGoodDeployedVault", { filled: false });
    const deployment = deploymentFor(other);
    await storeProject(page, { project: other, deployments: [deployment] });
    const open = vault("DeleteForGoodDeployedOpenVault");
    await seedProject(page, { project: open });

    await openProjectsDialog(page);
    await deleteRow(page, "DeleteForGoodDeployedVault");
    await switchToTab(page, "deleted");
    await expect(trashRow(page, "DeleteForGoodDeployedVault")).toContainText(
      plural(1, "deployed address", "deployed addresses"),
    );
    await clickDeleteForGood(page, "DeleteForGoodDeployedVault");
    const expectedLine = `This deletes the only record of ${plural(1, "deployed address", "deployed addresses")}.`;
    await expect(deleteForGoodDialog(page).getByText(expectedLine, { exact: true })).toBeVisible();

    await confirmDeleteForGood(page);
    await expect(trashRow(page, "DeleteForGoodDeployedVault")).toHaveCount(0);
  });

  test("Delete for good: Export first downloads the project without closing the dialog", async ({ page }) => {
    const other = vault("ExportFirstVault", { filled: false });
    await storeProject(page, { project: other });
    const open = vault("ExportFirstOpenVault");
    await seedProject(page, { project: open });

    await openProjectsDialog(page);
    await deleteRow(page, "ExportFirstVault");
    await switchToTab(page, "deleted");
    await clickDeleteForGood(page, "ExportFirstVault");

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      deleteForGoodExportFirstButton(page).click(),
    ]);
    const parsed = JSON.parse(await downloadText(download)) as { project: { id: string } };
    expect(parsed.project.id).toBe(other.id);
    await expect(deleteForGoodDialog(page)).toBeVisible();

    await deleteForGoodCancelButton(page).click();
    await expect(deleteForGoodDialog(page)).toHaveCount(0);
    await expect(trashRow(page, "ExportFirstVault")).toBeVisible();
  });

  test("Clear data (Settings → Data) confirms, counts, and Export first downloads every stored file", async ({ page }) => {
    const project = vault("ClearDataVault", { filled: false });
    await seedProject(page, { project });

    const dialog = await clickClearData(page);
    await expect(dialog.getByText("This deletes 1 project. This can't be undone.", { exact: true })).toBeVisible();

    const [download] = await Promise.all([page.waitForEvent("download"), clearDataExportFirstButton(page).click()]);
    const parsed = JSON.parse(await downloadText(download)) as { project: { id: string } };
    expect(parsed.project.id).toBe(project.id);
    await expectLogLine(page, "Downloading 1 file. If the browser asks, allow multiple downloads.");
    await expect(clearDataDialog(page)).toBeVisible();

    await confirmClearData(page);
    await expectLogLine(page, "Cleared Studio's data in this browser.");
  });

  test("Clear data: Cancel loses nothing", async ({ page }) => {
    const project = vault("ClearDataCancelVault", { filled: false });
    await seedProject(page, { project });
    await clickClearData(page);
    await clearDataCancelButton(page).click();
    await expect(clearDataDialog(page)).toHaveCount(0);
    // Cancelling Clear data leaves Settings open underneath (stacked dialogs): close it too, since the title
    // bar sits behind an open modal and isn't in the accessibility tree while one is (Base UI's inert background).
    await page.getByRole("dialog", { name: "Settings" }).getByRole("button", { name: "Close" }).click();
    await expectSaveStatus(page, "Saved");
  });
});

test.describe("Flow 10 steps 1-5, keyboard-only (save, open, Projects mechanics)", () => {
  test.beforeEach(async ({ context }) => {
    await disableFileSystemAccess(context);
  });

  test("save, open and the Projects dialog's core actions run without a pointer", async ({ page }) => {
    const other = vault("KeyboardOtherVault", { filled: false });
    await storeProject(page, { project: other });
    const project = vault("KeyboardMainVault");
    await seedProject(page, { project });

    // Ctrl/Cmd+S: Save a copy opens focused on File name; Enter submits and downloads.
    const download = page.waitForEvent("download");
    await pressSave(page);
    await expectSaveCopyDialog(page);
    await expect(fileNameField(page)).toBeFocused();
    await submitWithEnter(page);
    await download;
    await expect(saveCopyDialog(page)).toHaveCount(0);

    // Ctrl/Cmd+O: opens the hidden file input via the file-chooser event.
    const anotherProject = vault("KeyboardOpenedVault");
    const chooser = page.waitForEvent("filechooser");
    await pressOpen(page);
    (await chooser).setFiles(filePayload(projectFile(anotherProject, [])));
    await expectProject(page, "KeyboardOpenedVault");

    // Projects, from the palette: focus a row's actions, no clicks.
    await runInPalette(page, "Projects");
    await expect(recentTab(page)).toBeVisible();
    await rowNameButton(page, "KeyboardOtherVault").focus();
    await page.keyboard.press("Enter");
    await expectProject(page, "KeyboardOtherVault");

    // Renames a row that isn't the open project (the open-row case is covered live, on its own, above):
    // "KeyboardMainVault" is stored but no longer the open document.
    await runInPalette(page, "Projects");
    await projectRow(page, "KeyboardMainVault").getByRole("button", { name: "Rename KeyboardMainVault" }).focus();
    await page.keyboard.press("Enter");
    const renameField = projectRow(page, "KeyboardMainVault").getByRole("textbox", { name: "Project name" });
    await expect(renameField).toBeFocused();
    await renameField.fill("KeyboardMainVault Renamed");
    await renameField.press("Enter");
    // Checked via the row, not `rowNameButton`'s own visibility (see the CCR above the pointer rename tests).
    await expect(projectRow(page, "KeyboardMainVault Renamed")).toBeVisible();

    // Delete, then Undo from the toast: close the dialog first so the toast's focus trap-free.
    await projectRow(page, "KeyboardMainVault Renamed")
      .getByRole("button", { name: "Delete KeyboardMainVault Renamed" })
      .focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await expect(saveCopyDialog(page)).toHaveCount(0);

    const undo = region(page, "Notifications").getByRole("button", { name: "Undo" });
    await expect(undo).toBeVisible();
    await undo.focus();
    await page.keyboard.press("Enter");
    await expectLogLine(page, "Restored KeyboardMainVault Renamed.");
  });
});

test.describe("Narrow widths: the title bar's save status (TitleBar.tsx's showSave, referenced by spec L497)", () => {
  test.describe("at 768 px", () => {
    test.use({ viewport: viewportAt(768) });
    test("the save status is still visible in the title bar", async ({ page }) => {
      const project = vault("NarrowVault768");
      await seedProject(page, { project });
      await expectTier(page, tierAt(768));
      await expectSaveStatus(page, "Saved");
    });
  });

  test.describe("at 375 px", () => {
    test.use({ viewport: viewportAt(375) });
    test("the save status is hidden while Saved (it shows only for Not saved or Read-only)", async ({ page }) => {
      const project = vault("NarrowVault375");
      await seedProject(page, { project });
      await expectTier(page, tierAt(375));
      await expect(saveStatusButton(page)).toHaveCount(0);
    });
  });
});
