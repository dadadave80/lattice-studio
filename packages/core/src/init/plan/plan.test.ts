import { describe, expect, test } from "bun:test";
import type { Catalog } from "../../model/catalog";
import type { InitStep, Recipe } from "../../model/recipe";
import { makeCatalog, makeFacet, makeInit, makeRecipe } from "../../testing/builders";
import { loadFixtureCatalog, recipeOf, templatesOf } from "../../testing/fixtures";
import { autoOrder, planInit } from "./plan";

const fixture = loadFixtureCatalog();
if (!fixture.ok) throw new Error(fixture.error);
const catalog = fixture.value;

function template(name: string): Recipe {
  const found = catalog.recipes.find((r) => r.name === name);
  if (!found) throw new Error(`${name} isn't in the fixture catalog`);
  return recipeOf(found);
}

const DEPLOYER = { $ref: "deployer" } as const;
const BLANK_FACETS = ["DiamondLoupeFacet", "ERC165Facet", "Receive", "AccessControl", "AccessControlDiamondCut"];

describe("planInit", () => {
  test("GovernedVault: one locked bundle step with the read-only sequence, asset missing, the examples listed", () => {
    const plan = planInit(template("GovernedVault"), catalog);
    expect(plan.kind).toBe("bundle");
    expect(plan.steps).toHaveLength(1);
    const [step] = plan.steps;
    expect(step).toMatchObject({ path: "bundle", index: 0, spec: "GovernedVaultInit", contract: "GovernedVaultInit", locked: true });
    expect(step?.automatic).toBeUndefined();
    expect(plan.sequence).toEqual(catalog.inits.find((s) => s.name === "GovernedVaultInit")?.sequence);
    expect(plan.sequence?.[0]).toBe("AccessControl");
    expect(step?.missing).toEqual(["bundle.p.asset"]);
    expect(step?.examples).toEqual([
      "bundle.p.name",
      "bundle.p.symbol",
      "bundle.p.decimalsOffset",
      "bundle.p.minDelay",
      "bundle.p.votingDelay",
      "bundle.p.votingPeriod",
      "bundle.p.proposalThreshold",
      "bundle.p.quorumNumerator",
    ]);
  });

  test("an edited field is no longer an example; example equality is by value", () => {
    const recipe = template("GovernedVault");
    if (recipe.init.kind !== "bundle") throw new Error("expected a bundle");
    const p = recipe.init.args["p"] as Record<string, string>;
    const edited: Recipe = { ...recipe, init: { ...recipe.init, args: { p: { ...p, quorumNumerator: "10", votingPeriod: "600" } } } };
    const [step] = planInit(edited, catalog).steps;
    expect(step?.examples).not.toContain("bundle.p.quorumNumerator");
    expect(step?.examples).toContain("bundle.p.votingPeriod");
  });

  test("Blank diamond: AccessControlInit with the deploying account, then the automatic initUpgradeable step", () => {
    const recipe = makeRecipe({ facets: BLANK_FACETS, init: { kind: "steps", steps: [{ spec: "AccessControlInit", args: { admin: DEPLOYER } }] } }, catalog);
    const plan = planInit(recipe, catalog);
    expect(plan.kind).toBe("steps");
    expect(plan.steps.map((s) => [s.path, s.spec, s.locked])).toEqual([
      ["steps[0]", "AccessControlInit", false],
      ["auto", "DiamondIntrospectionInit.initUpgradeable", true],
    ]);
    expect(plan.steps[0]?.missing).toEqual([]);
    expect(plan.steps[1]).toMatchObject({ index: 1, contract: "DiamondIntrospectionInit", fn: "initUpgradeable()", automatic: "initUpgradeable", fields: [] });
  });

  test("SafeDiamondCutInit registers the interfaces itself, so it replaces the automatic step", () => {
    const recipe = makeRecipe(
      {
        facets: ["DiamondLoupeFacet", "ERC165Facet", "Receive", "AccessControl", "SafeDiamondCut"],
        init: { kind: "steps", steps: [{ spec: "AccessControlInit", args: { admin: DEPLOYER } }, { spec: "SafeDiamondCutInit", args: { admin: DEPLOYER, minThreshold: "2" } }] },
      },
      catalog,
    );
    const plan = planInit(recipe, catalog);
    expect(plan.steps.map((s) => s.path)).toEqual(["steps[0]", "steps[1]"]);
    expect(plan.steps.some((s) => s.automatic)).toBe(false);
    expect(plan.steps[1]?.missing).toEqual(["steps[1].safe"]);
    expect(plan.steps[1]?.examples).toEqual(["steps[1].minThreshold"]);
  });

  test("the ERC20 recipe gets initImmutable (ERC20Init doesn't count as registersInterfaces); SafeDiamondCut gets none", () => {
    const erc20 = planInit(template("ERC20"), catalog);
    expect(erc20.steps.map((s) => [s.spec, s.automatic])).toEqual([
      ["ERC20Init", undefined],
      ["DiamondIntrospectionInit.initImmutable", "initImmutable"],
    ]);
    expect(erc20.steps[0]?.examples).toEqual(["steps[0].name_", "steps[0].symbol_"]);
    const safe = planInit(template("SafeDiamondCut"), catalog);
    expect(safe.steps.map((s) => s.spec)).toEqual(["SafeDiamondCutInit"]);
  });

  test("for every fixture recipe, facet placement (R11) and `immutable` pick the same automatic step", () => {
    for (const { name, recipe } of templatesOf(catalog)) {
      if (recipe.init.kind !== "steps") continue;
      const auto = planInit(recipe, catalog).steps.find((s) => s.automatic);
      if (!auto) continue;
      expect([name, auto.automatic]).toEqual([name, recipe.immutable ? "initImmutable" : "initUpgradeable"]);
    }
  });

  test("R11 follows placement: `immutable: true` with AccessControlDiamondCut placed still plans initUpgradeable", () => {
    const recipe = makeRecipe({ facets: BLANK_FACETS, immutable: true, init: { kind: "steps", steps: [{ spec: "AccessControlInit", args: { admin: DEPLOYER } }] } }, catalog);
    expect(planInit(recipe, catalog).steps.at(-1)?.automatic).toBe("initUpgradeable");
  });

  test("an empty step list still gets the automatic step; none has no steps", () => {
    expect(planInit(makeRecipe({ init: { kind: "steps", steps: [] } }, catalog), catalog).steps.map((s) => s.path)).toEqual(["auto"]);
    expect(planInit(makeRecipe({}, catalog), catalog)).toEqual({ kind: "none", steps: [] });
  });

  test("a spec the catalog doesn't have is shown by name, with no fields", () => {
    const plan = planInit(makeRecipe({ init: { kind: "steps", steps: [{ spec: "GoneInit", args: {} }] } }, catalog), catalog);
    expect(plan.steps[0]).toMatchObject({ path: "steps[0]", spec: "GoneInit", contract: "GoneInit", fields: [], missing: [] });
  });
});

