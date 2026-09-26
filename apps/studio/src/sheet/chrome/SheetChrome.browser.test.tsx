import type { CommandRef, Project, Recipe } from "@lattice-studio/core";
import { makeProject } from "@lattice-studio/core/testing";
import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import {
  command, commandState, doc, getCommand, history, provideServices, runCommand, session, settings, type ProjectsService,
} from "@/contracts";
import { focusCard } from "@/a11y/focus";
import { runEscape } from "@/commands/escape";
import { installShortcuts } from "@/commands/keys/dispatcher";
import { Sheet } from "@/sheet/canvas/Sheet";
import { sheetViewport } from "@/sheet/canvas/sheet-view";
import { emptyProject, settled } from "@/sheet/canvas/testing/sheet-harness";
import { cardProject } from "@/sheet/card/testing/projects";
import { templateProject } from "@/chain/review/test-support";
import { DialogHost } from "@/ui/overlays/DialogHost";
import {
  bufferedServices, fixtureCatalog, onCleanup, overrideCommands, renderWithStudio, type StudioOptions,
} from "../../../test/harness";
import { INIT_ORDER_ON } from "./commands";

/** The sheet in a 1000 × 700 region with the dialog host beside it, motion reduced, the view applied. */
async function renderChrome(options: StudioOptions = {}) {
  const screen = await renderWithStudio(
    <>
      <div data-region="sheet" tabIndex={-1} style={{ position: "relative", width: 1000, height: 700 }}>
        <Sheet />
      </div>
      <DialogHost />
    </>,
    { ...options, settings: { reduceMotion: "on", ...options.settings } },
  );
  await settled();
  return screen;
}

const STEPS: Recipe["init"] = {
  kind: "steps",
  steps: [
    { spec: "ERC20Init", args: {} },
    { spec: "AccessControlInit", args: {} },
    { spec: "ERC4626Init", args: {} },
    { spec: "VaultCoreInit", args: {} },
  ],
};

/** Four step inits on four cards, and Receive with no step. */
function stepsProject(): Project {
  const project = cardProject(fixtureCatalog(), ["ERC20", "AccessControl", "ERC4626", "VaultCore", "Receive"], {
    columns: 3, rowPitch: 320,
  });
  return { ...project, recipe: { ...project.recipe, init: STEPS } };
}

function sheetRegion(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-region="sheet"]');
  if (!el) throw new Error("No sheet region.");
  return el;
}

function card(facet: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(facet)}"] [data-facet]`);
  if (!el) throw new Error(`${facet} has no card.`);
  return el;
}

function badge(facet: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(facet)}"] [data-init-step]`);
}

function stepSpecs(): string[] {
  const init = doc.get().recipe.init;
  return init.kind === "steps" ? init.steps.map((s) => s.spec) : [];
}

async function initOrderOn(): Promise<void> {
  await runCommand({ id: "initOrder.toggle" }, "button");
  await expect.poll(() => session.get().modes.initOrder).toBe(true);
}

