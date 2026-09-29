import type { CommandArgs } from "@/contracts";
import type { CommandId, Recipe } from "@lattice-studio/core";
import { blankDiamond, loadTemplate } from "@lattice-studio/core";
import { makeProject } from "@lattice-studio/core/testing";
import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { command, doc, history, session } from "@/contracts";
import { axeViolations } from "@/ui/testing/axe";
import { bufferedServices, fixtureCatalog, onCleanup, overrideCommands, renderWithStudio } from "../../../test/harness";
import { StructurePanel } from "./StructurePanel";

const catalog = fixtureCatalog();

function template(name: string): Recipe {
  const r = loadTemplate(catalog, name);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

function collision(): Recipe {
  const blank = blankDiamond(catalog);
  return { ...blank, facets: [...blank.facets, "AxelarGatewayAdapter", "HyperlaneGatewayAdapter"] };
}

const twoSteps = (): Recipe => ({
  ...template("ERC20"),
  init: { kind: "steps", steps: [{ spec: "ERC20Init", args: { name_: "Token", symbol_: "TKN" } }, { spec: "AccessControlInit", args: {} }] },
});

async function renderTree(recipe: Recipe, options: { theme?: "dark" | "light" } = {}) {
  const screen = await renderWithStudio(<StructurePanel />, { project: makeProject({ recipe }), ...options });
  await expect.element(page.getByRole("tree", { name: "Structure" })).toBeVisible();
  return screen;
}

function row(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-tree-id="${CSS.escape(id)}"]`);
  if (!el) throw new Error(`No row ${id}`);
  return el;
}

const focusedId = () => (document.activeElement as HTMLElement | null)?.dataset.treeId;
const lastLog = () => bufferedServices().log.at(-1)?.text;
const lastAnnounce = () => bufferedServices().announce.at(-1)?.[0];

/** Replaces a command with one that records its arguments. */
function spy(id: CommandId): CommandArgs[] {
  const calls: CommandArgs[] = [];
  overrideCommands([
    command({
      id, title: () => id, category: "Build", enabled: () => ({ ok: true }),
      run: (_ctx, args) => {
        calls.push(args);
      },
    }),
  ]);
  return calls;
}

describe("Structure tree: shape and names", () => {
  test("facets at the root, named as their cards, then Problems and Init plan; one Tab stop", async () => {
    await renderTree(template("GovernedVault"));
    const erc20 = page.getByRole("treeitem", { name: "ERC20, 9 selectors, 4 served by other facets" });
    await expect.element(erc20).toHaveAttribute("aria-level", "1");
    await expect.element(erc20).toHaveAttribute("aria-expanded", "false");
    await expect.element(page.getByRole("treeitem", { name: /^Problems, \d+$/ })).toHaveAttribute("aria-expanded", "true");
    await expect.element(page.getByRole("treeitem", { name: "Init plan, GovernedVaultInit bundle" })).toBeVisible();
    // A facet's connections are its description (spec L746).
    const vaultCore = row("facet:VaultCore");
    const description = document.getElementById(vaultCore.getAttribute("aria-describedby") ?? "");
    expect(description?.textContent).toContain("Needs ERC4626");
    expect(document.querySelectorAll('[role="treeitem"][tabindex="0"]')).toHaveLength(1);
  });

  test("no axe violations in Dark and Light", async () => {
    for (const theme of ["dark", "light"] as const) {
      const screen = await renderTree(collision(), { theme });
      row("facet:AxelarGatewayAdapter").focus();
      await userEvent.keyboard("{ArrowRight}");
      expect(await axeViolations(screen.container)).toEqual([]);
      await screen.unmount();
    }
  });
});

describe("Structure tree: facets", () => {
  test("a click selects and ⇧ + arrows extend the selection; the session follows (sync from the tree)", async () => {
    await renderTree(template("GovernedVault"));
    await page.getByRole("treeitem", { name: /^ERC20, / }).click();
    expect(session.get().selection).toEqual(["ERC20"]);
    await userEvent.keyboard("{Shift>}{ArrowDown}{ArrowDown}{/Shift}");
    expect(session.get().selection).toEqual(["ERC20", "ERC20Votes", "ERC4626"]);
    await expect.element(page.getByRole("treeitem", { name: /^ERC4626, / })).toHaveAttribute("aria-selected", "true");
    // Space toggles one out.
    await userEvent.keyboard(" ");
    expect(session.get().selection).toEqual(["ERC20", "ERC20Votes"]);
  });

  test("selecting one facet locates its card, once per click or Space (spec L483)", async () => {
    const located = spy("sheet.locate");
    await renderTree(template("GovernedVault"));
    await page.getByRole("treeitem", { name: /^ERC4626, / }).click();
    expect(located).toEqual([{ facet: "ERC4626" }]);
    // Clicking it again locates it again, though the selection doesn't change.
    await page.getByRole("treeitem", { name: /^ERC4626, / }).click();
    expect(located).toHaveLength(2);
    // Space deselects (nothing to locate), then selects it alone: located.
    await userEvent.keyboard("  ");
    expect(session.get().selection).toEqual(["ERC4626"]);
    expect(located).toEqual([{ facet: "ERC4626" }, { facet: "ERC4626" }, { facet: "ERC4626" }]);
  });

  test("a selection made on the sheet shows in the tree and takes its Tab stop (sync to the tree)", async () => {
    await renderTree(template("GovernedVault"));
    // Focus is elsewhere (on the sheet, say): the tree moves its Tab stop but never takes focus.
    const outside = document.createElement("button");
    outside.textContent = "Outside";
    document.body.append(outside);
    onCleanup(() => outside.remove());
    outside.focus();
    session.set({ selection: ["Governor", "Votes"] });
    await expect.element(page.getByRole("treeitem", { name: /^Governor, / })).toHaveAttribute("aria-selected", "true");
    await expect.element(page.getByRole("treeitem", { name: /^Votes, / })).toHaveAttribute("aria-selected", "true");
    await expect.element(page.getByRole("treeitem", { name: /^ERC20, / })).toHaveAttribute("aria-selected", "false");
    await expect.poll(() => row("facet:Votes").tabIndex).toBe(0);
    expect(document.activeElement).toBe(outside);
    session.set({ selection: [] });
    await expect.element(page.getByRole("treeitem", { name: /^Votes, / })).toHaveAttribute("aria-selected", "false");
  });

  test("Enter opens the facet in the inspector; → shows its selectors", async () => {
    const shown = spy("inspector.show");
    await renderTree(template("GovernedVault"));
    row("facet:ERC4626").focus();
    await userEvent.keyboard("{Enter}");
    expect(shown).toEqual([{ facet: "ERC4626" }]);
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(page.getByRole("treeitem", { name: /^ERC4626, / })).toHaveAttribute("aria-expanded", "true");
    await userEvent.keyboard("{ArrowRight}");
    expect(focusedId()).toMatch(/^selector:ERC4626:0x/);
  });

  test("Delete removes the focused facet as one undo step, and focus moves to the next facet", async () => {
    await renderTree(template("GovernedVault"));
    row("facet:Votes").focus();
    await userEvent.keyboard("{Delete}");
    expect(doc.get().recipe.facets).not.toContain("Votes");
    await expect.poll(focusedId).toBe("facet:EmergencyStop");
    expect(history.undo()).toBe("Removed Votes");
    expect(doc.get().recipe.facets).toContain("Votes");
  });

  test("Delete removes the selection when the focused facet is in it", async () => {
    await renderTree(template("GovernedVault"));
    await page.getByRole("treeitem", { name: /^Receive, / }).click();
    await userEvent.keyboard("{Shift>}{ArrowUp}{/Shift}{Backspace}");
    expect(doc.get().recipe.facets).not.toContain("Receive");
    expect(doc.get().recipe.facets).not.toContain("AccessControl");
    expect(session.get().selection).toEqual([]);
  });

  test("read-only: Delete changes nothing and says why", async () => {
    const recipe = template("GovernedVault");
    await renderTree(recipe);
    session.set({ readOnly: "Read-only: this project is open in another tab" });
    row("facet:Votes").focus();
    await userEvent.keyboard("{Delete}");
    expect(doc.get().recipe.facets).toEqual(recipe.facets);
    expect(lastLog()).toBe("Read-only: this project is open in another tab");
    expect(focusedId()).toBe("facet:Votes");
  });

  test("the menu key opens the facet's menu with Move to…, selecting the facet first", async () => {
    const moved = spy("sheet.moveTo");
    await renderTree(template("GovernedVault"));
    row("facet:Governor").focus();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    const menu = page.getByRole("menu", { name: "Governor actions" });
    await expect.element(menu).toBeVisible();
    expect(session.get().selection).toEqual(["Governor"]);
    const item = menu.getByRole("menuitem", { name: "Move to…" });
    await item.click();
    expect(moved).toHaveLength(1);
  });

  test("Move to… says why when it can't run", async () => {
    // Pinned, so the test doesn't depend on S4e being unbuilt.
    overrideCommands([
      command({
        id: "sheet.moveTo", title: () => "Move to…", category: "Sheet",
        enabled: () => ({ ok: false, reason: "Not built yet · WP-S4e" }), run: () => undefined,
      }),
    ]);
    await renderTree(template("GovernedVault"));
    row("facet:Governor").focus();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    const item = page.getByRole("menu", { name: "Governor actions" }).getByRole("menuitem", { name: "Move to…" });
    await expect.element(item).toHaveAttribute("aria-disabled", "true");
    await expect.element(item).toHaveAccessibleDescription("Not built yet · WP-S4e");
    await userEvent.keyboard("{Escape}");
    await expect.poll(focusedId).toBe("facet:Governor");
  });
});

describe("Structure tree: selectors", () => {
  test("Space does what a pin click does: leave out, then bring back, one undo step each", async () => {
    await renderTree(template("ERC20"));
    row("facet:ERC20").focus();
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    const id = focusedId() ?? "";
    const hex = id.split(":").at(-1) ?? "";
    expect(row(id).getAttribute("aria-label")).toMatch(/, routes here$/);
    await userEvent.keyboard(" ");
    expect(doc.get().recipe.exclude).toContain(hex);
    await expect.poll(() => row(id).getAttribute("aria-label")).toMatch(/, not in the diamond$/);
    expect(focusedId()).toBe(id);
    await userEvent.keyboard(" ");
    expect(doc.get().recipe.exclude).not.toContain(hex);
    expect(history.undo()).not.toBeNull();
    expect(doc.get().recipe.exclude).toContain(hex);
  });

  test("Space on a contested selector routes it here; the collision settles", async () => {
    await renderTree(collision());
    row("facet:HyperlaneGatewayAdapter").focus();
    await userEvent.keyboard("{ArrowRight}");
    const contested = [...document.querySelectorAll<HTMLElement>('[data-kind="selector"][data-state="contested"]')];
    const first = contested.find((el) => el.dataset.treeId?.startsWith("selector:HyperlaneGatewayAdapter:"));
    if (!first) throw new Error("no contested selector on Hyperlane");
    first.focus();
    await userEvent.keyboard(" ");
    const hex = first.dataset.treeId?.split(":").at(-1) ?? "";
    expect(doc.get().recipe.owners).toMatchObject({ [hex]: "HyperlaneGatewayAdapter" });
  });

  test("a seam offers no route and says why; Enter opens the facet's selectors", async () => {
    const focused = spy("inspector.focusSelectors");
    const recipe = template("GovernedVault");
    await renderTree(recipe);
    row("facet:ERC20Votes").focus();
    await userEvent.keyboard("{ArrowRight}");
    const seam = document.querySelector<HTMLElement>('[data-kind="selector"][data-state="seam"]');
    if (!seam) throw new Error("no seam row");
    seam.focus();
    await userEvent.keyboard(" ");
    expect(lastAnnounce()).toMatch(/^Seam: stays on \w+/);
    expect(doc.get().recipe).toEqual(recipe);
    await userEvent.keyboard("{Enter}");
    expect(focused).toEqual([{ facet: "ERC20Votes" }]);
  });
});

describe("Structure tree: problems", () => {
  test("one entry per problem, with its severity in words; Enter focuses its note as F8 does", async () => {
    const focusedNote = spy("problem.focus");
    await renderTree(collision());
    const problem = page.getByRole("treeitem", { name: /^Blocker: sendMessage\(bytes,bytes,bytes\[\]\) 0xcdfe7f5c/ });
    await expect.element(problem).toBeVisible();
    (await problem.element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    expect(focusedNote).toEqual([{ problemId: "SEL-01:0xcdfe7f5c" }]);
  });

  test("Enter or Space on the Problems branch opens and closes it; a problem can't be selected", async () => {
    await renderTree(collision());
    session.set({ selection: ["AxelarGatewayAdapter"] });
    row("problems").focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByRole("treeitem", { name: /^Problems, \d+$/ })).toHaveAttribute("aria-expanded", "false");
    await userEvent.keyboard(" ");
    await expect.element(page.getByRole("treeitem", { name: /^Problems, \d+$/ })).toHaveAttribute("aria-expanded", "true");
    await page.getByRole("treeitem", { name: /^Blocker: sendMessage/ }).click();
    expect(session.get().selection).toEqual(["AxelarGatewayAdapter"]);
    expect(row("problem:SEL-01:0xcdfe7f5c").getAttribute("aria-selected")).toBe("false");
  });

  test("the problem's menu offers its fixes: Keep {A} settles the collision", async () => {
    await renderTree(collision());
    row("problem:SEL-01:0xcdfe7f5c").focus();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    const menu = page.getByRole("menu", { name: "SEL-01 actions" });
    await menu.getByRole("menuitem", { name: "Keep AxelarGatewayAdapter" }).click();
    expect(doc.get().recipe.owners).toMatchObject({ "0xcdfe7f5c": "AxelarGatewayAdapter" });
  });
});

describe("Structure tree: init plan", () => {
  test("Alt + ↓ moves a step as one undo step, and focus moves with it", async () => {
    await renderTree(twoSteps());
    row("step:ERC20Init").focus();
    await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");
    const steps = () => {
      const init = doc.get().recipe.init;
      return init.kind === "steps" ? init.steps.map((s) => s.spec) : [];
    };
    expect(steps()).toEqual(["AccessControlInit", "ERC20Init"]);
    await expect.element(page.getByRole("treeitem", { name: "Step 2, ERC20Init, init(string,string)" })).toBeVisible();
    await expect.poll(focusedId).toBe("step:ERC20Init");
    expect(history.canUndo).toBe(true);
    history.undo();
    expect(steps()).toEqual(["ERC20Init", "AccessControlInit"]);
    expect(history.canUndo).toBe(false);
    // Alt + ↑ from the first place says so and changes nothing.
    await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");
    expect(lastAnnounce()).toBe("ERC20Init is already the first step.");
    expect(history.canUndo).toBe(false);
  });

  test("Alt + ↑ moves a step up; the automatic step stays last and says so", async () => {
    await renderTree(twoSteps());
    row("step:AccessControlInit").focus();
    await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");
    const init = doc.get().recipe.init;
    expect(init.kind === "steps" ? init.steps.map((s) => s.spec) : []).toEqual(["AccessControlInit", "ERC20Init"]);
    row("step:auto").focus();
    await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");
    expect(lastAnnounce()).toBe("Register ERC-165 interfaces (automatic) always runs last.");
  });

  test("a bundle's order is read-only", async () => {
    const recipe = template("GovernedVault");
    await renderTree(recipe);
    row("step:bundle").focus();
    await userEvent.keyboard("{ArrowRight}{ArrowRight}{ArrowDown}");
    expect(focusedId()).toBe("sequence:1");
    await expect.element(page.getByRole("treeitem", { name: "EmergencyStop, 2 of 14, read-only" })).toHaveFocus();
    await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");
    expect(lastAnnounce()).toBe("GovernedVaultInit is a bundle: its order is fixed.");
    expect(doc.get().recipe).toEqual(recipe);
  });

  test("Enter on Init plan and on a step opens the plan there", async () => {
    const opened = spy("init.open");
    await renderTree(twoSteps());
    row("init").focus();
    await userEvent.keyboard("{Enter}");
    row("step:AccessControlInit").focus();
    await userEvent.keyboard("{Enter}");
    expect(opened).toEqual([{}, { focus: "steps[1]" }]);
  });
});
