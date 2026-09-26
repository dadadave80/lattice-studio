/**
 * `ChoosePerSelectorDialog` has no board of its own (it follows the same design system as every other dialog);
 * built from Overlays.browser.test.tsx's real scenario: two contested selectors, each needing an owner.
 */
import { beforeAll, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { runCommand } from "@/contracts";
import { cardProject } from "@/sheet/card/testing/projects";
import { renderSheet } from "@/sheet/canvas/testing/sheet-harness";
import { DialogHost } from "@/ui/overlays/DialogHost";
import { render } from "vitest-browser-react";
import { fixtureCatalog } from "../harness";

const AXELAR = "AxelarGatewayAdapter";
const HYPERLANE = "HyperlaneGatewayAdapter";
const SEND = "0xcdfe7f5c";
const ATTRIBUTE = "0xdc680a0f";
const catalog = fixtureCatalog();

beforeAll(async () => {
  await Promise.all(
    ['400 13px "JetBrains Mono"', '600 13px "JetBrains Mono"', '400 14px Inter', '600 14px Inter', '600 12px Inter'].map(
      (font) => document.fonts.load(font),
    ),
  );
});

describe.each(["shop", "draft"] as const)("provisional: Choose per selector, two owners to pick (%s)", (theme) => {
  test("one owner menu per contested selector, Apply owners disabled until one is chosen", async () => {
    const project = cardProject(catalog, [AXELAR, HYPERLANE], { columns: 2 });
    await renderSheet({ theme, project, settings: { reduceMotion: "on" } });
    await render(<DialogHost />);
    await runCommand({ id: "collision.choosePerSelector", args: { selectors: [SEND, ATTRIBUTE] } }, "api");
    const dialog = page.getByRole("dialog", { name: "Choose per selector" });
    await expect.element(dialog).toBeVisible();
    await expect.element(dialog.getByText("sendMessage(bytes,bytes,bytes[])")).toBeVisible();
    await expect.element(dialog.getByText("supportsAttribute(bytes4)")).toBeVisible();
    await expect.element(dialog.getByRole("button", { name: "Apply owners" })).toHaveAttribute("aria-disabled", "true");
    await document.fonts.ready;
    await expect.element(page.elementLocator(dialog.element() as HTMLElement)).toMatchScreenshot(`provisional-choose-per-selector-${theme}`);
  });
});
