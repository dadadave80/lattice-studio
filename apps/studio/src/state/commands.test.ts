import { afterEach, describe, expect, test } from "bun:test";
import type { Catalog, CommandId, CommandRef, ConsoleLine, Hex4, Project } from "@lattice-studio/core";
import { analyze, blankDiamond, cardSize, contestedSelectors, loadTemplate, tidy } from "@lattice-studio/core";
import { makeCatalog, makeFacet, makeProject, makeRecipe, sel } from "@lattice-studio/core/testing";
import {
  command, commandState, defineCommands, doc, getAnalysis, getCommand, layoutMetrics, runCommand, session, setCatalogStatus,
  type CommandArgs, type CommandSource,
} from "@/contracts";
import { bufferedServices } from "@/contracts/services";
import { S1_COMMANDS } from "./cmd";
import { resolveField } from "./cmd/init";
import { fixture, settle, setupKit, type Kit } from "./testing";

let kit: Kit;
afterEach(() => kit.dispose());

function start(project?: Project, catalog?: Catalog): Kit {
  kit = setupKit(project ? { project, ...(catalog ? { catalog } : {}) } : catalog ? { catalog } : {});
  return kit;
}

async function run(id: CommandId, args?: Record<string, unknown>, source: CommandSource = "api"): Promise<string[]> {
  kit.clearLines();
  const ref = (args ? { id, args } : { id }) as CommandRef;
  await runCommand(ref, source);
  await settle();
  return kit.texts();
}

function reason(id: CommandId, args?: Record<string, unknown>): string | null {
  const state = commandState((args ? { id, args } : { id }) as CommandRef);
  return state.ok ? null : state.reason;
}

/** A project holding `facets`, each at its own spot. */
function withFacets(facets: string[], extra: Partial<Project> = {}): Project {
  const catalog = fixture();
  const layout: Project["layout"] = {};
  facets.forEach((name, i) => {
    layout[name] = { x: 96 + (i % 4) * 400, y: 96 + Math.floor(i / 4) * 800, pins: "right" };
  });
  return makeProject({ recipe: makeRecipe({ facets }, catalog), layout, ...extra });
}

/**
 * Stands in for S4b's `sheet.zoomFit` or `sheet.locate` (a placeholder under `bun test`) and records each run's
 * arguments. The kit's `dispose()` puts the placeholder back.
 */
function fakeSheetCommand(id: "sheet.zoomFit" | "sheet.locate"): CommandArgs[] {
  const runs: CommandArgs[] = [];
  defineCommands([command<CommandArgs>({
    id, title: () => id, category: "Sheet", enabled: () => ({ ok: true }), run: (_ctx, args) => void runs.push(args),
  })]);
  return runs;
}

/** The layout `tidy` gives the open project's recipe from scratch. */
function tidiedFromScratch(): Project["layout"] {
  const project = { ...doc.get(), layout: {} };
  return tidy(project, kit.catalog, analyze(project.recipe, kit.catalog), layoutMetrics);
}

const READ_ONLY = "Another tab is editing this project. Take over editing to change it.";

const VALID_ARGS: Record<string, Record<string, unknown> | undefined> = {
  "facet.place": { facet: "ERC20" },
  "facet.remove": { facets: ["ERC20"] },
  "facet.routeContested": { facet: "ERC20" },
  "selector.route": { selector: "0xa9059cbb", facet: "ERC20" },
  "selector.clearOwner": { selector: "0xa9059cbb" },
  "selector.exclude": { selector: "0xa9059cbb" },
  "selector.include": { selector: "0xa9059cbb" },
  "recipe.load": { name: "ERC20" },
  "recipe.replace": { name: "ERC20" },
  "recipe.keepImmutable": undefined,
  "init.setArg": { path: "steps[0].name_", value: "Vault" },
  "init.addStep": { spec: "ERC20Init" },
  "init.removeStep": { path: "steps[0]" },
  "init.moveStep": { path: "steps[1]", to: 0 },
  "init.reorderAuto": undefined,
  "layout.flipPins": { facets: ["ERC20"] },
  "layout.toggleExpand": { facet: "ERC20" },
  "layout.tidy": undefined,
  "layout.tidySelection": undefined,
  "ack.set": { problemId: "INIT-05:diamond" },
  "history.undo": undefined,
  "history.redo": undefined,
  "project.rename": { name: "Treasury" },
};

describe("registration", () => {
  test("S1 registers every command contracts §5.3 gives it, each once", () => {
    start();
    const ids = S1_COMMANDS.map((c) => c.id).sort();
    expect(ids).toEqual(Object.keys(VALID_ARGS).sort() as CommandId[]);
    for (const c of S1_COMMANDS) expect(getCommand(c.id)).toBe(c);
  });
});

