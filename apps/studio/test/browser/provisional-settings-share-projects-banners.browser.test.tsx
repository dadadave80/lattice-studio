/**
 * PA L80: Settings, Share, the Projects list with Recently deleted, and the banners have no board yet. Built
 * from the design system and the dialog/banner primitives. Shop only where a second theme would be redundant
 * (a static dialog/banner with no theme-dependent branching); both themes where the state itself differs
 * visually enough to be worth a second look.
 */
import { commandRef, createProject, openDialog, runCommand, setCatalogStatus, showBanner } from "@/contracts";
import { BannerHost } from "@/feedback/BannerHost";
import { resetBanners } from "@/feedback/banner-store";
import { projectFor, template } from "@/flows/test-support";
import { testPersistence } from "@/persist/testing";
import { DialogHost } from "@/ui/overlays/DialogHost";
import { makeRecipe } from "@lattice-studio/core/testing";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { fixtureCatalog, onCleanup, renderWithStudio } from "../harness";

const SHARE = commandRef("share.copyLink");

/** Text that doesn't compress: pushes the share link past the 2,000-character Discord limit. */
function noise(length: number): string {
  let seed = 7;
  let out = "";
  while (out.length < length) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    out += (seed % 36).toString(36);
  }
  return out;
}

const catalog = fixtureCatalog();

function ready(): void {
  setCatalogStatus({ status: "ready", id: catalog.lattice.tag, catalog, manifest: null });
  onCleanup(() => setCatalogStatus({ status: "loading" }));
}

beforeAll(async () => {
  await Promise.all(
    ['400 13px "JetBrains Mono"', '600 13px "JetBrains Mono"', '400 14px Inter', '600 14px Inter', '600 12px Inter'].map(
      (font) => document.fonts.load(font),
    ),
  );
});

afterEach(() => resetBanners());

describe.each(["shop", "draft"] as const)("provisional: settings dialog (%s)", (theme) => {
  test("provisional-settings-appearance", async () => {
    await renderWithStudio(<DialogHost />, { theme });
    openDialog("settings");
    const dialog = page.getByRole("dialog", { name: "Settings" });
    await expect.element(page.getByRole("tab", { name: "Appearance" })).toHaveAttribute("aria-selected", "true");
    await document.fonts.ready;
    await expect
      .element(page.elementLocator(dialog.element() as HTMLElement))
      .toMatchScreenshot(`provisional-settings-appearance-${theme}`);
  });
});

describe("provisional: share, over 2,000 characters", () => {
  test("provisional-share-over-length", async () => {
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    onCleanup(() => writeText.mockRestore());
    const project = projectFor(template("GovernedVault"), { name: noise(2400) });
    await renderWithStudio(<DialogHost />, { project });
    await runCommand(SHARE, "button");
    const dialog = page.getByRole("dialog", { name: "Share" });
    await expect.element(dialog.getByRole("button", { name: "Save a file instead" })).toHaveFocus();
    await document.fonts.ready;
    // The character count moves with anything that changes what the link encodes (the project's name in the
    // recipe, the catalog hash, ...), which isn't this baseline's concern; mask it so the count's own width
    // can't shift the rest of the dialog's layout in the comparison.
    const count = dialog.getByText(/^This link is [\d,]+ characters,/, { exact: false });
    await expect.element(count).toBeVisible();
    await expect
      .element(page.elementLocator(dialog.element() as HTMLElement))
      .toMatchScreenshot("provisional-share-over-length-shop", { screenshotOptions: { mask: [count] } });
  });
});

describe("provisional: projects, Recently deleted", () => {
  test("provisional-projects-recently-deleted", async () => {
    ready();
    testPersistence();
    const vault = await createProject(makeRecipe({}, catalog), "Vault");
    if (!vault.ok) throw new Error(vault.error);
    await runCommand({ id: "project.delete", args: { id: vault.value.id } }, "api");

    const screen = await renderWithStudio(<DialogHost />);
    openDialog("projects", { tab: "deleted" });
    const dialog = page.getByRole("dialog", { name: "Projects" });
    await expect.element(dialog.getByRole("tab", { name: /^Recently deleted/ })).toHaveAttribute("aria-selected", "true");
    await expect.element(screen.getByText("Vault")).toBeVisible();
    await document.fonts.ready;
    await expect
      .element(page.elementLocator(dialog.element() as HTMLElement))
      .toMatchScreenshot("provisional-projects-recently-deleted-shop");
  });
});

describe("provisional: a banner", () => {
  test("provisional-banner-update", async () => {
    await renderWithStudio(<BannerHost />);
    showBanner("update", { text: "A new version of Studio is ready", tone: "info", actions: [commandRef("app.reload")] });
    const text = page.getByText("A new version of Studio is ready");
    await expect.element(text).toBeVisible();
    await document.fonts.ready;
    const region = document.body.firstElementChild as HTMLElement;
    await expect.element(page.elementLocator(region)).toMatchScreenshot("provisional-banner-update-shop");
  });
});
