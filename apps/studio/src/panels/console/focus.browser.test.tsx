/**
 * Getting around the console by keyboard: the Tab stops between the console's edge and the command line (the
 * tab list and the Log's toolbars rove, so each is one stop), and the tour's console coach mark lands beside
 * the drawer (spec L400).
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { log } from "@/contracts";
import { Tour } from "@/tour/Tour";
import { TOUR_STEPS } from "@/tour/steps";
import { resetTour, setTourStep, startTour } from "@/tour/tour-state";
import { axeViolations } from "@/ui/testing/axe";
import { renderWithStudio } from "../../../test/harness";
import { COMMAND_LABEL } from "./CommandLine";
import { ConsolePanel } from "./ConsolePanel";
import { ACTIONS_LABEL, TAGS_LABEL } from "./LogToolbar";
import { awaitConsoleBody, erc20Project, resetConsole } from "./test-support";

beforeEach(() => resetConsole());
afterEach(() => resetTour());

/** The console in a 400 px frame at the bottom of the page, with a button before it to Tab from. */
async function renderConsole(extra: ReactNode = null, theme: "shop" | "draft" = "shop") {
  await renderWithStudio(
    <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column" }}>
      <button type="button">Before the console</button>
      <div style={{ flex: "1 1 0" }} />
      <div style={{ height: "300px", display: "flex" }}>
        <ConsolePanel />
      </div>
      {extra}
    </div>,
    { project: erc20Project(), theme },
  );
  await awaitConsoleBody();
}

function focusedName(): string {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return "";
  return el.getAttribute("aria-label") ?? el.textContent?.trim() ?? el.tagName;
}

/** Tab from the button before the console until the command line, recording each stop's name. */
async function stopsToCommandLine(): Promise<string[]> {
  page.getByRole("button", { name: "Before the console" }).element().focus();
  const stops: string[] = [];
  for (let i = 0; i < 40; i += 1) {
    await userEvent.keyboard("{Tab}");
    stops.push(focusedName());
    if (focusedName() === COMMAND_LABEL) return stops;
  }
  throw new Error(`Never reached the command line: ${stops.join(" → ")}`);
}

describe("Tab stops to the command line (a11y cleanup, ledger L437)", () => {
  test("the header's controls, one stop per toolbar, the filter, one log line, then the command line", async () => {
    await renderConsole();
    log({ tag: "Note", text: "Placed ERC20 · 9 selectors" });
    await expect.element(page.getByRole("button", { name: /Placed ERC20/ })).toBeInTheDocument();
    const stops = await stopsToCommandLine();
    expect(stops).toEqual([
      "Collapse console",
      "Log",
      "Export",
      "Console menu",
      "Maximize console",
      "Note",
      "Filter the log",
      "Clear the log",
      expect.stringContaining("Placed ERC20"),
      COMMAND_LABEL,
    ]);
    // Twenty-one before this change; nine now.
    expect(stops.length - 1).toBe(9);
  });

  test("the tag chips rove: ← → Home End move along them, and Tab leaves from the one last focused", async () => {
    await renderConsole();
    const chips = page.getByRole("toolbar", { name: TAGS_LABEL });
    const chip = (name: string) => chips.getByRole("button", { name, exact: true });
    (chip("Note").element() as HTMLElement).focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(chip("Placed")).toHaveFocus();
    await userEvent.keyboard("{End}");
    await expect.element(chip("Error")).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(chip("Note")).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    await expect.element(chip("Error")).toHaveFocus();
    await userEvent.keyboard("{Home}{ArrowRight}{ArrowRight}");
    await expect.element(chip("Resolved")).toHaveFocus();
    const tabbable = [...chips.element().querySelectorAll("button")].filter((b) => b.tabIndex === 0).map((b) => b.textContent);
    expect(tabbable).toEqual(["Resolved"]);
    // Space still toggles the chip that has focus.
    await userEvent.keyboard(" ");
    await expect.element(chip("Resolved")).toHaveAttribute("aria-pressed", "true");
    // Shift+Tab back into the row lands on the chip last used.
    await userEvent.keyboard("{Tab}");
    await expect.element(page.getByRole("searchbox", { name: "Filter the log" })).toHaveFocus();
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    await expect.element(chip("Resolved")).toHaveFocus();
  });

  test("the Log's actions rove too; Copy line keeps its reason and its place in the row", async () => {
    await renderConsole();
    const actions = page.getByRole("toolbar", { name: ACTIONS_LABEL });
    const clear = actions.getByRole("button", { name: "Clear the log" });
    (clear.element() as HTMLElement).focus();
    await userEvent.keyboard("{ArrowRight}");
    const copyLine = actions.getByRole("button", { name: "Copy line" });
    await expect.element(copyLine).toHaveFocus();
    await expect.element(copyLine).toHaveAttribute("aria-disabled", "true");
    await expect.element(copyLine).toHaveAccessibleDescription("Select a line first");
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(actions.getByRole("button", { name: "Log menu" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByRole("menuitem", { name: "Copy all" })).toBeVisible();
  });

  for (const theme of ["shop", "draft"] as const) {
    test(`the Log with its toolbars has no axe violations, in ${theme}`, async () => {
      await renderConsole(null, theme);
      log({ tag: "Error", text: "Couldn't load the catalog" });
      await expect.element(page.getByRole("button", { name: /Couldn't load/ })).toBeInTheDocument();
      expect(await axeViolations(document.body)).toEqual([]);
    });
  }
});

describe("the tour's console coach mark (spec L400)", () => {
  test("the drawer is the target, and the card lands beside it rather than centered", async () => {
    await renderConsole(<Tour />);
    const target = document.querySelector<HTMLElement>('[data-tour="console"]');
    expect(target?.getAttribute("data-keyctx")).toBe("console");
    startTour();
    const at = TOUR_STEPS.findIndex((s) => s.id === "console");
    setTourStep(at);
    const card = page.getByRole("group", { name: TOUR_STEPS[at]!.title });
    await expect.element(card).toBeVisible();
    const rect = (target as HTMLElement).getBoundingClientRect();
    await expect
      .poll(() => {
        const box = card.element().getBoundingClientRect();
        const above = Math.abs(box.bottom - (rect.top - 12)) < 1;
        const below = Math.abs(box.top - (rect.bottom + 12)) < 1;
        return { beside: above || below, left: Math.round(box.left) === Math.round(Math.max(rect.left, 12)) };
      })
      .toEqual({ beside: true, left: true });
    expect((card.element() as HTMLElement).style.transform).toBe("");
  });
});