describe("read-only", () => {
  test("every S1 command is disabled with the session's read-only reason, and running one says it", async () => {
    start(withFacets(["ERC20", "ERC4626"], {
      recipe: { ...makeRecipe({ facets: ["ERC20", "ERC4626"] }), init: { kind: "steps", steps: [{ spec: "ERC20Init", args: {} }, { spec: "AccessControlInit", args: {} }] } },
    }));
    doc.apply("Renamed", (p) => ({ project: { ...p, name: "X" }, changed: true, summary: "Renamed" }));
    doc.undo();
    session.set({ readOnly: READ_ONLY, selection: ["ERC20", "ERC4626"] });
    for (const c of S1_COMMANDS) expect([c.id, reason(c.id, VALID_ARGS[c.id])]).toEqual([c.id, READ_ONLY]);
    const before = JSON.stringify(doc.get());
    expect(await run("facet.place", { facet: "Receive" })).toEqual([READ_ONLY]);
    expect(bufferedServices().announce.at(-1)?.[0]).toBe(READ_ONLY);
    expect(JSON.stringify(doc.get())).toBe(before);
  });

  test("without a catalog, document commands wait for it", () => {
    start(undefined, undefined);
    setCatalogStatus({ status: "loading" });
    expect(reason("facet.place", { facet: "ERC20" })).toBe("The catalog hasn't loaded yet · Wait for it to finish");
    expect(reason("layout.tidy")).toBe("The catalog hasn't loaded yet · Wait for it to finish");
  });
});

describe("facet.place", () => {
  test("places, selects and says what it placed, then the new problems", async () => {
    start();
    const lines = await run("facet.place", { facet: "ERC20" });
    expect(lines[0]).toBe("Placed ERC20 · 9 selectors · erc7201:lattice.storage.ERC20");
    expect(lines.length).toBeGreaterThan(1);
    expect(doc.get().recipe.facets).toEqual(["ERC20"]);
    expect(session.get().selection).toEqual(["ERC20"]);
    expect(doc.state().undoLabel).toBe("Placed ERC20");
    expect(bufferedServices().announce.at(-1)?.[0]).toBe(lines[0]);
  });

  test("already placed: selects it and says so", async () => {
    start(withFacets(["ERC20", "ERC4626"]));
    session.set({ selection: ["ERC4626"] });
    expect(await run("facet.place", { facet: "ERC20" })).toEqual(["ERC20 is already on the sheet."]);
    expect(session.get().selection).toEqual(["ERC20"]);
    expect(doc.state().canUndo).toBe(false);
  });

  test("already placed: runs sheet.locate on the existing card (spec L427)", async () => {
    start(withFacets(["ERC20", "ERC4626"]));
    const located = fakeSheetCommand("sheet.locate");
    expect(await run("facet.place", { facet: "ERC20" }, "palette")).toEqual(["ERC20 is already on the sheet."]);
    expect(located).toEqual([{ facet: "ERC20" }]);
    await run("facet.place", { facet: "Receive" }, "palette");
    expect(located).toHaveLength(1);
  });

  test("placed again after removal: a selector that needs a choice is a fresh SEL-01, named in the console (spec L429)", async () => {
    const SEND: Hex4 = "0xcdfe7f5c";
    start(withFacets(["AxelarGatewayAdapter"]));
    const naming = (lines: ConsoleLine[]) =>
      lines.filter((l) => l.tag === "Collision" && l.anchor?.kind === "selector" && l.anchor.selector === SEND);
    await run("facet.place", { facet: "HyperlaneGatewayAdapter" });
    const first = naming(kit.lines());
    expect(first).toHaveLength(1);
    expect(first[0]?.text).toContain("sendMessage · 0xcdfe7f5c");

    // Routed by hand, then removed: the choice goes with it.
    await run("selector.route", { selector: SEND, facet: "HyperlaneGatewayAdapter" });
    expect(doc.get().recipe.owners[SEND]).toBe("HyperlaneGatewayAdapter");
    await run("facet.remove", { facets: ["HyperlaneGatewayAdapter"] });
    expect(doc.get().recipe.owners[SEND]).toBeUndefined();

    const lines = await run("facet.place", { facet: "HyperlaneGatewayAdapter" });
    expect(lines[0]).toMatch(/^Placed HyperlaneGatewayAdapter · /);
    const fresh = naming(kit.lines());
    expect(fresh).toHaveLength(1);
    expect(fresh[0]?.text).toContain("sendMessage · 0xcdfe7f5c");
    expect(fresh[0]?.text.startsWith("Resolved")).toBe(false);
    expect(getAnalysis().problems.some((p) => p.id === `SEL-01:${SEND}`)).toBe(true);
  });

  test("an unknown facet is disabled with the reason", () => {
    start();
    expect(reason("facet.place", { facet: "ERC20X" })).toBe("‘ERC20X’ isn't a facet in Lattice fixture.");
    expect(reason("facet.place", {})).toBe("Name a facet to place");
  });

  test("lands at the drop point, snapped and moved clear of other cards", async () => {
    start(withFacets(["ERC20"]));
    await run("facet.place", { facet: "Receive", at: { x: 101, y: 99 } });
    const receive = doc.get().layout.Receive;
    const erc20 = doc.get().layout.ERC20;
    expect(receive).toBeDefined();
    expect(Math.abs((receive?.x ?? 1) % layoutMetrics.snap)).toBe(0);
    expect(Math.abs((receive?.y ?? 1) % layoutMetrics.snap)).toBe(0);
    expect(receive?.x === erc20?.x && receive?.y === erc20?.y).toBe(false);
  });

  test("keyboard placements go beside the selected card", async () => {
    start(withFacets(["ERC20"]));
    session.set({ selection: ["ERC20"] });
    await run("facet.place", { facet: "Receive" });
    const erc20 = doc.get().layout.ERC20;
    const receive = doc.get().layout.Receive;
    expect(receive?.y).toBe(erc20?.y);
    expect(receive?.x).toBe((erc20?.x ?? 0) + layoutMetrics.cardWidth + 5 * layoutMetrics.grid);
  });

  test("the console verb resolves the facet's case", () => {
    start();
    const parse = getCommand("facet.place").console?.parse;
    expect(parse?.(["erc20"])).toEqual({ ok: true, value: { facet: "ERC20" } });
    expect(parse?.(["nope"])).toEqual({ ok: false, error: "‘nope’ isn't a facet in Lattice fixture." });
  });

  test("placing 30 facets and undoing every one round-trips the document byte for byte", async () => {
    start();
    await settle();
    const before = JSON.stringify(doc.get());
    const names = kit.catalog.facets.slice(0, 30).map((f) => f.name);
    for (const facet of names) await run("facet.place", { facet });
    expect(doc.get().recipe.facets).toHaveLength(30);
    for (let i = 0; i < 30; i++) await run("history.undo");
    expect(JSON.stringify(doc.get())).toBe(before);
    expect(doc.state().canUndo).toBe(false);
    for (let i = 0; i < 30; i++) await run("history.redo");
    expect(doc.get().recipe.facets).toHaveLength(30);
  });

  test("a new card is sized from the recipe after placement, so it can't grow over the card below (spec L425, L479)", async () => {
    // Existing and Growing share 8 selectors: no collision while Growing isn't on the sheet, but a SEL-01 as
    // soon as it joins. Growing has 12 selectors (collapsible), so those 8 contested rows can't collapse away
    // and it's taller once placed than a size computed from the sheet before it.
    const shared = Array.from({ length: 8 }, (_, i) => ({ hex: sel(9000 + i), signature: `shared${i}()` }));
    const existing = makeFacet({ name: "Existing", selectors: [...shared, { hex: sel(9100), signature: "ownE()" }] });
    const growing = makeFacet({ name: "Growing", selectors: [...shared, ...Array.from({ length: 4 }, (_, i) => ({ hex: sel(9200 + i), signature: `ownG${i}()` }))] });
    const blocker = makeFacet({ name: "Blocker", selectors: [{ hex: sel(9300), signature: "blocked()" }] });
    const catalog = makeCatalog({ facets: [existing, growing, blocker] });
    const small = cardSize(growing, { metrics: layoutMetrics, expanded: false, pins: "right", compact: false, contested: [] });
    const layout: Project["layout"] = {
      // Far away: only on the sheet so it contends Growing's shared selectors once Growing joins.
      Existing: { x: 2000, y: 2000, pins: "right" },
      // Flush against the bottom of Growing's pre-placement (undersized) box: touching, not overlapping.
      Blocker: { x: 96, y: 96 + small.height, pins: "right" },
    };
    start(makeProject({ recipe: makeRecipe({ facets: ["Existing", "Blocker"] }, catalog), layout }), catalog);
    await run("facet.place", { facet: "Growing", at: { x: 96, y: 96 } });
    // The premise: placing it really did contest those 8 selectors, so Growing really did grow.
    expect(contestedSelectors(getAnalysis(), "Growing")).toHaveLength(8);
    const at = doc.get().layout.Growing;
    const blockerEntry = doc.get().layout.Blocker;
    if (!at || !blockerEntry) throw new Error("Growing or Blocker missing from the layout");
    const grown = cardSize(growing, { metrics: layoutMetrics, expanded: false, pins: "right", compact: false, contested: contestedSelectors(getAnalysis(), "Growing") });
    const blockerSize = cardSize(blocker, { metrics: layoutMetrics, expanded: false, pins: "right", compact: false, contested: [] });
    const overlapsBlocker =
      at.x < blockerEntry.x + blockerSize.width && at.x + grown.width > blockerEntry.x &&
      at.y < blockerEntry.y + blockerSize.height && at.y + grown.height > blockerEntry.y;
    expect(overlapsBlocker).toBe(false);
  });
});