describe("autoOrder", () => {
  const synthetic: Catalog = makeCatalog({
    facets: [makeFacet({ name: "A" }), makeFacet({ name: "B" })],
    inits: [
      makeInit({ name: "AInit", initializes: [{ module: "A" }] }),
      makeInit({ name: "BInit", initializes: [{ module: "B" }], after: ["A"] }),
      makeInit({ name: "CInit", initializes: [{ module: "C" }] }),
      makeInit({ name: "XInit", initializes: [{ module: "X" }], after: ["Y"] }),
      makeInit({ name: "YInit", initializes: [{ module: "Y" }], after: ["X"] }),
    ],
  });
  const step = (spec: string): InitStep => ({ spec, args: {} });

  test("B's after names A: placed first, B moves behind A", () => {
    expect(autoOrder([step("BInit"), step("AInit")], synthetic).map((s) => s.spec)).toEqual(["AInit", "BInit"]);
  });

  test("stable: unconstrained steps keep their relative order", () => {
    const steps = [step("CInit"), step("BInit"), step("GoneInit"), step("AInit")];
    expect(autoOrder(steps, synthetic).map((s) => s.spec)).toEqual(["CInit", "GoneInit", "AInit", "BInit"]);
  });

  test("an order that already satisfies every constraint comes back unchanged", () => {
    const steps = [step("CInit"), step("AInit"), step("BInit")];
    const sorted = autoOrder(steps, synthetic);
    expect(sorted).toEqual(steps);
    expect(sorted[0]).toBe(steps[0] as InitStep);
    expect(autoOrder([], synthetic)).toEqual([]);
  });

  test("a cycle can't be satisfied: its steps keep their order", () => {
    expect(autoOrder([step("YInit"), step("CInit"), step("XInit")], synthetic).map((s) => s.spec)).toEqual(["CInit", "YInit", "XInit"]);
  });

  test("with K3's real specs, VaultCoreInit satisfies its own after (it runs AccessControl and ERC4626 itself)", () => {
    const steps = [step("VaultCoreInit"), step("AccessControlInit")];
    expect(autoOrder(steps, catalog)).toEqual(steps);
    const governed = [step("GovernedDiamondCutInit"), step("AccessControlInit")];
    expect(autoOrder(governed, catalog)).toEqual(governed);
  });
});
