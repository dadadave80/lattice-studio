/**
 * Three small surfaces the orchestrator flagged as built without a board (no States board draws them): the
 * pane size menu, the copy-blocked fallback and the not-built-yet dialog placeholder. Dark only: these are
 * small controls, not full boards, and none of the three branches on theme.
 */
import { useState } from "react";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { openDialog, overrideDialog } from "@/contracts";
import { Button } from "@/ui/buttons/Button";
import { copyHint, copyText, dismissCopyFallback } from "@/ui/copy/copy-text";
import { DialogHost } from "@/ui/overlays/DialogHost";
import { PaneSizeMenu } from "@/ui/nav/PaneSizeMenu";
import { onCleanup, renderWithStudio } from "../harness";

beforeAll(async () => {
  await Promise.all(
    ['400 13px "JetBrains Mono"', '600 13px "JetBrains Mono"', '400 14px Inter', '600 14px Inter', '600 12px Inter'].map(
      (font) => document.fonts.load(font),
    ),
  );
});

describe("provisional: PaneSizeMenu", () => {
  function Harness() {
    const [size, setSize] = useState(240);
    return <PaneSizeMenu pane="Catalog" value={size} min={200} max={360} onChange={setSize} onCollapse={() => undefined} />;
  }

  test("provisional-pane-size-menu-open", async () => {
    await renderWithStudio(<Harness />);
    const trigger = page.getByRole("button", { name: "Catalog menu" });
    await trigger.click();
    const menu = page.getByRole("menu");
    await expect.element(page.getByRole("menuitem", { name: "Narrower" })).toBeVisible();
    await document.fonts.ready;
    await expect.element(page.elementLocator(menu.element() as HTMLElement)).toMatchScreenshot("provisional-pane-size-menu-open-dark");
  });
});

describe("provisional: copy fallback", () => {
  test("provisional-copy-fallback-selected", async () => {
    onCleanup(dismissCopyFallback);
    const clipboard = { writeText: vi.fn(async () => { throw new DOMException("Write permission denied.", "NotAllowedError"); }) };
    await renderWithStudio(<Button onClick={() => void copyText("0x5FbDB2315678afecb367f032d93F642f64180aa3", { clipboard })}>Copy address</Button>);
    await page.getByRole("button", { name: "Copy address" }).click();
    const field = page.getByRole("textbox", { name: copyHint() });
    await expect.element(field).toHaveFocus();
    await document.fonts.ready;
    const fallback = document.querySelector<HTMLElement>("[data-copy-fallback]");
    if (!fallback) throw new Error("No copy fallback.");
    await expect.element(page.elementLocator(fallback)).toMatchScreenshot("provisional-copy-fallback-selected-dark");
  });
});

describe("provisional: NotBuiltDialog", () => {
  test("provisional-not-built-dialog", async () => {
    onCleanup(overrideDialog("deploy-review", null));
    await renderWithStudio(<DialogHost />);
    openDialog("deploy-review");
    const dialog = page.getByRole("dialog", { name: "Deploy review" });
    await expect.element(dialog.getByText("Not built yet · WP-S8b")).toBeVisible();
    await document.fonts.ready;
    await expect.element(page.elementLocator(dialog.element() as HTMLElement)).toMatchScreenshot("provisional-not-built-dialog-dark");
  });
});