describe("facet.remove", () => {
  test("removes one, says so, no toast", async () => {
    start(withFacets(["ERC20", "ERC4626"]));
    session.set({ selection: ["ERC20"] });
    const lines = await run("facet.remove", { facets: ["ERC20"] });
    expect(lines[0]).toBe("Removed ERC20.");
    expect(session.get().selection).toEqual([]);
    expect(bufferedServices().toast).toEqual([]);
  });

  test("removing several posts the Removed toast with Undo", async () => {
    start(withFacets(["ERC20", "ERC4626", "Receive"]));
    const lines = await run("facet.remove", { facets: ["ERC20", "ERC4626"] });
    expect(lines[0]).toBe("Removed ERC20 and ERC4626.");
    expect(bufferedServices().toast).toEqual([{ text: "Removed 2 facets", action: { id: "history.undo" } }]);
    expect(doc.state().undoLabel).toBe("Removed ERC20 and ERC4626");
  });

  test("a facet that isn't on the sheet is disabled with the reason; the console resolves case", async () => {
    start(withFacets(["ERC4626"]));
    expect(reason("facet.remove", { facets: ["ERC20"] })).toBe("ERC20 isn't on the sheet.");
    expect(reason("facet.remove", { facets: [] })).toBe("Select a facet to remove");
    expect(await run("facet.remove", { facets: ["ERC20"] })).toEqual(["ERC20 isn't on the sheet."]);
    expect(getCommand("facet.remove").console?.parse(["erc4626"])).toEqual({ ok: true, value: { facets: ["ERC4626"] } });
  });
});

