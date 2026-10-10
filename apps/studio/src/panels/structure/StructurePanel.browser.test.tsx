import type { CommandArgs } from "@/contracts";
import type { CommandId, Recipe } from "@lattice-studio/core";
import { blankDiamond, CORE_FACETS, loadTemplate } from "@lattice-studio/core";
import { makeProject, makeRecipe } from "@lattice-studio/core/testing";
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
  test("facets grouped by area, named as their cards, then Problems and Init plan; one Tab stop", async () => {
    await renderTree(template("GovernedVault"));
    const tokens = page.getByRole("treeitem", { name: "Tokens, 3 facets" });
    await expect.element(tokens).toHaveAttribute("aria-level", "1");
    await expect.element(tokens).toHaveAttribute("aria-expanded", "true");
    const erc20 = page.getByRole("treeitem", { name: "ERC20, 9 selectors, 4 served by other facets" });
    await expect.element(erc20).toHaveAttribute("aria-level", "2");
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

describe("Structure tree: area groups (the boards' Recipe outline)", () => {
  test("Core first, then one group per area in name order, each with its cards in recipe order", async () => {
    await renderTree(template("GovernedVault"));
    const roots = [...document.querySelectorAll<HTMLElement>('[role="treeitem"][aria-level="1"]')].map((r) => r.dataset.treeId);
    expect(roots).toEqual(["core", "area:access", "area:defi", "area:diamond", "area:governance", "area:security", "area:tokens", "problems", "init"]);
    await expect.element(page.getByRole("treeitem", { name: "DeFi, 2 facets" })).toBeVisible();
    const governance = [...document.querySelectorAll<HTMLElement>('[role="treeitem"][aria-level="2"]')]
      .map((r) => r.dataset.treeId)
      .filter((id) => ["facet:GovernedDiamondCut", "facet:Governor", "facet:TimelockController", "facet:Votes"].includes(id ?? ""));
    expect(governance).toEqual(["facet:GovernedDiamondCut", "facet:Governor", "facet:TimelockController", "facet:Votes"]);
  });

  test("← and Enter close a group, → and Space open it; arrows walk from a group into its cards", async () => {
    await renderTree(template("GovernedVault"));
    row("area:defi").focus();
    await userEvent.keyboard("{ArrowLeft}");
    await expect.element(page.getByRole("treeitem", { name: "DeFi, 2 facets" })).toHaveAttribute("aria-expanded", "false");
    expect(document.querySelector('[data-tree-id="facet:VaultCore"]')).toBeNull();
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(page.getByRole("treeitem", { name: "DeFi, 2 facets" })).toHaveAttribute("aria-expanded", "true");
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByRole("treeitem", { name: "DeFi, 2 facets" })).toHaveAttribute("aria-expanded", "false");
    await userEvent.keyboard(" ");
    await expect.element(page.getByRole("treeitem", { name: "DeFi, 2 facets" })).toHaveAttribute("aria-expanded", "true");
    await userEvent.keyboard("{ArrowDown}");
    expect(focusedId()).toBe("facet:GovernedVault");
    await userEvent.keyboard("{ArrowLeft}");
    expect(focusedId()).toBe("area:defi");
    // A group isn't a facet: selecting it leaves the sheet's selection alone.
    expect(session.get().selection).toEqual([]);
  });

  test("a facet selected on the sheet opens its closed group, and a newly placed facet's group starts open", async () => {
    await renderTree(template("GovernedVault"));
    row("area:tokens").focus();
    await userEvent.keyboard("{ArrowLeft}");
    await expect.element(page.getByRole("treeitem", { name: "Tokens, 3 facets" })).toHaveAttribute("aria-expanded", "false");
    (document.activeElement as HTMLElement | null)?.blur();
    session.set({ selection: ["ERC4626"] });
    await expect.element(page.getByRole("treeitem", { name: "Tokens, 3 facets" })).toHaveAttribute("aria-expanded", "true");
    await expect.element(page.getByRole("treeitem", { name: /^ERC4626, / })).toHaveAttribute("aria-selected", "true");
    // HyperlaneGatewayAdapter brings the Crosschain group, open.
    doc.apply("Placed", (p) => ({
      project: { ...p, recipe: makeRecipe({ ...p.recipe, facets: [...p.recipe.facets, "HyperlaneGatewayAdapter"] }, catalog) },
      changed: true,
      summary: "Placed",
    }));
    await expect.element(page.getByRole("treeitem", { name: "Crosschain, 1 facet" })).toHaveAttribute("aria-expanded", "true");
    await expect.element(page.getByRole("treeitem", { name: /^HyperlaneGatewayAdapter, / })).toBeVisible();
  });
});

describe("Structure tree: the core", () => {
  const REFUSAL = "DiamondLoupeFacet is the diamond's core and stays.";

  /** `facet.remove` as A registers it: a core facet is refused with the reason (pinned here, so the test doesn't depend on A). */
  function refuseCoreRemoval(): void {
    overrideCommands([
      command<{ facets: string[] }>({
        id: "facet.remove", title: () => "Remove", category: "Build",
        enabled: (_ctx, { facets }) => {
          const core = facets.find((name) => (CORE_FACETS as readonly string[]).includes(name));
          return core === undefined ? { ok: true } : { ok: false, reason: `${core} is the diamond's core and stays.` };
        },
        run: () => undefined,
      }),
    ]);
  }

  test("the Core group leads the tree, expanded: the fallback, DiamondLoupeFacet and ERC165Facet; a core-only sheet says so", async () => {
    await renderTree(makeRecipe({ facets: [...CORE_FACETS] }, catalog));
    await expect.element(page.getByText("Core only")).toBeVisible();
    const core = page.getByRole("treeitem", { name: "Core", exact: true });
    await expect.element(core).toHaveAttribute("aria-level", "1");
    await expect.element(core).toHaveAttribute("aria-expanded", "true");
    const ids = [...document.querySelectorAll<HTMLElement>("[data-tree-id]")].map((r) => r.dataset.treeId);
    expect(ids.slice(0, 4)).toEqual(["core", "core:fallback", "core:facet:DiamondLoupeFacet", "core:facet:ERC165Facet"]);
    await expect.element(page.getByRole("treeitem", { name: "Fallback · 5 routed" })).toBeVisible();
    await expect.element(page.getByRole("treeitem", { name: "DiamondLoupeFacet, 4 selectors" })).toBeVisible();
    expect(document.querySelectorAll('[role="treeitem"][tabindex="0"]')).toHaveLength(1);
    expect(row("core").tabIndex).toBe(0);
  });

  test("with cards, the tree reads Core, the cards' areas, Problems and Init plan; no Core only line", async () => {
    await renderTree(template("ERC20"));
    expect(page.getByText("Core only").elements()).toHaveLength(0);
    const roots = [...document.querySelectorAll<HTMLElement>('[role="treeitem"][aria-level="1"]')].map((r) => r.dataset.treeId);
    expect(roots).toEqual(["core", "area:diamond", "area:tokens", "problems", "init"]);
  });

  test("Enter or Space on the group or the fallback selects the core; the group shows selected while it is", async () => {
    await renderTree(template("ERC20"));
    session.set({ selection: ["ERC20"] });
    row("core").focus();
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => session.get().coreSelected).toBe(true);
    expect(session.get().selection).toEqual([]);
    await expect.element(page.getByRole("treeitem", { name: "Core", exact: true })).toHaveAttribute("aria-selected", "true");
    expect(lastAnnounce()).toBe("Selected the core.");
    // Esc deselects it from the session; Space on the fallback selects it again.
    session.set({ coreSelected: false });
    await expect.element(page.getByRole("treeitem", { name: "Core", exact: true })).toHaveAttribute("aria-selected", "false");
    row("core:fallback").focus();
    await userEvent.keyboard(" ");
    await expect.poll(() => session.get().coreSelected).toBe(true);
    // A click on a core facet's row selects the core too, never the facet.
    session.set({ coreSelected: false });
    await page.getByRole("treeitem", { name: "ERC165Facet, 1 selector" }).click();
    await expect.poll(() => session.get().coreSelected).toBe(true);
    expect(session.get().selection).toEqual([]);
  });

  test("Enter on a core facet opens it in the inspector; → shows its selectors", async () => {
    const shown = spy("inspector.show");
    await renderTree(template("ERC20"));
    row("core:facet:DiamondLoupeFacet").focus();
    await userEvent.keyboard("{Enter}");
    expect(shown).toEqual([{ facet: "DiamondLoupeFacet" }]);
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    expect(focusedId()).toMatch(/^core:selector:DiamondLoupeFacet:0x/);
    expect(row(focusedId() ?? "").getAttribute("aria-label")).toMatch(/, routes here$/);
  });

  test("Delete on a core facet asks to remove it: the refusal shows, focus stays, nothing changes", async () => {
    refuseCoreRemoval();
    const recipe = template("ERC20");
    await renderTree(recipe);
    row("core:facet:DiamondLoupeFacet").focus();
    await userEvent.keyboard("{Delete}");
    expect(lastLog()).toBe(REFUSAL);
    expect(lastAnnounce()).toBe(REFUSAL);
    expect(focusedId()).toBe("core:facet:DiamondLoupeFacet");
    expect(doc.get().recipe).toEqual(recipe);
    // On the group, the refusal names the core's first facet.
    row("core").focus();
    await userEvent.keyboard("{Backspace}");
    expect(lastLog()).toBe(REFUSAL);
    expect(focusedId()).toBe("core");
  });

  test("a core row's menu offers Open in inspector and Select the core, and nothing that moves or removes", async () => {
    const shown = spy("inspector.show");
    await renderTree(template("ERC20"));
    row("core:facet:ERC165Facet").focus();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    const menu = page.getByRole("menu", { name: "ERC165Facet actions" });
    await expect.element(menu).toBeVisible();
    expect(menu.getByRole("menuitem").elements()).toHaveLength(2);
    await expect.element(menu.getByRole("menuitem", { name: "Select the core" })).toBeVisible();
    await menu.getByRole("menuitem", { name: "Open in inspector" }).click();
    expect(shown).toEqual([{ facet: "ERC165Facet" }]);
    row("core").focus();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    const coreMenu = page.getByRole("menu", { name: "Core actions" });
    await coreMenu.getByRole("menuitem", { name: "Select the core" }).click();
    await expect.poll(() => session.get().coreSelected).toBe(true);
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
    await page.getByRole("treeitem", { name: /^Governor, / }).click();
    await userEvent.keyboard("{Shift>}{ArrowUp}{/Shift}{Backspace}");
    expect(doc.get().recipe.facets).not.toContain("Governor");
    expect(doc.get().recipe.facets).not.toContain("GovernedDiamondCut");
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

describe("Structure tree: names at the default 240 px pane (ST-01)", () => {
  /** Text runs that wrap onto a second line. Problems wrap their sentences, so they're left out. */
  function wrappedRows(): string[] {
    const wrapped: string[] = [];
    for (const item of document.querySelectorAll<HTMLElement>('[role="treeitem"]')) {
      if (item.dataset.treeId?.startsWith("problem:")) continue;
      const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const tops = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)));
        if (tops.size > 1) wrapped.push(`${item.dataset.treeId}: ${node.textContent}`);
      }
    }
    return wrapped;
  }

  test("long facet names and Init plan stay on one line, cut with an ellipsis, never broken mid-word", async () => {
    const vault = template("GovernedVault");
    const long = "L1ToL2CrossDomainMessengerGatewayAdapter";
    const recipe = { ...vault, facets: [...vault.facets, long, "CCIPGatewayAdapter"] };
    await renderWithStudio(
      <div style={{ inlineSize: 240, blockSize: 900, display: "flex", flexDirection: "column" }}>
        <StructurePanel />
      </div>,
      { project: makeProject({ recipe }) },
    );
    await expect.element(page.getByRole("treeitem", { name: /^Init plan/ })).toBeVisible();
    expect(wrappedRows()).toEqual([]);
    // The group label keeps its two words whole: no "I / n / i / t" column.
    const label = [...row("init").querySelectorAll("span")].find((span) => span.textContent === "Init plan");
    expect(label).toBeDefined();
    expect(label!.scrollWidth).toBeLessThanOrEqual(label!.clientWidth);
    // A cut name keeps the whole name a hover away.
    const name = [...row(`facet:${long}`).querySelectorAll("span")].find((span) => span.textContent === long);
    expect(name?.title).toBe(long);
  });
});
