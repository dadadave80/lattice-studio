import { describe, expect, test } from "bun:test";
import type { Catalog, Recipe, Route } from "@lattice-studio/core";
import { analyze, blankDiamond, loadTemplate, planInit } from "@lattice-studio/core";
import { loadFixtureCatalog } from "@lattice-studio/core/testing";
import { placeholderFixLabel } from "./fix-labels";
import {
  buildStructure, codeRuns, facetId, facetOfId, focusAfterRemove, INIT_ID, moveTarget, plainText, PROBLEMS_ID,
  selectorId, tooltipText, type StructureMeta,
} from "./structure-model";

const loaded = loadFixtureCatalog();
if (!loaded.ok) throw new Error(loaded.error);
const catalog: Catalog = loaded.value;

function template(name: string): Recipe {
  const r = loadTemplate(catalog, name);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

function structureOf(recipe: Recipe) {
  return buildStructure({ recipe, catalog, analysis: analyze(recipe, catalog), plan: planInit(recipe, catalog) });
}

function meta<K extends StructureMeta["kind"]>(m: ReadonlyMap<string, StructureMeta>, id: string, kind: K) {
  const found = m.get(id);
  if (found?.kind !== kind) throw new Error(`${id} isn't a ${kind}`);
  return found as Extract<StructureMeta, { kind: K }>;
}

const collision = (): Recipe => {
  const blank = blankDiamond(catalog);
  return { ...blank, facets: [...blank.facets, "AxelarGatewayAdapter", "HyperlaneGatewayAdapter"] };
};

describe("buildStructure", () => {
  test("the placed facets in recipe order, then Problems, then Init plan", () => {
    const recipe = template("GovernedVault");
    const { nodes, facets } = structureOf(recipe);
    expect(nodes.map((n) => n.id)).toEqual([...recipe.facets.map(facetId), PROBLEMS_ID, INIT_ID]);
    expect(facets).toEqual(recipe.facets.map(facetId));
    const erc20 = nodes[0];
    expect(erc20?.label).toBe("ERC20");
    expect(erc20?.children?.map((c) => c.label)).toEqual(catalog.facets.find((f) => f.name === "ERC20")?.selectors.map((s) => s.signature));
  });

  test("a facet is named as its card is (spec L745), with its connections as the description", () => {
    const { meta: m } = structureOf(template("GovernedVault"));
    const erc20 = meta(m, facetId("ERC20"), "facet");
    expect(erc20.label).toBe("ERC20, 9 selectors, 4 served by other facets");
    expect(erc20.count).toBe("5/9 selectors");
    const vaultCore = meta(m, facetId("VaultCore"), "facet");
    expect(vaultCore.description).toContain("Needs ERC4626");
  });

  test("a collision: contested selectors, the rivals in the description, a blocker in Problems", () => {
    const { meta: m, nodes } = structureOf(collision());
    const axelar = meta(m, facetId("AxelarGatewayAdapter"), "facet");
    expect(axelar.label).toMatch(/, 2 contested$/);
    expect(axelar.description).toMatch(/^Collides with HyperlaneGatewayAdapter on sendMessage and supportsAttribute; 2 blockers\.$/);
    const problems = nodes.find((n) => n.id === PROBLEMS_ID)?.children ?? [];
    const first = meta(m, problems[0]?.id ?? "", "problem");
    expect(first.problem.code).toBe("SEL-01");
    expect(first.label).toBe(`Blocker: ${plainText(first.problem.message)}`);
    expect(first.label).not.toContain("`");
  });

  test("a bundle is one locked step whose sequence is read-only; step inits list each step", () => {
    const vault = structureOf(template("GovernedVault"));
    const init = vault.nodes.find((n) => n.id === INIT_ID);
    expect(meta(vault.meta, INIT_ID, "init").label).toBe("Init plan, GovernedVaultInit bundle");
    const [bundle] = init?.children ?? [];
    expect(bundle?.id).toBe("step:bundle");
    expect(meta(vault.meta, "step:bundle", "step").label).toMatch(/^GovernedVaultInit, bundle, init\(/);
    expect(bundle?.children?.[0]?.label).toBe("AccessControl");
    expect(meta(vault.meta, bundle?.children?.[0]?.id ?? "", "sequence").label).toBe("AccessControl, 1 of 14, read-only");

    const erc20 = structureOf(template("ERC20"));
    const steps = erc20.nodes.find((n) => n.id === INIT_ID)?.children ?? [];
    expect(steps.map((s) => s.id)).toEqual(["step:ERC20Init", "step:auto"]);
    expect(meta(erc20.meta, "step:ERC20Init", "step").label).toBe("Step 1, ERC20Init, init(string,string)");
    expect(meta(erc20.meta, "step:auto", "step").label).toBe("Step 2, Register ERC-165 interfaces (automatic), initImmutable(), locked");
  });

  test("no init and no problems still show both branches, as leaves", () => {
    const recipe: Recipe = { ...template("ERC20"), facets: [], init: { kind: "none" } };
    const s = buildStructure({ recipe, catalog, analysis: { ...analyze(recipe, catalog), problems: [] }, plan: planInit(recipe, catalog) });
    expect(s.nodes.map((n) => [n.id, n.children?.length ?? 0])).toEqual([[PROBLEMS_ID, 0], [INIT_ID, 0]]);
    expect(meta(s.meta, PROBLEMS_ID, "problems").label).toBe("Problems, none");
    expect(meta(s.meta, INIT_ID, "init").label).toBe("Init plan, no init");
  });

  test("without a catalog, facets are listed by name with no selectors", () => {
    const recipe = template("ERC20");
    const s = buildStructure({ recipe, catalog: null, analysis: analyze(recipe, catalog), plan: null });
    expect(s.nodes[0]).toEqual({ id: facetId("ERC20"), label: "ERC20" });
  });
});

describe("selector rows are the card's pins (S4a's pinView)", () => {
  const recipe = template("ERC20");
  const transfer = catalog.facets.find((f) => f.name === "ERC20")?.selectors.find((s) => s.signature.startsWith("transfer("));
  if (!transfer) throw new Error("ERC20 has no transfer");
  const hex = transfer.hex;

  /** The ERC20 template's transfer row, with its route replaced (or removed) and optionally excluded. */
  function pin(route: Route | null, excluded = false) {
    const analysis = analyze(recipe, catalog);
    const routing = { ...analysis.routing };
    if (route === null) delete routing[hex];
    else routing[hex] = route;
    const s = buildStructure({
      recipe: excluded ? { ...recipe, exclude: [hex] } : recipe,
      catalog, analysis: { ...analysis, routing }, plan: planInit(recipe, catalog),
    });
    return meta(s.meta, selectorId("ERC20", hex), "selector").view;
  }

  test("routed here: Space leaves it out of the diamond", () => {
    const view = pin({ owner: "ERC20", contenders: ["ERC20"], via: "only" });
    expect(view.state).toBe("routed");
    expect(view.label).toBe(`${transfer.signature} ${hex}, routes here`);
    expect(view.action).toEqual({ id: "selector.exclude", args: { selector: hex } });
  });

  test("not in the diamond: Space brings it back, routed here", () => {
    expect(pin({ owner: "ERC20", contenders: ["ERC20"], via: "only" }, true).action)
      .toEqual({ id: "selector.include", args: { selector: hex, facet: "ERC20" } });
  });

  test("served by another facet: Space routes it here instead", () => {
    const view = pin({ owner: "Other", contenders: ["ERC20", "Other"], via: "chosen" });
    expect(view).toMatchObject({ state: "elsewhere", mark: "→ Other" });
    expect(view.action).toEqual({ id: "selector.route", args: { selector: hex, facet: "ERC20" } });
  });

  test("a seam offers no route and says why, with the card's mark", () => {
    const view = pin({ owner: "GovernedVault", contenders: ["ERC20", "GovernedVault"], via: "seam" });
    expect(view).toMatchObject({ state: "seam", mark: "Seam: stays on GovernedVault", action: null });
    expect(tooltipText(view.tooltip)).toMatch(/^Seam: stays on GovernedVault because its version .+\.$/);
  });

  test("no route yet: not checked, no action, not contested", () => {
    const view = pin(null);
    expect(view).toMatchObject({ state: "unchecked", action: null });
    expect(tooltipText(view.tooltip)).toBe("Not checked yet.");
  });

  test("owner by default: two contenders route to the other; three or more open the owner choice (contracts §6)", () => {
    expect(pin({ owner: "ERC20", contenders: ["ERC20", "B"], via: "default" }).action)
      .toEqual({ id: "selector.route", args: { selector: hex, facet: "B" } });
    expect(pin({ owner: "ERC20", contenders: ["ERC20", "B", "C"], via: "default" }).action)
      .toEqual({ id: "collision.choosePerSelector", args: { selectors: [hex] } });
  });
});

describe("moveTarget", () => {
  const recipe: Recipe = {
    ...template("ERC20"),
    init: { kind: "steps", steps: [{ spec: "ERC20Init", args: {} }, { spec: "AccessControlInit", args: {} }] },
  };
  const plan = planInit(recipe, catalog);
  const [first, second, auto] = plan.steps;
  if (!first || !second || !auto) throw new Error("expected two steps and the automatic one");

  test("a step moves one place up or down within the recipe's steps", () => {
    expect(moveTarget(first, recipe, 1)).toEqual({ ok: true, path: "steps[0]", to: 1 });
    expect(moveTarget(second, recipe, -1)).toEqual({ ok: true, path: "steps[1]", to: 0 });
  });

  test("the ends, the automatic step and a bundle say why they don't move", () => {
    expect(moveTarget(first, recipe, -1)).toEqual({ ok: false, reason: "ERC20Init is already the first step." });
    expect(moveTarget(second, recipe, 1)).toEqual({ ok: false, reason: "AccessControlInit is already the last step." });
    expect(moveTarget(auto, recipe, -1)).toEqual({ ok: false, reason: "Register ERC-165 interfaces (automatic) always runs last." });
    const vault = template("GovernedVault");
    const [bundle] = planInit(vault, catalog).steps;
    if (!bundle) throw new Error("no bundle step");
    expect(moveTarget(bundle, vault, 1)).toEqual({ ok: false, reason: "GovernedVaultInit is a bundle: its order is fixed." });
  });
});

describe("helpers", () => {
  test("ids, focus after a remove, code runs, placeholder fix labels", () => {
    expect(facetOfId(facetId("ERC20"))).toBe("ERC20");
    expect(facetOfId(PROBLEMS_ID)).toBeNull();
    const order = ["a", "b", "c"].map(facetId);
    expect(focusAfterRemove(order, new Set([facetId("b")]), facetId("b"))).toBe(facetId("c"));
    expect(focusAfterRemove(order, new Set([facetId("b"), facetId("c")]), facetId("c"))).toBe(facetId("a"));
    expect(focusAfterRemove(order, new Set(order), facetId("a"))).toBeNull();
    expect(codeRuns("ERC20Votes shares `lattice.storage.ERC20` with ERC20.")).toEqual([
      { code: false, text: "ERC20Votes shares " },
      { code: true, text: "lattice.storage.ERC20" },
      { code: false, text: " with ERC20." },
    ]);
    expect(placeholderFixLabel("INIT-01", { id: "init.focusField", args: { path: "bundle.p.asset" } })).toBeUndefined();
    expect(placeholderFixLabel("SEL-03", { id: "inspector.focusSelectors", args: { facet: "X" } })).toBe("Route a selector…");
    expect(placeholderFixLabel("NET-05", { id: "deploy.newSalt" })).toBe("Use a new salt");
    expect(placeholderFixLabel("SEL-01", { id: "selector.route" })).toBeUndefined();
  });
});