describe("routing", () => {
  const SEND: Hex4 = "0xcdfe7f5c";
  const ATTR: Hex4 = "0xdc680a0f";

  test("selector.route settles a collision; Keep {A} and Route to {B} are its titles", async () => {
    start(withFacets(["AxelarGatewayAdapter", "HyperlaneGatewayAdapter"]));
    expect(commandState({ id: "selector.route", args: { selector: SEND, facet: "AxelarGatewayAdapter", verb: "keep" } }).title).toBe("Keep AxelarGatewayAdapter");
    expect(commandState({ id: "selector.route", args: { selector: SEND, facet: "HyperlaneGatewayAdapter" } }).title).toBe("Route to HyperlaneGatewayAdapter");
    const lines = await run("selector.route", { selector: SEND, facet: "HyperlaneGatewayAdapter" });
    expect(lines).toContain("Resolved: `sendMessage · 0xcdfe7f5c` routes to HyperlaneGatewayAdapter.");
    expect(lines.some((l) => l.startsWith("Routed"))).toBe(false);
    expect(doc.get().recipe.owners[SEND]).toBe("HyperlaneGatewayAdapter");
    expect(await run("selector.route", { selector: SEND, facet: "HyperlaneGatewayAdapter" })).toEqual([
      "`sendMessage · 0xcdfe7f5c` already routes to HyperlaneGatewayAdapter.",
    ]);
  });

  test("the console tells route <facet> <selector> from route <facet>", () => {
    start(withFacets(["AxelarGatewayAdapter", "HyperlaneGatewayAdapter"]));
    const one = getCommand("selector.route").console;
    const all = getCommand("facet.routeContested").console;
    expect(one?.parse(["hyperlanegatewayadapter", "sendMessage"])).toEqual({ ok: true, value: { selector: SEND, facet: "HyperlaneGatewayAdapter" } });
    expect(one?.parse(["hyperlanegatewayadapter"]).ok).toBe(false);
    expect(all?.parse(["hyperlanegatewayadapter"])).toEqual({ ok: true, value: { facet: "HyperlaneGatewayAdapter" } });
    expect(all?.parse(["hyperlanegatewayadapter", "sendMessage"]).ok).toBe(false);
    expect(one?.parse(["hyperlanegatewayadapter", "0x12345678"])).toEqual({ ok: false, error: "HyperlaneGatewayAdapter has no selector 0x12345678." });
  });

  test("facet.routeContested routes every contested selector in one step", async () => {
    start(withFacets(["AxelarGatewayAdapter", "HyperlaneGatewayAdapter"]));
    const lines = await run("facet.routeContested", { facet: "HyperlaneGatewayAdapter" });
    expect(lines).toContain("Resolved: `sendMessage · 0xcdfe7f5c` and `supportsAttribute · 0xdc680a0f` route to HyperlaneGatewayAdapter.");
    expect(doc.get().recipe.owners).toEqual({ [SEND]: "HyperlaneGatewayAdapter", [ATTR]: "HyperlaneGatewayAdapter" });
    expect(kit.state.document.history.getState().pastStates).toHaveLength(1);
    expect(await run("facet.routeContested", { facet: "HyperlaneGatewayAdapter" })).toEqual(["HyperlaneGatewayAdapter has no contested selectors to take."]);
    expect(reason("facet.routeContested", { facet: "ERC20" })).toBe("ERC20 isn't on the sheet.");
  });

  test("selector.clearOwner clears an owner, or says there's none", async () => {
    start(withFacets(["AxelarGatewayAdapter", "HyperlaneGatewayAdapter"]));
    await run("selector.route", { selector: SEND, facet: "HyperlaneGatewayAdapter" });
    const lines = await run("selector.clearOwner", { selector: SEND });
    expect(lines[0]).toBe("Cleared the owner of `sendMessage · 0xcdfe7f5c`.");
    expect(doc.get().recipe.owners[SEND]).toBeUndefined();
    expect(await run("selector.clearOwner", { selector: SEND })).toEqual(["`sendMessage · 0xcdfe7f5c` has no owner to clear."]);
    expect(commandState({ id: "selector.clearOwner", args: { selector: SEND } }).title).toBe("Clear owner");
  });

  test("selector.exclude and selector.include leave a selector out and bring it back", async () => {
    start(withFacets(["ERC20"]));
    const T: Hex4 = "0xa9059cbb";
    expect(getCommand("selector.exclude").console?.parse(["transfer"])).toEqual({ ok: true, value: { selector: T } });
    const out = await run("selector.exclude", { selector: T });
    expect(out[0]).toBe("Left `transfer · 0xa9059cbb` out of the diamond.");
    expect(doc.get().recipe.exclude).toEqual([T]);
    expect(await run("selector.exclude", { selector: T })).toEqual(["`transfer · 0xa9059cbb` is already out."]);
    const back = await run("selector.include", { selector: T });
    expect(back[0]).toBe("Brought `transfer · 0xa9059cbb` back into the diamond.");
    expect(await run("selector.include", { selector: T })).toEqual(["`transfer · 0xa9059cbb` is already in the diamond."]);
    expect(reason("selector.exclude", {})).toBe("Name a selector");
  });

  test("leaving a selector out and bringing it back are one labelled undo step each (spec L491)", async () => {
    start(withFacets(["ERC20"]));
    const T: Hex4 = "0xa9059cbb";
    const past = () => kit.state.document.history.getState().pastStates.length;
    const before = past();
    await run("selector.exclude", { selector: T });
    expect(past()).toBe(before + 1);
    expect(doc.state().undoLabel).toBe("Left `transfer · 0xa9059cbb` out of the diamond");
    await run("selector.include", { selector: T });
    expect(past()).toBe(before + 2);
    expect(doc.state().undoLabel).toBe("Brought `transfer · 0xa9059cbb` back into the diamond");
    expect((await run("history.undo"))[0]).toBe("Undid: Brought `transfer · 0xa9059cbb` back into the diamond.");
    expect(doc.get().recipe.exclude).toEqual([T]);
    expect((await run("history.undo"))[0]).toBe("Undid: Left `transfer · 0xa9059cbb` out of the diamond.");
    expect(doc.get().recipe.exclude).toEqual([]);
    expect(past()).toBe(before);
  });
});

