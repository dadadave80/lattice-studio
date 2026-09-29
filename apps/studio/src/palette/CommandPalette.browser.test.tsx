import type { CommandRef, Json, Problem } from "@lattice-studio/core";
import { makeProject, makeRecipe } from "@lattice-studio/core/testing";
import { beforeEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import {
  command, emptyAnalysis, openDialog, provideAnalysis, runCommand, session, type Command, type CommandArgs,
} from "@/contracts";
import { installShortcuts } from "@/commands";
import { Button, ContextMenu, DialogHost, MenuCommandItem } from "@/ui";
import { overridePlatform } from "@/ui/shared/platform";
import { axeViolations } from "@/ui/testing/axe";
import { bufferedServices, fixtureCatalog, onCleanup, overrideCommands, renderWithStudio } from "../../test/harness";
import { CommandPalette } from "./CommandPalette";
import { DIALOG_OPEN } from "./open-command";
import { recordRecent, resetPaletteState } from "./palette-state";

const ran: CommandRef[] = [];
const never = () => () => undefined;

function fake(
  id: Command["id"],
  title: (args: CommandArgs) => string,
  extra: Partial<Command> = {},
): Command {
  return command({
    id,
    title,
    category: "Build",
    enabled: () => ({ ok: true }),
    run: (_ctx, args) => {
      ran.push(Object.keys(args).length ? { id, args: args as Record<string, Json> } : { id });
    },
    ...extra,
  });
}

beforeEach(() => {
  ran.length = 0;
  onCleanup(overridePlatform("mac"));
  onCleanup(installShortcuts());
  onCleanup(resetPaletteState);
  overrideCommands([
    fake("layout.tidy", () => "Tidy", {
      category: "Sheet",
      keys: ["t"],
      keyContext: ["sheet"],
      palette: true,
      console: { verb: "tidy", syntax: "tidy", parse: () => ({ ok: true, value: {} }) },
    }),
    fake("deploy.open", () => "Deploy…", {
      category: "Deploy",
      palette: true,
      enabled: () => ({ ok: false, reason: "Resolve 2 blockers" }),
    }),
    fake("problem.next", () => "Next problem", { keys: ["F8"], palette: true }),
    fake("init.open", () => "Fill in"),
    fake("init.focusField", () => "Edit asset"),
    fake("selector.route", (args) => `Route to ${String(args.facet)}`),
    fake("facet.place", (args) => `Place ${String(args.facet)}`, {
      console: { verb: "place", syntax: "place <facet>", parse: () => ({ ok: false, error: "" }) },
    }),
  ]);
});

function problems(list: Problem[]): void {
  const analysis = { ...emptyAnalysis(), problems: list };
  onCleanup(provideAnalysis({ getAnalysis: () => analysis, subscribe: () => () => undefined }));
}

const collision: Problem = {
  id: "SEL-01:0xa9059cbb",
  code: "SEL-01",
  severity: "blocker",
  where: [],
  params: {},
  message: "",
  fixes: [{ id: "selector.route", args: { selector: "0xa9059cbb", facet: "ERC20" } }, { id: "collision.choosePerSelector" }],
};
const missingArg: Problem = { ...collision, id: "INIT-01:bundle.p.asset", code: "INIT-01", fixes: [{ id: "init.focusField" }] };

function App() {
  return (
    <>
      <Button>Opener</Button>
      <Button onClick={() => void openDialog("keyboard-shortcuts", {})}>Shortcuts</Button>
      <CommandPalette preload={never} />
      <DialogHost />
    </>
  );
}

const palette = () => page.getByRole("dialog", { name: "Command palette" });
const search = () => page.getByRole("combobox", { name: "Search commands, facets and recipes" });
const opener = () => page.getByRole("button", { name: "Opener" });
const active = () => document.querySelector<HTMLElement>("[role=option][data-highlighted]");

async function openFromOpener(): Promise<void> {
  (opener().element() as HTMLElement).focus();
  await userEvent.keyboard("{Meta>}k{/Meta}");
  await expect.element(search()).toHaveFocus();
}

function groupNames(): string[] {
  return [...document.querySelectorAll("[role=group]")].map((g) => {
    const id = g.getAttribute("aria-labelledby");
    return (id && document.getElementById(id)?.textContent) || "";
  });
}

describe("Command palette (IR L162-L168)", () => {
  test("⌘K opens it with focus in the query; groups come Suggested, Recent, Commands, Place facet, Recipes", async () => {
    problems([collision, missingArg]);
    recordRecent({ id: "layout.tidy" });
    await renderWithStudio(<App />);
    await openFromOpener();
    await expect.element(palette()).toBeVisible();
    expect(groupNames()).toEqual(["Suggested", "Recent", "Commands", "Place facet", "Recipes"]);
    const suggested = page.getByRole("group", { name: "Suggested" }).getByRole("option");
    await expect.element(suggested.nth(0)).toMatchTextContent(/^Route to ERC20/);
    await expect.element(suggested.nth(1)).toMatchTextContent(/^Edit asset/);
    await expect.element(suggested.nth(2)).toMatchTextContent(/^Fill in/);
    await expect.element(suggested.nth(3)).toMatchTextContent(/^Next problem/);
    await expect.element(page.getByRole("group", { name: "Recent" }).getByRole("option")).toMatchTextContent(/^Tidy/);
    // The first row is active.
    expect(active()?.textContent).toMatch(/^Route to ERC20/);
  });

  test("each row shows its title, category, shortcut chip and console syntax", async () => {
    await renderWithStudio(<App />);
    await openFromOpener();
    const tidy = page.getByRole("group", { name: "Commands" }).getByRole("option", { name: /^Tidy Sheet/ });
    await expect.element(tidy).toMatchTextContent(/Sheet/);
    await expect.element(tidy.getByText("T", { exact: true })).toBeVisible();
    await expect.element(tidy.getByText("tidy", { exact: true })).toBeVisible();
    const erc20 = page.getByRole("group", { name: "Place facet" }).getByRole("option", { name: /^Place ERC20 / });
    await expect.element(erc20.getByText("place erc20", { exact: true })).toBeVisible();
    await expect.element(erc20).toMatchTextContent(/Build/);
    const recipe = page.getByRole("group", { name: "Recipes" }).getByRole("option", { name: /^Recipe: GovernedVault/ });
    await expect.element(recipe.getByText("recipe governedvault", { exact: true })).toBeVisible();
  });

  test("commands are ordered Sheet, Build, Session and the rest, before any facet", async () => {
    await renderWithStudio(<App />);
    await openFromOpener();
    const categories = [...document.querySelectorAll("[role=group]")]
      .find((g) => g.textContent?.startsWith("Commands"))
      ?.querySelectorAll("[role=option]");
    const order = ["Sheet", "Build", "Session", "Export", "Deploy", "Console", "Chain"];
    const ranks = [...(categories ?? [])].map((o) => order.findIndex((c) => o.textContent?.includes(c)));
    expect(ranks.length).toBeGreaterThan(2);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  test("a disabled row stays with its reason; Enter says why and keeps the palette open", async () => {
    await renderWithStudio(<App />);
    await openFromOpener();
    await userEvent.keyboard("deploy");
    const deploy = page.getByRole("option", { name: /^Deploy…/ });
    await expect.element(deploy).toHaveAttribute("aria-disabled", "true");
    await expect.element(deploy).toMatchTextContent(/Deploy… · Resolve 2 blockers/);
    expect(active()?.textContent).toMatch(/^Deploy…/);
    await userEvent.keyboard("{Enter}");
    await expect.element(palette()).toBeVisible();
    expect(ran).toEqual([]);
    expect(bufferedServices().log.at(-1)?.text).toBe("Resolve 2 blockers");
  });

  test("typing filters every group, groups kept in order; nothing matching says so", async () => {
    await renderWithStudio(<App />);
    await openFromOpener();
    await userEvent.keyboard("paus");
    expect(groupNames()).toEqual(["Place facet"]);
    await expect.element(page.getByRole("option", { name: /^Place ERC20Pausable/ })).toBeVisible();
    await expect.element(page.getByRole("option", { name: /^Place Pausable/ })).toBeVisible();
    await userEvent.fill(search(), "zzzz");
    await expect.element(page.getByText("Nothing matches “zzzz”.")).toBeVisible();
  });

  test("↑ ↓ wrap, Home and End jump, and the active row stays in view", async () => {
    await renderWithStudio(<App />);
    await openFromOpener();
    const first = active()?.id;
    await userEvent.keyboard("{ArrowUp}");
    const last = document.querySelectorAll("[role=option]");
    expect(active()).toBe(last[last.length - 1]);
    await expect.poll(() => inView(active())).toBe(true);
    await userEvent.keyboard("{ArrowDown}");
    expect(active()?.id).toBe(first);
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(active()).toBe(document.querySelectorAll("[role=option]")[2]);
    await userEvent.keyboard("{End}");
    expect(active()).toBe(last[last.length - 1]);
    await expect.poll(() => inView(active())).toBe(true);
    await userEvent.keyboard("{Home}");
    expect(active()?.id).toBe(first);
    await expect.poll(() => inView(active())).toBe(true);
  });

  test("Enter closes the palette, returns focus to where it was, then runs the row", async () => {
    await renderWithStudio(<App />);
    await openFromOpener();
    await userEvent.keyboard("tidy");
    await userEvent.keyboard("{Enter}");
    await expect.element(palette()).not.toBeInTheDocument();
    await expect.element(opener()).toHaveFocus();
    await expect.poll(() => ran).toEqual([{ id: "layout.tidy" }]);
    // Now it's Recent.
    await userEvent.keyboard("{Meta>}k{/Meta}");
    await expect.element(page.getByRole("group", { name: "Recent" }).getByRole("option")).toMatchTextContent(/^Tidy/);
  });

  test("Esc clears the query first, then closes; focus goes back", async () => {
    await renderWithStudio(<App />);
    await openFromOpener();
    await userEvent.keyboard("tidy");
    await userEvent.keyboard("{Escape}");
    await expect.element(search()).toHaveValue("");
    await expect.element(palette()).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(palette()).not.toBeInTheDocument();
    await expect.element(opener()).toHaveFocus();
    expect(ran).toEqual([]);
  });

  test("⌘K again closes it, and focus goes back", async () => {
    await renderWithStudio(<App />);
    await openFromOpener();
    await userEvent.keyboard("{Meta>}k{/Meta}");
    await expect.element(palette()).not.toBeInTheDocument();
    await expect.element(opener()).toHaveFocus();
  });

  test("it never opens over a modal dialog", async () => {
    await renderWithStudio(<App />);
    await page.getByRole("button", { name: "Shortcuts" }).click();
    await expect.element(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
    // Focus is in the dialog's search field, where ⌘K would otherwise be live.
    await userEvent.keyboard("{Meta>}k{/Meta}");
    await expect.element(palette()).not.toBeInTheDocument();
    expect(bufferedServices().log.at(-1)?.text).toBe(DIALOG_OPEN);
    const outcome = await runCommand({ id: "palette.open" }, "menu");
    expect(outcome).toEqual({ ok: false, reason: DIALOG_OPEN });
    expect(session.get().dialogs).toHaveLength(1);
    await expect.element(palette()).not.toBeInTheDocument();
  });

  test("Add facet here… lists only facets and places at the stored pointer position", async () => {
    await renderWithStudio(<App />);
    (opener().element() as HTMLElement).focus();
    await runCommand({ id: "palette.open", args: { mode: "facets", at: { x: 320, y: 180 } } }, "menu");
    const dialog = page.getByRole("dialog", { name: "Add facet here…" });
    await expect.element(dialog).toBeVisible();
    await expect.element(page.getByRole("combobox", { name: "Search facets" })).toHaveFocus();
    expect(groupNames()).toEqual(["Place facet"]);
    await userEvent.keyboard("erc20permit");
    await userEvent.keyboard("{Enter}");
    await expect.element(dialog).not.toBeInTheDocument();
    await expect.poll(() => ran).toEqual([{ id: "facet.place", args: { facet: "ERC20Permit", at: { x: 320, y: 180 } } }]);
    await expect.element(opener()).toHaveFocus();
  });

  test("Add facet here… from a context menu: focus goes to the palette, then back to the sheet region", async () => {
    await renderWithStudio(
      <>
        <ContextMenu
          label="Sheet actions"
          items={<MenuCommandItem command={{ id: "palette.open", args: { mode: "facets", at: { x: 64, y: 96 } } }} />}
        >
          <section data-region="sheet" aria-label="Sheet" tabIndex={-1}>
            Sheet
          </section>
        </ContextMenu>
        <CommandPalette preload={never} />
      </>,
    );
    const sheet = page.getByRole("region", { name: "Sheet" });
    (sheet.element() as HTMLElement).focus();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    await expect.element(page.getByRole("menuitem", { name: "Add facet here…" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    const dialog = page.getByRole("dialog", { name: "Add facet here…" });
    await expect.element(dialog).toBeVisible();
    await expect.element(page.getByRole("combobox", { name: "Search facets" })).toHaveFocus();
    // The menu item that opened it is gone: Esc lands on the sheet region, not the body.
    await userEvent.keyboard("{Escape}");
    await expect.element(dialog).not.toBeInTheDocument();
    await expect.element(sheet).toHaveFocus();
  });

  test("a dialog run from the palette takes focus, and closing it returns to the palette's opener", async () => {
    await renderWithStudio(<App />);
    await openFromOpener();
    await userEvent.keyboard("keyboard shortcuts");
    await userEvent.keyboard("{Enter}");
    await expect.element(palette()).not.toBeInTheDocument();
    const shortcuts = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect.element(shortcuts).toBeVisible();
    await expect.element(shortcuts.getByRole("textbox", { name: "Search" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect.element(shortcuts).not.toBeInTheDocument();
    await expect.element(opener()).toHaveFocus();
  });

  test("reopening over an open palette keeps the first opener", async () => {
    await renderWithStudio(<App />);
    await openFromOpener();
    await runCommand({ id: "palette.open", args: { mode: "facets" } }, "menu");
    await expect.element(page.getByRole("combobox", { name: "Search facets" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    await expect.element(opener()).toHaveFocus();
  });

  test("placed facets say On sheet", async () => {
    await renderWithStudio(<App />, { project: makeProject({ recipe: makeRecipe({ facets: ["ERC20"] }, fixtureCatalog()) }) });
    await openFromOpener();
    await userEvent.keyboard("erc20");
    const facets = page.getByRole("group", { name: "Place facet" });
    await expect.element(facets.getByRole("option", { name: /^Place ERC20 · On sheet/ })).toBeVisible();
    await expect.element(facets.getByRole("option", { name: /^Place ERC20Permit Build/ })).toBeVisible();
  });
});

describe("Command palette: themes and motion", () => {
  for (const theme of ["dark", "light"] as const) {
    test(`${theme}: no axe violations with a disabled row active, 560 px wide`, async () => {
      await renderWithStudio(<App />, { theme });
      await openFromOpener();
      await userEvent.keyboard("deploy");
      expect(active()?.getAttribute("aria-disabled")).toBe("true");
      expect(await axeViolations(palette().element())).toEqual([]);
      expect((palette().element() as HTMLElement).getBoundingClientRect().width).toBe(560);
    });
  }

  test("reduced motion: the palette opens and closes without a transition", async () => {
    await renderWithStudio(<App />, { settings: { reduceMotion: "on" } });
    await openFromOpener();
    expect(parseFloat(getComputedStyle(palette().element()).transitionDuration)).toBeLessThan(0.001);
    await userEvent.keyboard("{Escape}");
    await expect.element(palette()).not.toBeInTheDocument();
  });
});

function inView(element: HTMLElement | null): boolean {
  const list = element?.closest("[role=listbox]");
  if (!element || !list) return false;
  const a = element.getBoundingClientRect();
  const b = list.getBoundingClientRect();
  return a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
}
