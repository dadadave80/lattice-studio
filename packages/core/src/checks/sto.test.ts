import { describe, expect, test } from "bun:test";
import type { CheckInput } from "../model/analysis";
import type { Catalog } from "../model/catalog";
import type { Recipe } from "../model/recipe";
import { renderProblem } from "../narrate/problem";
import { loadFixtureCatalog, makeCatalog, makeFacet, makeRecipe } from "../testing";
import { checkSto } from "./sto";

function input(catalog: Catalog, recipe: Partial<Recipe>): CheckInput {
  return { recipe: makeRecipe(recipe, catalog), catalog, routing: {}, ctx: { known: [], unconfirmed: [] } };
}

function slot(n: number): `0x${string}` {
  return `0x${n.toString(16).padStart(62, "0")}00`;
}

const catalog = makeCatalog({
  facets: [
    makeFacet({ name: "ERC20", storage: { id: "lattice.storage.ERC20", slot: slot(1) } }),
    makeFacet({ name: "ERC20Votes", touches: ["lattice.storage.Votes", "lattice.storage.ERC20", "lattice.storage.Nonces"] }),
    makeFacet({ name: "ERC20Clone", storage: { id: "lattice.storage.ERC20", slot: slot(1) } }),
    makeFacet({ name: "SlotTwin", storage: { id: "lattice.storage.Twin", slot: slot(1) } }),
    makeFacet({ name: "Votes", storage: { id: "lattice.storage.Votes", slot: slot(2) }, touches: ["lattice.storage.Votes", "lattice.storage.ERC20"] }),
    makeFacet({ name: "Other", storage: { id: "lattice.storage.Other", slot: slot(3) } }),
    makeFacet({ name: "OtherClone", storage: { id: "lattice.storage.Other", slot: slot(4) } }),
    makeFacet({ name: "DiamondLoupeFacet", touches: ["diamond.lib.storage"] }),
    makeFacet({ name: "DiamondCutFacet", family: "upgrade", touches: ["diamond.lib.storage"] }),
  ],
});

function ids(recipe: Partial<Recipe>): string[] {
  return checkSto(input(catalog, recipe)).map((p) => p.id);
}

describe("STO-01 · one ERC-7201 id or slot claimed twice", () => {
  test("two placed facets with one id: a blocker listing both, with one Remove per side", () => {
    const problems = checkSto(input(catalog, { facets: ["ERC20", "ERC20Clone"] }));
    expect(problems).toEqual([
      {
        id: "STO-01:lattice.storage.ERC20",
        code: "STO-01",
        severity: "blocker",
        where: [
          { kind: "facet", facet: "ERC20" },
          { kind: "facet", facet: "ERC20Clone" },
        ],
        params: { id: "lattice.storage.ERC20", slot: slot(1), facets: ["ERC20", "ERC20Clone"] },
        message: "",
        fixes: [
          { id: "facet.remove", args: { facets: ["ERC20"] } },
          { id: "facet.remove", args: { facets: ["ERC20Clone"] } },
        ],
      },
    ]);
    expect(renderProblem("STO-01", problems[0]?.params ?? {})).toBe("`lattice.storage.ERC20` is claimed by ERC20 and ERC20Clone.");
  });

  test("one slot under two ids is a claim too, and facets linked by id or slot make one problem", () => {
    expect(checkSto(input(catalog, { facets: ["ERC20", "SlotTwin"] })).map((p) => [p.id, p.params.facets])).toEqual([
      ["STO-01:lattice.storage.ERC20", ["ERC20", "SlotTwin"]],
    ]);
    expect(checkSto(input(catalog, { facets: ["ERC20", "ERC20Clone", "SlotTwin"] })).map((p) => [p.id, p.params.facets])).toEqual([
      ["STO-01:lattice.storage.ERC20", ["ERC20", "ERC20Clone", "SlotTwin"]],
    ]);
  });

  test("separate groups are separate problems, in catalog order", () => {
    expect(ids({ facets: ["OtherClone", "Other", "ERC20Clone", "ERC20"] })).toEqual(["STO-01:lattice.storage.ERC20", "STO-01:lattice.storage.Other"]);
  });

  test("an unplaced claimant, or shared-library storage in touches, raises nothing", () => {
    expect(ids({ facets: ["ERC20", "Other"] })).toEqual([]);
    expect(ids({ facets: ["DiamondLoupeFacet", "DiamondCutFacet"] })).toEqual([]);
  });
});

describe("STO-02 · a namespace shared by design", () => {
  test("ERC20Votes touching ERC20's namespace: info worded as the spec's, no fixes", () => {
    const problems = checkSto(input(catalog, { facets: ["ERC20", "ERC20Votes"] }));
    expect(problems).toEqual([
      {
        id: "STO-02:ERC20Votes",
        code: "STO-02",
        severity: "info",
        where: [{ kind: "facet", facet: "ERC20Votes" }],
        params: { facet: "ERC20Votes", namespace: "lattice.storage.ERC20", owner: "ERC20" },
        message: "",
        fixes: [],
      },
    ]);
    expect(renderProblem("STO-02", problems[0]?.params ?? {})).toBe("ERC20Votes shares `lattice.storage.ERC20` with ERC20.");
  });

  test("one per facet, naming the first shared namespace in its touches order; its own namespace doesn't count", () => {
    const problems = checkSto(input(catalog, { facets: ["ERC20", "ERC20Votes", "Votes"] }));
    expect(problems.map((p) => [p.id, p.params.namespace, p.params.owner])).toEqual([
      ["STO-02:ERC20Votes", "lattice.storage.Votes", "Votes"],
      ["STO-02:Votes", "lattice.storage.ERC20", "ERC20"],
    ]);
  });

  test("touching a namespace whose owner isn't placed raises nothing", () => {
    expect(ids({ facets: ["ERC20Votes"] })).toEqual([]);
  });
});

describe("the fixture catalog", () => {
  const fixture = loadFixtureCatalog();

  test.skipIf(!fixture.ok)("no two catalog facets share a storage id or slot", () => {
    if (!fixture.ok) return;
    const all = fixture.value.facets.map((f) => f.name);
    expect(checkSto(input(fixture.value, { facets: all })).filter((p) => p.code === "STO-01")).toEqual([]);
  });

  test.skipIf(!fixture.ok)("v1 templates and the Blank diamond raise no STO-01", () => {
    if (!fixture.ok) return;
    const cat = fixture.value;
    const blank = ["DiamondLoupeFacet", "ERC165Facet", "Receive", "AccessControl", "AccessControlDiamondCut"];
    const recipes = [...cat.recipes.filter((r) => r.phase === "v1").map((r) => r.recipe), makeRecipe({ facets: blank }, cat)];
    expect(recipes).toHaveLength(4);
    for (const recipe of recipes) {
      expect(checkSto(input(cat, recipe)).filter((p) => p.code === "STO-01")).toEqual([]);
    }
    const gv = cat.recipes.find((r) => r.name === "GovernedVault");
    expect(checkSto(input(cat, gv?.recipe ?? {})).find((p) => p.id === "STO-02:ERC4626")?.params).toEqual({
      facet: "ERC4626",
      namespace: "lattice.storage.ERC20",
      owner: "ERC20",
    });
  });
});