describe("recipes", () => {
  test("on an empty sheet a recipe loads in place, tidied, as one undo step", async () => {
    start();
    const id = doc.get().id;
    const lines = await run("recipe.load", { name: "GovernedVault" });
    expect(lines).toEqual(["Loaded GovernedVault · 14 facets · 120 selectors · from script/base/defi/DeployGovernedVault.s.sol."]);
    expect(doc.get().id).toBe(id);
    expect(doc.get().recipe.facets).toHaveLength(14);
    expect(Object.keys(doc.get().layout)).toHaveLength(14);
    expect(doc.state().undoLabel).toBe("Loaded GovernedVault");
    await run("history.undo");
    expect(doc.get().recipe.facets).toEqual([]);
  });

  test("a recipe load brings a tidied layout, and the view fits (spec L409)", async () => {
    start();
    const fits = fakeSheetCommand("sheet.zoomFit");
    await run("recipe.load", { name: "GovernedVault" });
    expect(Object.keys(doc.get().layout)).toHaveLength(14);
    expect(doc.get().layout).toEqual(tidiedFromScratch());
    expect(fits).toHaveLength(1);

    // As a new project too, from a sheet with facets.
    await run("recipe.load", { name: "ERC20" });
    expect(doc.get().name).toBe("ERC20");
    expect(doc.get().layout).toEqual(tidiedFromScratch());
    expect(fits).toHaveLength(2);

    // Replace this sheet with… does the same.
    await run("recipe.replace", { name: "SafeDiamondCut" });
    expect(doc.get().layout).toEqual(tidiedFromScratch());
    expect(fits).toHaveLength(3);
  });

  test("on a sheet with facets it opens as a new project", async () => {
    start(withFacets(["ERC20"]));
    const id = doc.get().id;
    const lines = await run("recipe.load", { name: "erc20" });
    expect(lines).toEqual([expect.stringMatching(/^Loaded ERC20 · \d+ facets · \d+ selectors · from script\/base\/tokens\/DeployERC20\.s\.sol\.$/)]);
    expect(doc.get().id).not.toBe(id);
    expect(doc.get().name).toBe("ERC20");
    expect(doc.state()).toMatchObject({ canUndo: false, lastChange: { kind: "load" } });
  });

  test("Replace this sheet with… stays in the project as one undo step", async () => {
    start(withFacets(["ERC20"]));
    const id = doc.get().id;
    await run("recipe.replace", { name: "SafeDiamondCut" });
    expect(doc.get().id).toBe(id);
    expect(doc.get().recipe.template?.name).toBe("SafeDiamondCut");
    await run("history.undo");
    expect(doc.get().recipe.facets).toEqual(["ERC20"]);
  });

  test("the Blank diamond loads by name; recipes that don't load in v1 say why", async () => {
    start();
    expect(await run("recipe.load", { name: "Blank diamond" })).toEqual([expect.stringMatching(/^Loaded Blank diamond · 5 facets · \d+ selectors\.$/)]);
    expect(doc.get().recipe).toEqual(blankDiamond(kit.catalog));
    expect(reason("recipe.load", { name: "Account" })).toBe("Account arrives in v1.1 and needs its own factory (AccountFactory).");
    expect(reason("recipe.load", { name: "Nope" })).toBe("‘Nope’ isn't a recipe in Lattice fixture.");
    expect(getCommand("recipe.load").console?.parse(["blank", "diamond"])).toEqual({ ok: true, value: { name: "blank diamond" } });
  });

  test("Keep immutable marks the recipe, or says it already is", async () => {
    start(withFacets(["DiamondLoupeFacet"]));
    const lines = await run("recipe.keepImmutable");
    expect(doc.get().recipe.immutable).toBe(true);
    expect(lines).toEqual(["Kept the diamond immutable.", "Resolved: Nothing can change this diamond after deploy."]);
    expect(await run("recipe.keepImmutable")).toEqual(["The diamond is already kept immutable."]);
  });
});

