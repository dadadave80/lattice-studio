/**
 * Board: `design/boards/current-command-palette.png`: a mono query line, grouped results (the board's own
 * groups are Place module/Build/Session; the spec's are Suggested/Recent/Commands/Place facet/Recipes -
 * PA "Adopted" already covers the tabs and shape, so this test follows the spec's grouping, not the mock's),
 * the active row's accent left rule, and a low scrim.
 */
import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { command, type Command } from "@/contracts";
import { installShortcuts } from "@/commands";
import { Button } from "@/ui/buttons/Button";
import { overridePlatform } from "@/ui/shared/platform";
import { onCleanup, overrideCommands, renderWithStudio } from "../harness";
import { CommandPalette } from "@/palette/CommandPalette";
import { resetPaletteState } from "@/palette/palette-state";

const never = () => () => undefined;

function fake(id: Command["id"], title: () => string, extra: Partial<Command> = {}): Command {
  return command({ id, title, category: "Build", enabled: () => ({ ok: true }), run: () => undefined, ...extra });
}

beforeEach(() => {
  onCleanup(overridePlatform("mac"));
  onCleanup(installShortcuts());
  onCleanup(resetPaletteState);
  overrideCommands([
    fake("layout.tidy", () => "Tidy sheet", { category: "Sheet", keys: ["t"], keyContext: ["sheet"], palette: true, console: { verb: "tidy", syntax: "tidy", parse: () => ({ ok: true, value: {} }) } }),
    fake("deploy.open", () => "Deploy…", { category: "Deploy", palette: true, enabled: () => ({ ok: false, reason: "Resolve 2 blockers" }) }),
    fake("problem.next", () => "Next problem", { category: "Build", keys: ["F8"], palette: true }),
  ]);
});

function App() {
  return (
    <>
      <Button>Opener</Button>
      <CommandPalette preload={never} />
    </>
  );
}

const search = () => page.getByRole("combobox", { name: "Search commands, facets and recipes" });
const opener = () => page.getByRole("button", { name: "Opener" });
const active = () => document.querySelector<HTMLElement>("[role=option][data-highlighted]");

async function openAndFilter(theme: "dark" | "light"): Promise<void> {
  await renderWithStudio(<App />, { theme });
  (opener().element() as HTMLElement).focus();
  await userEvent.keyboard("{Meta>}k{/Meta}");
  await expect.element(search()).toHaveFocus();
  await userEvent.keyboard("paus");
  await expect.element(page.getByRole("option", { name: /^Place ERC20Pausable/ })).toBeVisible();
}

beforeAll(async () => {
  await Promise.all(
    ['400 13px "JetBrains Mono"', '600 13px "JetBrains Mono"', '400 14px Inter', '600 14px Inter', '600 12px Inter'].map(
      (font) => document.fonts.load(font),
    ),
  );
});

describe.each(["dark", "light"] as const)("board: command palette (%s)", (theme) => {
  test("filtered query, Place facet group, active row's accent", async () => {
    await openAndFilter(theme);
    expect(active()?.textContent).toMatch(/^Place ERC20Pausable|^Place Pausable/);
    await document.fonts.ready;
    const dialog = page.getByRole("dialog", { name: "Command palette" });
    await expect.element(page.elementLocator(dialog.element() as HTMLElement)).toMatchScreenshot(`command-palette-filtered-${theme}`);
  });
});
