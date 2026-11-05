import { afterEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { openDialog, runCommand, session } from "@/contracts";
import { Button, DialogHost } from "@/ui";
import { axeViolations, emulateForcedColors } from "@/ui/testing/axe";
import { renderWithStudio } from "../../test/harness";

function App() {
  return (
    <>
      <Button onClick={() => void runCommand({ id: "settings.open" }, "menu")}>Settings</Button>
      <DialogHost />
    </>
  );
}

const dialog = () => page.getByRole("dialog", { name: "Settings" });
const tab = (name: string) => page.getByRole("tab", { name });
const opener = () => page.getByRole("button", { name: "Settings" });

afterEach(async () => {
  await emulateForcedColors(false);
  await page.viewport(1440, 900);
});

function fits(button: HTMLElement, panel: HTMLElement): void {
  const box = button.getBoundingClientRect();
  const bounds = panel.getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(button);
  const text = range.getBoundingClientRect();
  expect(text.left).toBeGreaterThanOrEqual(box.left - 0.5);
  expect(text.right).toBeLessThanOrEqual(box.right + 0.5);
  expect(text.top).toBeGreaterThanOrEqual(box.top - 0.5);
  expect(text.bottom).toBeLessThanOrEqual(box.bottom + 0.5);
  expect(box.left).toBeGreaterThanOrEqual(bounds.left - 0.5);
  expect(box.right).toBeLessThanOrEqual(bounds.right + 0.5);
}

for (const width of [320, 375, 768, 1440]) {
  test(`${width}px: Settings actions fit and tabs match their keyboard orientation`, async () => {
    await page.viewport(width, 900);
    await renderWithStudio(<App />);
    openDialog("settings");
    const list = page.getByRole("tablist", { name: "Settings groups" });
    await expect.element(list).toHaveAttribute("aria-orientation", width < 768 ? "horizontal" : "vertical");
    await expect.element(tab("Appearance")).toHaveFocus();
    await userEvent.keyboard(width < 768 ? "{ArrowRight}" : "{ArrowDown}");
    await expect.element(tab("Canvas")).toHaveAttribute("aria-selected", "true");
    await expect.element(tab("Canvas")).toHaveFocus();
    await tab("Data").click();
    const panel = page.getByRole("tabpanel", { name: "Data" }).element() as HTMLElement;
    const buttons = [...panel.querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      fits(button, panel);
      expect(button.getBoundingClientRect().top).toBeGreaterThanOrEqual(panel.getBoundingClientRect().top - 0.5);
      expect(button.getBoundingClientRect().bottom).toBeLessThanOrEqual(panel.getBoundingClientRect().bottom + 0.5);
    }
    const [first, second] = buttons.map((button) => button.getBoundingClientRect());
    expect(first && second && (first.right <= second.left + 0.5 || first.bottom <= second.top + 0.5)).toBe(true);
    await page.viewport(width < 768 ? 1440 : 375, 500);
    await expect.element(tab("Data")).toHaveAttribute("aria-selected", "true");
    expect(page.getByRole("tabpanel", { name: "Data" }).element()).toBe(panel);
    await expect.poll(() => {
      const selected = tab("Data").element().getBoundingClientRect();
      const listBox = list.element().getBoundingClientRect();
      return selected.left >= listBox.left - 0.5 && selected.right <= listBox.right + 0.5;
    }).toBe(true);
    await page.viewport(width, 900);
    await tab("Networks").click();
    const networks = page.getByRole("tabpanel", { name: "Networks" }).element() as HTMLElement;
    const checks = [...networks.querySelectorAll<HTMLButtonElement>("button")];
    expect(checks.length).toBeGreaterThan(0);
    for (const check of checks) fits(check, networks);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
  });
}

test("phone Settings scrolls its panel while Close remains reachable at short and landscape heights", async () => {
  await page.viewport(375, 500);
  await renderWithStudio(<App />);
  openDialog("settings", { group: "networks" });
  for (const [width, height] of [[375, 500], [600, 256]]) {
    await page.viewport(width!, height!);
    const panel = page.getByRole("tabpanel", { name: "Networks" }).element() as HTMLElement;
    expect(panel.scrollHeight).toBeGreaterThan(panel.clientHeight);
    panel.scrollTop = panel.scrollHeight;
    await expect.element(page.getByRole("button", { name: "Close", exact: true })).toBeInViewport();
    expect(document.documentElement.scrollHeight).toBeLessThanOrEqual(height!);
  }
});

for (const theme of ["light", "dark"] as const) {
  for (const forced of [false, true]) {
    test(`phone Settings accessibility in ${theme}${forced ? " forced colors" : ""} with reduced motion`, async () => {
      await page.viewport(375, 900);
      await emulateForcedColors(forced);
      await renderWithStudio(<App />, { theme, settings: { reduceMotion: "on" } });
      await opener().click();
      for (const group of ["Data", "Networks"]) {
        await tab(group).click();
        expect(await axeViolations(dialog().element(), { forced, bestPractice: true })).toEqual([]);
      }
      await userEvent.keyboard("{Escape}");
      await expect.element(opener()).toHaveFocus();
    });
  }
}

describe("Settings dialog (Flow 16, IR L183)", () => {
  test("settings.open shows it with the first group's tab focused", async () => {
    await renderWithStudio(<App />);
    (opener().element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(dialog()).toBeVisible();
    await expect.element(tab("Appearance")).toHaveFocus();
    await expect.element(tab("Appearance")).toHaveAttribute("aria-selected", "true");
  });

  test("a group can be opened directly, with initial focus on that group's own tab", async () => {
    await renderWithStudio(<App />);
    openDialog("settings", { group: "networks" });
    await expect.element(dialog()).toBeVisible();
    await expect.element(tab("Networks")).toHaveAttribute("aria-selected", "true");
    await expect.element(tab("Networks")).toHaveFocus();
  });

  test("clicking a tab switches the visible panel, and only that one is in the DOM", async () => {
    await renderWithStudio(<App />);
    openDialog("settings");
    await expect.element(tab("Appearance")).toHaveAttribute("aria-selected", "true");
    await tab("Data").click();
    await expect.element(tab("Data")).toHaveAttribute("aria-selected", "true");
    await expect.element(tab("Appearance")).toHaveAttribute("aria-selected", "false");
    const panels = document.querySelectorAll<HTMLElement>('[role="tabpanel"]');
    expect(panels).toHaveLength(1);
  });

  test("Esc closes it and focus goes back to what opened it; so does Close", async () => {
    await renderWithStudio(<App />);
    await opener().click();
    await expect.element(dialog()).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(opener()).toHaveFocus();
    expect(session.get().dialogs).toEqual([]);
    await opener().click();
    await page.getByRole("button", { name: "Close" }).click();
    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(opener()).toHaveFocus();
  });

  test("stacks over another dialog: it stays mounted but inert, then interactive again once the one above closes", async () => {
    await renderWithStudio(<App />);
    openDialog("settings");
    openDialog("clear-data");
    expect(session.get().dialogs.map((d) => d.id)).toEqual(["settings", "clear-data"]);
    // Base UI hides an inert dialog from the accessibility tree, so `getByRole` can't see it; it's still
    // mounted underneath, and Clear data is the one that's interactive (top, IR L170-L187).
    await expect.element(page.getByRole("dialog", { name: "Clear data" })).toBeVisible();
    expect(document.querySelector('[aria-hidden="true"] [role="dialog"]')?.textContent).toContain("Settings");
    // Clear data (S7b) has no Close button; Cancel loses nothing (spec's confirm-only-where-it-can't-be-undone).
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect.element(dialog()).toBeVisible();
    expect(session.get().dialogs.map((d) => d.id)).toEqual(["settings"]);
  });
});