describe("init", () => {
  function vault(): Project {
    const loaded = loadTemplate(kit.catalog, "GovernedVault");
    if (!loaded.ok) throw new Error(loaded.error);
    return makeProject({ recipe: loaded.value, layout: {} });
  }

  test("set <field> <value> finds the field by a word of its label and says it with the label", async () => {
    start();
    doc.load(vault());
    const parse = getCommand("init.setArg").console?.parse;
    expect(parse?.(["quorum", "5"])).toEqual({ ok: true, value: { path: "bundle.p.quorumNumerator", value: "5" } });
    expect(parse?.(["quorum", "140"]).ok).toBe(false);
    expect(parse?.(["nothing", "1"])).toEqual({ ok: false, error: "The init plan has no field nothing." });
    const lines = await run("init.setArg", { path: "bundle.p.quorumNumerator", value: "5" });
    expect(lines[0]).toBe("Set Governor quorum to 5%.");
    expect(await run("init.setArg", { path: "bundle.p.quorumNumerator", value: "5" })).toEqual(["GovernedVaultInit.p.quorumNumerator is already 5%."]);
    expect(commandState({ id: "init.setArg", args: { path: "bundle.p.votingPeriod", value: "1" } }).title).toBe("Set Voting period");
  });

  test("set picks a step by its prefix; a name two steps share asks for the prefix (IR L154)", () => {
    start();
    const catalog = kit.catalog;
    const recipe = {
      ...makeRecipe({ facets: ["ERC20", "ERC20Permit"] }, catalog),
      init: { kind: "steps" as const, steps: [{ spec: "ERC20Init", args: {} }, { spec: "ERC20PermitInit", args: {} }] },
    };
    expect(resolveField(recipe, catalog, "erc20init.name")).toMatchObject({ ok: true, value: { path: "steps[0].name_" } });
    expect(resolveField(recipe, catalog, "ERC20PermitInit.name")).toMatchObject({ ok: true, value: { path: "steps[1].name_" } });
    const bare = resolveField(recipe, catalog, "name");
    if (bare.ok) throw new Error("a name two steps share should not resolve");
    expect(bare.error).toStartWith("name matches 2 fields: ");
    expect(bare.error).toContain("Prefix the step: set erc20init.");
    // The console verb says the same.
    doc.load(makeProject({ recipe }));
    const parse = getCommand("init.setArg").console?.parse;
    expect(parse?.(["erc20init.name", "Vault"])).toEqual({ ok: true, value: { path: "steps[0].name_", value: "Vault" } });
    expect(parse?.(["name", "Vault"])).toEqual(bare);
  });

  test("durations read in words, and references by name", async () => {
    start();
    doc.load(vault());
    expect((await run("init.setArg", { path: "bundle.p.votingPeriod", value: "300" }))[0]).toBe("Set Voting period to 5 minutes (300 s).");
    expect((await run("init.setArg", { path: "bundle.p.asset", value: { $ref: "self" } }))[0]).toBe("Set Asset to this diamond.");
  });

  test("add, move and remove steps", async () => {
    start(makeProject({ recipe: blankDiamond(fixture()) }));
    const added = await run("init.addStep", { spec: "ERC20Init" });
    // The step, then what it still needs (INIT-01).
    expect(added[0]).toBe("Added ERC20Init to the init plan.");
    expect(added.slice(1)).toEqual(["Name is required. Fill it in before deploying.", "Symbol is required. Fill it in before deploying."]);
    expect(doc.get().recipe.init).toMatchObject({ kind: "steps", steps: [{ spec: "AccessControlInit" }, { spec: "ERC20Init" }] });
    expect(commandState({ id: "init.addStep", args: { spec: "ERC20Init" } }).title).toBe("Add init step");
    expect(await run("init.addStep", { spec: "ERC20Init" })).toEqual(["ERC20Init is already in the init plan."]);
    expect((await run("init.moveStep", { path: "steps[1]", to: 0 }))[0]).toBe("Moved ERC20Init to step 1.");
    expect((await run("init.moveStep", { path: "steps[0]", to: 1 }))[0]).toBe("Moved ERC20Init to step 2, after AccessControlInit.");
    expect(await run("init.moveStep", { path: "steps[1]", to: 1 })).toEqual(["ERC20Init is already step 2."]);
    expect(commandState({ id: "init.removeStep", args: { path: "steps[1]" } }).title).toBe("Remove ERC20Init");
    const removed = await run("init.removeStep", { path: "steps[1]" });
    expect(removed).toEqual(["Removed ERC20Init from the init plan.", "Resolved: Name is required. Fill it in before deploying.", "Resolved: Symbol is required. Fill it in before deploying."]);
    expect(await run("init.removeStep", { path: "steps[4]" })).toEqual(["There's no step 5 in the init plan."]);
  });

  test("Reorder steps automatically satisfies every after constraint in one step", async () => {
    const base = fixture();
    const catalog: Catalog = { ...base, inits: base.inits.map((i) => (i.name === "ERC20Init" ? { ...i, after: ["AccessControl"] } : i)) };
    start(makeProject({
      recipe: { ...makeRecipe({}, catalog), init: { kind: "steps", steps: [{ spec: "ERC20Init", args: {} }, { spec: "AccessControlInit", args: {} }] } },
    }), catalog);
    const lines = await run("init.reorderAuto");
    expect(doc.get().recipe.init).toMatchObject({ steps: [{ spec: "AccessControlInit" }, { spec: "ERC20Init" }] });
    expect(lines.length).toBeGreaterThan(0);
    expect(doc.state().undoLabel).toBe("Reordered the init steps");
    expect(await run("init.reorderAuto")).toEqual(["The init steps are already in order."]);
    doc.load(makeProject({ recipe: { ...makeRecipe({}, catalog), init: { kind: "bundle", spec: "GovernedVaultInit", args: {} } } }));
    expect(reason("init.reorderAuto")).toBe("GovernedVaultInit is a bundle: its order is fixed");
  });
});