describe("the Start block (spec L378, Flows 1-2)", () => {
  test("an empty sheet shows Start a diamond: Blank diamond, v1's three recipes, Browse all recipes, the hint and the tour line", async () => {
    await renderChrome({ project: emptyProject("empty") });
    const start = page.getByRole("region", { name: "Start a diamond" });
    await expect.element(start).toBeVisible();
    await expect.element(start.getByRole("button", { name: "Blank diamond (core only)" })).toBeVisible();
    for (const name of ["GovernedVault", "ERC20", "SafeDiamondCut"]) {
      await expect.element(start.getByRole("button", { name: new RegExp(`^${name} `) })).toBeVisible();
    }
    await expect.element(start.getByRole("button", { name: "Browse all recipes" })).toBeVisible();
    await expect.element(start.getByText(/^Drag from the catalog, or press (⌘K|Ctrl\+K)$/)).toBeVisible();
    await expect.element(start.getByText(/^New here\?/)).toBeVisible();
    await expect.element(start.getByRole("button", { name: "Take the 60-second tour" })).toBeVisible();
  });

  test("a recipe card loads the recipe in place on the empty sheet, and the block gives way to the cards", async () => {
    const project = emptyProject("empty");
    await renderChrome({ project });
    await page.getByRole("button", { name: /^GovernedVault / }).click();
    await expect.poll(() => doc.get().recipe.facets.length).toBe(14);
    expect(doc.get().id).toBe(project.id);
    await expect.element(page.getByRole("region", { name: "Start a diamond" })).not.toBeInTheDocument();
    await expect.poll(() => document.querySelectorAll(".react-flow__node[data-id]").length).toBe(14);
    expect(bufferedServices().log.some((l) => l.text.startsWith("Loaded GovernedVault"))).toBe(true);
    // One undo step: the empty sheet comes back, and with it the block.
    history.undo();
    await expect.poll(() => doc.get().recipe.facets.length).toBe(0);
    await expect.element(page.getByRole("region", { name: "Start a diamond" })).toBeVisible();
  });

  test("Blank diamond (core only) loads with Enter from the keyboard", async () => {
    await renderChrome({ project: emptyProject("empty") });
    const blank = page.getByRole("button", { name: "Blank diamond (core only)" });
    (blank.element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => doc.get().recipe.facets.length).toBeGreaterThan(0);
    expect(doc.get().id).toBe("empty");
    // The block and its button are gone: focus stays in the sheet, so the next Tab continues from there.
    await expect.poll(() => sheetRegion().contains(document.activeElement)).toBe(true);
  });

  test("Browse → Load on an empty sheet keeps focus in the sheet once the block is gone", async () => {
    await renderChrome({ project: emptyProject("empty") });
    await page.getByRole("button", { name: "Browse all recipes" }).click();
    const dialog = page.getByRole("dialog", { name: "Browse all recipes" });
    const load = dialog.getByRole("button", { name: "Load ERC20" });
    await expect.element(load).toBeVisible();
    (load.element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => doc.get().recipe.facets.length).toBe(4);
    await expect.element(dialog).not.toBeInTheDocument();
    await expect.poll(() => sheetRegion().contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(document.body);
  });

  test("a project that opens with cards keeps its focus", async () => {
    const outside = document.createElement("button");
    document.body.append(outside);
    onCleanup(() => outside.remove());
    outside.focus();
    await renderChrome({ project: stepsProject() });
    expect(document.activeElement).toBe(outside);
  });

  test("the tour line starts the tour", async () => {
    const ran: CommandRef[] = [];
    overrideCommands([
      command({ id: "tour.start", title: () => "Take the tour", category: "Session", enabled: () => ({ ok: true }), run: (ctx) => void ran.push(ctx.ref) }),
    ]);
    await renderChrome({ project: emptyProject("empty") });
    await page.getByRole("button", { name: "Take the 60-second tour" }).click();
    expect(ran).toEqual([{ id: "tour.start" }]);
  });

  test("Browse all recipes lists every recipe; v1.1 recipes say when they arrive and what they need", async () => {
    await renderChrome({ project: emptyProject("empty") });
    await page.getByRole("button", { name: "Browse all recipes" }).click();
    const dialog = page.getByRole("dialog", { name: "Browse all recipes" });
    await expect.element(dialog).toBeVisible();
    const rows = dialog.getByRole("listitem");
    await expect.poll(() => rows.elements().map((r) => r.getAttribute("data-recipe"))).toEqual([
      "GovernedVault", "ERC20", "SafeDiamondCut", "Account", "Account6900",
    ]);
    const account = dialog.getByRole("button", { name: "Load Account", exact: true });
    await expect.element(account).toHaveAttribute("aria-disabled", "true");
    await expect.element(account).toHaveAccessibleDescription("Arrives in v1.1 · Needs its own factory (AccountFactory)");
    await expect.element(dialog.getByRole("button", { name: "Load ERC20" })).not.toHaveAttribute("aria-disabled");
    await userEvent.keyboard("{Escape}");
    await expect.element(dialog).not.toBeInTheDocument();
  });

  test("new-project semantics: loading from Browse on a sheet with facets opens a new project and keeps this one", async () => {
    const created: { name: string; facets: number }[] = [];
    const projects: ProjectsService = {
      createProject: (recipe, name) => {
        created.push({ name, facets: recipe.facets.length });
        return Promise.resolve({ ok: true, value: makeProject({ id: "new", name, recipe }) });
      },
      openProject: () => Promise.reject(new Error("not in this test")),
      saveStatus: () => ({ state: "saved", text: "Saved" }),
      subscribeSaveStatus: () => () => undefined,
      loadViewport: () => Promise.resolve(null),
      saveViewport: () => undefined,
    };
    onCleanup(provideServices({ projects }));
    const project = stepsProject();
    await renderChrome({ project });
    await runCommand({ id: "recipe.browse" }, "palette");
    await page.getByRole("dialog", { name: "Browse all recipes" }).getByRole("button", { name: "Load ERC20" }).click();
    await expect.poll(() => created).toEqual([{ name: "ERC20", facets: 4 }]);
    expect(doc.get().recipe.facets).toEqual(project.recipe.facets);
    await expect.element(page.getByRole("dialog", { name: "Browse all recipes" })).not.toBeInTheDocument();
  });

  test("a sheet with facets shows no Start block", async () => {
    await renderChrome({ project: stepsProject() });
    await expect.element(page.getByRole("toolbar", { name: "Sheet tools" })).toBeVisible();
    expect(document.querySelector('[data-chrome="start"]')).toBeNull();
  });
});

describe("init order mode (spec L383, Flow 7 step 5)", () => {
  test("I turns it on over the sheet and says so; Esc leaves it", async () => {
    onCleanup(installShortcuts());
    await renderChrome({ project: stepsProject() });
    await focusCard("ERC20");
    await userEvent.keyboard("i");
    await expect.poll(() => session.get().modes.initOrder).toBe(true);
    expect(bufferedServices().announce.some(([text]) => text === INIT_ORDER_ON)).toBe(true);
    await expect.element(page.getByRole("button", { name: "Init order · Esc" })).toBeVisible();
    expect(runEscape()).toBe("initOrder");
    await expect.element(page.getByRole("button", { name: "Init order · Esc" })).not.toBeInTheDocument();
  });

  test("turning it on opens the init plan when it can, and says nothing more when it can't", async () => {
    const opened: CommandRef[] = [];
    let open = false;
    overrideCommands([
      command({
        id: "init.open", title: () => "Open init plan", category: "Build",
        enabled: () => (open ? { ok: true } : { ok: false, reason: "No plan yet" }),
        run: (ctx) => void opened.push(ctx.ref),
      }),
    ]);
    await renderChrome({ project: stepsProject() });
    await initOrderOn();
    expect(opened).toEqual([]);
    expect(bufferedServices().log.some((l) => l.text === "No plan yet")).toBe(false);
    expect(getCommand("initOrder.toggle").title({})).toBe("Hide init order");
    await runCommand({ id: "initOrder.toggle" }, "button");
    expect(getCommand("initOrder.toggle").title({})).toBe("Show init order");
    open = true;
    await initOrderOn();
    await expect.poll(() => opened).toEqual([{ id: "init.open" }]);
  });

  test("cards without a step dim to 35%; step badges number the order; a dashed path joins them; the legend lists it", async () => {
    await renderChrome({ project: stepsProject() });
    await initOrderOn();
    await expect.poll(() => badge("ERC20")?.textContent).toContain("01");
    expect(badge("AccessControl")?.textContent).toContain("02");
    expect(badge("ERC4626")?.textContent).toContain("03");
    expect(badge("VaultCore")?.textContent).toContain("04");
    expect(badge("Receive")).toBeNull();
    await expect.poll(() => getComputedStyle(card("Receive")).opacity).toBe("0.35");
    expect(getComputedStyle(card("ERC20")).opacity).toBe("1");
    await expect.poll(() => document.querySelector("[data-init-path] polyline")?.getAttribute("points")?.split(" ").length).toBe(4);
    const legend = page.getByRole("region", { name: "Init order" });
    await expect.element(legend).toBeVisible();
    expect(legend.getByRole("listitem").elements().map((li) => li.textContent)).toEqual([
      "01ERC20Init", "02AccessControlInit", "03ERC4626Init", "04VaultCoreInit", "05Register ERC-165 interfaces (automatic)",
    ]);
    await expect.element(legend.getByText("Drag a badge to reorder")).toBeVisible();
  });

  test("with the minimap showing, the legend sits under it", async () => {
    await renderChrome({ project: stepsProject(), settings: { minimap: true } });
    await initOrderOn();
    const legend = page.getByRole("region", { name: "Init order" });
    await expect.element(legend).toBeVisible();
    await expect.poll(() => document.querySelector(".react-flow__minimap") !== null).toBe(true);
    await expect.poll(() => {
      const minimap = document.querySelector(".react-flow__minimap")?.getBoundingClientRect();
      const box = legend.element().getBoundingClientRect();
      return minimap !== undefined && box.top >= minimap.bottom;
    }).toBe(true);
  });

  test("the chip leaves the mode, and the cards come back", async () => {
    await renderChrome({ project: stepsProject() });
    await initOrderOn();
    await page.getByRole("button", { name: "Init order · Esc" }).click();
    await expect.poll(() => session.get().modes.initOrder).toBe(false);
    await expect.poll(() => badge("ERC20")).toBeNull();
    await expect.poll(() => getComputedStyle(card("Receive")).opacity).toBe("1");
  });

  test("dragging a badge onto another step's card reorders the steps as one undo step", async () => {
    await renderChrome({ project: stepsProject() });
    await initOrderOn();
    await expect.poll(() => badge("ERC20")).not.toBeNull();
    expect(history.canUndo).toBe(false);
    await userEvent.dragAndDrop(page.elementLocator(badge("ERC20") as HTMLElement), page.elementLocator(card("VaultCore")));
    await expect.poll(stepSpecs).toEqual(["AccessControlInit", "ERC4626Init", "VaultCoreInit", "ERC20Init"]);
    await expect.poll(() => badge("ERC20")?.textContent).toContain("04");
    expect(session.get().modes.initOrder).toBe(true);
    history.undo();
    await expect.poll(stepSpecs).toEqual(["ERC20Init", "AccessControlInit", "ERC4626Init", "VaultCoreInit"]);
    expect(history.canUndo).toBe(false);
  });

  test("a bundle shows its fixed order with no controls", async () => {
    const vault = templateProject("GovernedVault", {}, fixtureCatalog());
    const { layout } = cardProject(fixtureCatalog(), vault.recipe.facets, { columns: 5, rowPitch: 420 });
    await renderChrome({ project: { ...vault, layout } });
    await initOrderOn();
    await expect.poll(() => badge("AccessControl")?.textContent).toContain("01");
    expect(badge("AccessControl")?.hasAttribute("data-init-index")).toBe(false);
    expect(badge("AccessControl")?.classList.contains("nodrag")).toBe(false);
    await expect.poll(() => getComputedStyle(card("Receive")).opacity).toBe("0.35");
    const legend = page.getByRole("region", { name: "Init order" });
    await expect.element(legend.getByText("GovernedVaultInit is a bundle: its order is fixed")).toBeVisible();
    await expect.element(legend.getByText("Drag a badge to reorder")).not.toBeInTheDocument();
    const before = doc.get().recipe;
    await userEvent.dragAndDrop(page.elementLocator(badge("AccessControl") as HTMLElement), page.elementLocator(card("Governor")));
    expect(doc.get().recipe).toBe(before);
  });

  test("the command says why it can't open: an empty sheet, or no init steps", async () => {
    await renderChrome({ project: emptyProject("empty") });
    expect(commandState({ id: "initOrder.toggle" })).toMatchObject({ ok: false, reason: "Place facets first" });
    doc.load(cardProject(fixtureCatalog(), ["Receive"]));
    expect(commandState({ id: "initOrder.toggle" })).toMatchObject({ ok: false, reason: "The init plan has no steps" });
    const toggle = getCommand("initOrder.toggle");
    expect(toggle.keys).toEqual(["i"]);
    expect(toggle.console?.verb).toBe("init");
    expect(toggle.console?.parse([])).toEqual({ ok: true, value: {} });
  });
});

describe("the tool strip and zoom readout (IR L110-L111)", () => {
  test("one toolbar with the spec's tools; the tool in use, init order mode and the minimap show pressed", async () => {
    await renderChrome({ project: stepsProject() });
    const strip = page.getByRole("toolbar", { name: "Sheet tools" });
    await expect.element(strip).toBeVisible();
    const names = strip.getByRole("button").elements().map((b) => b.getAttribute("aria-label"));
    expect(names).toEqual(["Select", "Hand", "Zoom out", "Zoom in", "Fit", "Init order", "Tidy", "Auto-layout", "Minimap"]);
    await expect.element(strip.getByRole("button", { name: "Select" })).toHaveAttribute("aria-pressed", "true");
    await strip.getByRole("button", { name: "Hand" }).click();
    expect(session.get().tool).toBe("hand");
    await expect.element(strip.getByRole("button", { name: "Hand" })).toHaveAttribute("aria-pressed", "true");
    await strip.getByRole("button", { name: "Init order" }).click();
    await expect.element(strip.getByRole("button", { name: "Init order" })).toHaveAttribute("aria-pressed", "true");
    await strip.getByRole("button", { name: "Minimap" }).click();
    expect(settings.get().minimap).toBe(true);
    await expect.element(strip.getByRole("button", { name: "Minimap" })).toHaveAttribute("aria-pressed", "true");
  });

  test("Auto-layout is disabled with its reason; the arrows move through the strip, one Tab stop", async () => {
    await renderChrome({ project: stepsProject() });
    const strip = page.getByRole("toolbar", { name: "Sheet tools" });
    const auto = strip.getByRole("button", { name: "Auto-layout" });
    await expect.element(auto).toHaveAttribute("aria-disabled", "true");
    await expect.element(auto).toHaveAccessibleDescription("Arrives in v1.1");
    (strip.getByRole("button", { name: "Select" }).element() as HTMLElement).focus();
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(strip.getByRole("button", { name: "Hand" })).toHaveFocus();
    await userEvent.keyboard("{End}");
    await expect.element(strip.getByRole("button", { name: "Minimap" })).toHaveFocus();
    const tabbable = strip.getByRole("button").elements().filter((b) => (b as HTMLElement).tabIndex === 0);
    expect(tabbable).toHaveLength(1);
  });

  test("Zoom in runs the command and the readout follows; the readout's menu zooms to 50%", async () => {
    await renderChrome({ project: stepsProject() });
    await runCommand({ id: "sheet.zoomTo", args: { zoom: 1 } }, "api");
    const readout = page.getByRole("button", { name: "Zoom 100%" });
    await expect.element(readout).toBeVisible();
    await page.getByRole("toolbar", { name: "Sheet tools" }).getByRole("button", { name: "Zoom in" }).click();
    await expect.poll(() => sheetViewport().zoom).toBeGreaterThan(1);
    await expect.element(page.getByRole("button", { name: /^Zoom \d+%$/ })).not.toHaveAccessibleName("Zoom 100%");
    await page.getByRole("button", { name: /^Zoom \d+%$/ }).click();
    const menu = page.getByRole("menu", { name: "Zoom" });
    await expect.element(menu).toBeVisible();
    expect(menu.getByRole("menuitem").elements()).toHaveLength(5);
    await menu.getByRole("menuitem", { name: /^50%/ }).click();
    await expect.poll(() => sheetViewport().zoom).toBeCloseTo(0.5);
    await expect.element(page.getByRole("button", { name: "Zoom 50%" })).toBeVisible();
  });
});

describe("the sheet's Tab order (spec L752)", () => {
  test("the card grid, the tool strip, then the title block; on an empty sheet the Start block first", async () => {
    await renderChrome({ project: stepsProject() });
    await expect.element(page.getByRole("region", { name: "Title block" })).toBeVisible();
    const strip = document.querySelector('[data-chrome="tool-strip"]');
    const readout = document.querySelector('[data-chrome="zoom-readout"]');
    const titleBlock = document.querySelector('[data-chrome="title-block"]');
    const cardGrid = document.querySelector(".react-flow__nodes");
    const follows = (a: Element | null, b: Element | null) =>
      Boolean(a && b && a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(cardGrid, strip)).toBe(true);
    expect(follows(strip, readout)).toBe(true);
    expect(follows(readout, titleBlock)).toBe(true);

    await focusCard("ERC20");
    await userEvent.keyboard("{Tab}");
    expect(strip?.contains(document.activeElement)).toBe(true);
    await userEvent.keyboard("{Tab}");
    expect(readout?.contains(document.activeElement)).toBe(true);
  });

  test("on an empty sheet the Start block comes before the tool strip", async () => {
    await renderChrome({ project: emptyProject("empty") });
    await expect.element(page.getByRole("region", { name: "Start a diamond" })).toBeVisible();
    const start = document.querySelector('[data-chrome="start"]');
    const strip = document.querySelector('[data-chrome="tool-strip"]');
    expect(Boolean(start && strip && start.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });
});