describe("layout", () => {
  test("Flip pins flips the selection's pins and says so", async () => {
    start(withFacets(["ERC20"]));
    expect(reason("layout.flipPins")).toBe("Select a card to flip its pins");
    session.set({ selection: ["ERC20"] });
    expect(await run("layout.flipPins", undefined, "keys")).toEqual(["Flipped pins on ERC20."]);
    expect(doc.get().layout.ERC20?.pins).toBe("left");
  });

  test("expanding a card pushes the cards below it down, in the same undo step", async () => {
    start(withFacets(["ERC4626"]));
    const catalog = kit.catalog;
    const erc4626 = catalog.facets.find((f) => f.name === "ERC4626");
    if (!erc4626) throw new Error("no ERC4626");
    const collapsed = cardSize(erc4626, { metrics: layoutMetrics, expanded: false, pins: "right", compact: false, contested: contestedSelectors(getAnalysis(), "ERC4626") });
    const expanded = cardSize(erc4626, { metrics: layoutMetrics, expanded: true, pins: "right", compact: false, contested: [] });
    // ERC20 sits just below ERC4626 in the same column; Receive sits in another column.
    doc.load({
      ...doc.get(),
      recipe: makeRecipe({ facets: ["ERC4626", "ERC20", "Receive"] }, catalog),
      layout: {
        ERC4626: { x: 96, y: 96, pins: "right" },
        ERC20: { x: 96, y: 96 + collapsed.height + 8, pins: "right" },
        Receive: { x: 800, y: 400, pins: "right" },
      },
    });
    expect(commandState({ id: "layout.toggleExpand", args: { facet: "ERC4626" } }).title).toBe("Expand ERC4626");
    const lines = await run("layout.toggleExpand", { facet: "ERC4626" });
    expect(lines).toEqual(["Expanded ERC4626."]);
    const layout = doc.get().layout;
    const dy = Math.ceil((expanded.height - collapsed.height) / layoutMetrics.snap) * layoutMetrics.snap;
    expect(layout.ERC4626?.expanded).toBe(true);
    expect(layout.ERC20?.y).toBe(96 + collapsed.height + 8 + dy);
    expect(layout.Receive).toEqual({ x: 800, y: 400, pins: "right" });
    expect(kit.state.document.history.getState().pastStates).toHaveLength(1);
    await run("history.undo");
    expect(doc.get().layout.ERC4626?.expanded).toBeUndefined();
    expect(doc.get().layout.ERC20?.y).toBe(96 + collapsed.height + 8);
    expect(await run("layout.toggleExpand", { facet: "ERC20X" })).toEqual(["ERC20X isn't on the sheet."]);
  });

  test("Tidy arranges every card in one step; T with two selected tidies the selection", async () => {
    start(withFacets(["ERC20", "ERC4626", "VaultCore"]));
    expect(await run("layout.tidy")).toEqual(["Tidied 3 facets."]);
    expect(doc.state().undoLabel).toBe("Tidied 3 facets");
    expect(await run("layout.tidy")).toEqual(["Nothing moved: the sheet already has this layout."]);
    session.set({ selection: ["ERC20"] });
    expect(reason("layout.tidySelection")).toBe("Select two or more cards");
    doc.apply("Moved", (p) => ({ project: { ...p, layout: { ...p.layout, ERC20: { x: 2000, y: 2000, pins: "right" } } }, changed: true, summary: "Moved" }));
    session.set({ selection: ["ERC20", "ERC4626"] });
    expect(await run("layout.tidy", undefined, "keys")).toEqual(["Tidied 2 facets."]);
    expect(await run("layout.tidySelection")).toEqual(["Nothing moved: the sheet already has this layout."]);
  });

  test("Tidy fits the view only when something moved (spec L476)", async () => {
    start(withFacets(["ERC20", "ERC4626", "VaultCore"]));
    const fits = fakeSheetCommand("sheet.zoomFit");
    expect(await run("layout.tidy", undefined, "keys")).toEqual(["Tidied 3 facets."]);
    expect(fits).toHaveLength(1);
    expect(await run("layout.tidy", undefined, "keys")).toEqual(["Nothing moved: the sheet already has this layout."]);
    expect(fits).toHaveLength(1);
  });

  test("Tidy's undo label and console line count the same facets, including one an imported recipe left out of its layout", async () => {
    // ERC4626 is in the recipe but has no layout entry: an imported recipe missing one (S1 review, WP-FX6).
    const project = withFacets(["ERC20"], { recipe: makeRecipe({ facets: ["ERC20", "ERC4626"] }, fixture()) });
    start(project);
    const lines = await run("layout.tidy");
    expect(lines).toEqual(["Tidied 2 facets."]);
    expect(doc.state().undoLabel).toBe("Tidied 2 facets");
    expect(Object.keys(doc.get().layout)).toHaveLength(2);
  });

  test("an empty sheet has nothing to tidy", () => {
    start();
    expect(reason("layout.tidy")).toBe("Place facets first");
  });
});

describe("disabled reasons and no-op lines", () => {
  test("arguments a surface forgot, or that name nothing on the sheet, disable the command with a reason", () => {
    start(withFacets(["ERC20"]));
    const cases: [CommandId, Record<string, unknown> | undefined, string][] = [
      ["selector.route", { selector: "0xa9059cbb", facet: "ERC4626" }, "ERC4626 isn't on the sheet."],
      ["selector.route", { facet: "ERC20" }, "Name a selector"],
      ["selector.clearOwner", {}, "Name a selector"],
      ["selector.include", { selector: "0xa9059cbb", facet: "Nope" }, "‘Nope’ isn't a facet in Lattice fixture."],
      ["recipe.replace", { name: "Account6900" }, "Account6900 arrives in v1.1 and needs its own factory (AccountFactory6900)."],
      ["recipe.load", {}, "Name a recipe"],
      ["init.setArg", { value: "1" }, "Name an init field"],
      ["init.setArg", { path: "bundle.p.asset" }, "Give the field a value"],
      ["init.addStep", {}, "Name the init to add"],
      ["init.removeStep", {}, "Name the step to remove"],
      ["init.moveStep", { path: "bundle", to: 0 }, "Name the step to move"],
      ["init.moveStep", { path: "steps[0]" }, "Say where to move it"],
      ["layout.toggleExpand", { facet: "ERC4626" }, "ERC4626 isn't on the sheet."],
      ["ack.set", {}, "Name the problem to acknowledge"],
      ["project.rename", {}, "Give the project a name"],
      ["facet.routeContested", {}, "Name a facet to route to"],
    ];
    for (const [id, args, expected] of cases) expect([id, reason(id, args)]).toEqual([id, expected]);
  });

  test("runs that change nothing say why", async () => {
    start(withFacets(["ERC20"]));
    expect(await run("layout.flipPins", { facets: ["ERC4626"] })).toEqual(["ERC4626 isn't on the sheet."]);
    expect(await run("project.rename", { name: " " })).toEqual(["A project needs a name."]);
    expect(await run("init.addStep", { spec: "NopeInit" })).toEqual(["The catalog has no init named NopeInit."]);
    expect(await run("init.setArg", { path: "steps[3].x", value: "1" })).toEqual(["There's no step 4 in the init plan."]);
    await run("recipe.replace", { name: "ERC20" });
    expect(await run("recipe.replace", { name: "ERC20" })).toEqual(["The sheet already holds ERC20."]);
  });

  test("collapsing a card pulls nothing up", async () => {
    start(withFacets(["ERC4626", "ERC20"]));
    await run("layout.toggleExpand", { facet: "ERC4626" });
    const pushed = doc.get().layout.ERC20;
    expect(commandState({ id: "layout.toggleExpand", args: { facet: "ERC4626" } }).title).toBe("Collapse ERC4626");
    expect(await run("layout.toggleExpand", { facet: "ERC4626" })).toEqual(["Collapsed ERC4626."]);
    expect(doc.get().layout.ERC20).toEqual(pushed);
  });
});

describe("session commands", () => {
  test("undo and redo say why they can't, and say what they did", async () => {
    start();
    expect(reason("history.undo")).toBe("Nothing to undo");
    expect(reason("history.redo")).toBe("Nothing to redo");
    await run("facet.place", { facet: "ERC20" });
    const undone = await run("history.undo");
    expect(undone[0]).toBe("Undid: Placed ERC20.");
    expect(kit.lines()[0]?.dim).toBe(true);
    expect((await run("history.redo"))[0]).toBe("Redid: Placed ERC20.");
    expect(getCommand("history.undo").console?.parse([])).toEqual({ ok: true, value: {} });
  });

  test("rename is one undo step; the same name says so", async () => {
    start();
    expect(await run("project.rename", { name: "Treasury" })).toEqual(["Renamed the project to Treasury."]);
    expect(await run("project.rename", { name: "Treasury" })).toEqual(["The project is already called Treasury."]);
    expect(doc.state().undoLabel).toBe("Renamed the project to Treasury");
  });

  test("ack.set acknowledges a warning for this recipe hash, outside history", async () => {
    start();
    await run("recipe.load", { name: "GovernedVault" });
    const hash = getAnalysis().recipeHash;
    const problem = getAnalysis().problems.find((p) => p.code === "INIT-05");
    if (!problem) throw new Error("GovernedVault should raise INIT-05");
    expect(commandState({ id: "ack.set", args: { problemId: problem.id } }).title).toBe("Keep example values");
    const pastBefore = kit.state.document.history.getState().pastStates.length;
    expect(await run("ack.set", { problemId: problem.id })).toEqual(["Kept the example values for this recipe."]);
    expect(session.get().acks[hash]).toEqual([problem.id]);
    expect(kit.state.document.history.getState().pastStates).toHaveLength(pastBefore);
    expect(await run("ack.set", { problemId: problem.id })).toEqual(["Already acknowledged for this recipe."]);
  });
});
