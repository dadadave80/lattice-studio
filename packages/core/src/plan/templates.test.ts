import { describe, expect, test } from "bun:test";
import { normalizeRecipe, recipeHash } from "../canonical";
import { lintCopy } from "../format/copy-lint";
import type { Hex } from "../model/hex";
import type { Recipe } from "../model/recipe";
import { hex, loadFixtureCatalog, makeCatalog, makeFacet, makeRecipe, makeTemplate, recipeOf } from "../testing";
import { BLANK_DIAMOND_FACETS, blankDiamond, loadTemplate, templateList } from "./templates";

const ZERO: Hex = `0x${"0".repeat(64)}`;

const templated = makeRecipe({
  catalog: { tag: "test", hash: ZERO },
  facets: ["Token", "Loupe"],
  owners: { "0xa9059cbb": "Token" },
  exclude: ["0x18160ddd"],
  init: { kind: "steps", steps: [{ spec: "TokenInit", args: { name_: "Example Token", admin: { $ref: "deployer" }, list: ["a", "b"] } }] },
  immutable: true,
});
const catalog = makeCatalog({
  hash: hex(0xca7),
  facets: [makeFacet({ name: "Token", selectors: ["transfer(address,uint256)"] }), makeFacet({ name: "Loupe", selectors: ["facets()"] })],
  recipes: [
    makeTemplate({ name: "Token", recipe: templated }),
    makeTemplate({ name: "Account", proxy: "AccountDiamond", phase: "v1.1", recipe: makeRecipe({ facets: ["Loupe"] }) }),
    makeTemplate({ name: "Account6900", proxy: "ModularAccount6900", phase: "v1.1", recipe: makeRecipe({ facets: ["Loupe"] }) }),
    makeTemplate({ name: "Bridge", phase: "v1.1", recipe: makeRecipe({ facets: ["Token", "Loupe", "Token"] }) }),
    makeTemplate({ name: "Someday", phase: "later" }),
  ],
});

describe("templateList", () => {
  test("v1 recipes on the Lattice proxy load; the rest say when they arrive", () => {
    expect(templateList(catalog)).toEqual([
      { name: "Token", script: "script/DeployToken.s.sol", proxy: "Lattice", phase: "v1", loadable: true, facets: 2 },
      {
        name: "Account", script: "script/DeployAccount.s.sol", proxy: "AccountDiamond", phase: "v1.1", loadable: false,
        note: "Arrives in v1.1 · Needs its own factory (AccountFactory)", facets: 1,
      },
      {
        name: "Account6900", script: "script/DeployAccount6900.s.sol", proxy: "ModularAccount6900", phase: "v1.1",
        loadable: false, note: "Arrives in v1.1 · Needs its own factory (AccountFactory6900)", facets: 1,
      },
      { name: "Bridge", script: "script/DeployBridge.s.sol", proxy: "Lattice", phase: "v1.1", loadable: false, note: "Arrives in v1.1", facets: 2 },
      { name: "Someday", script: "script/DeploySomeday.s.sol", proxy: "Lattice", phase: "later", loadable: false, note: "Arrives later", facets: 0 },
    ]);
  });

  const fixture = loadFixtureCatalog();
  test.skipIf(!fixture.ok)("fixture: the three v1 recipes load, the account recipes need their own factory", () => {
    if (!fixture.ok) return;
    const items = templateList(fixture.value);
    expect(items.filter((i) => i.loadable).map((i) => i.name)).toEqual(["GovernedVault", "ERC20", "SafeDiamondCut"]);
    // Cards, not facets: GovernedVault places 14 facets, two of them the core (D18).
    expect(items.find((i) => i.name === "GovernedVault")?.facets).toBe(12);
    expect(items.filter((i) => !i.loadable).map((i) => i.note)).toEqual([
      "Arrives in v1.1 · Needs its own factory (AccountFactory)",
      "Arrives in v1.1 · Needs its own factory (AccountFactory6900)",
    ]);
  });
});

describe("loadTemplate", () => {
  test("copies facets, owners, exclusions and init with examples, and stamps the live catalog hash", () => {
    const loaded = loadTemplate(catalog, "Token");
    expect(loaded).toEqual({
      ok: true,
      value: {
        schemaVersion: 1,
        name: "Token",
        catalog: { tag: "test", hash: hex(0xca7) },
        template: { name: "Token", catalogHash: hex(0xca7) },
        facets: ["Token", "Loupe"],
        owners: { "0xa9059cbb": "Token" },
        exclude: ["0x18160ddd"],
        init: { kind: "steps", steps: [{ spec: "TokenInit", args: { name_: "Example Token", admin: { $ref: "deployer" }, list: ["a", "b"] } }] },
        immutable: true,
      },
    });
  });

  test("the loaded recipe shares nothing with the catalog", () => {
    const loaded = loadTemplate(catalog, "Token");
    if (!loaded.ok) throw new Error(loaded.error);
    const recipe = loaded.value;
    recipe.facets.push("Other");
    recipe.owners["0x00000001"] = "Other";
    recipe.exclude.push("0x00000002");
    if (recipe.init.kind === "steps") {
      const args = recipe.init.steps[0]?.args as Record<string, unknown>;
      args.name_ = "Changed";
      (args.admin as { $ref: string }).$ref = "self";
      (args.list as string[]).push("c");
    }
    expect(templated.facets).toEqual(["Token", "Loupe"]);
    expect(templated.owners).toEqual({ "0xa9059cbb": "Token" });
    expect(templated.exclude).toEqual(["0x18160ddd"]);
    expect(templated.init).toEqual({
      kind: "steps",
      steps: [{ spec: "TokenInit", args: { name_: "Example Token", admin: { $ref: "deployer" }, list: ["a", "b"] } }],
    });
  });

  test("finds a recipe case-insensitively, as the console's `recipe governedvault` does", () => {
    const loaded = loadTemplate(catalog, "token");
    expect(loaded.ok && loaded.value.template?.name).toBe("Token");
  });

  test("refuses a name that isn't a recipe, and one that doesn't load in v1, saying why", () => {
    expect(loadTemplate(catalog, "Nope")).toEqual({ ok: false, error: "‘Nope’ isn't a recipe in Lattice test." });
    expect(loadTemplate(catalog, "Account")).toEqual({
      ok: false,
      error: "Account arrives in v1.1 and needs its own factory (AccountFactory).",
    });
    expect(loadTemplate(catalog, "Bridge")).toEqual({ ok: false, error: "Bridge arrives in v1.1." });
    expect(loadTemplate(catalog, "Someday")).toEqual({ ok: false, error: "Someday arrives later." });
  });

  const fixture = loadFixtureCatalog();
  test.skipIf(!fixture.ok)("fixture: every v1 recipe loads normalized, pinned to the live catalog hash", () => {
    if (!fixture.ok) return;
    const live = fixture.value.hash;
    expect(live).not.toBe(ZERO);
    for (const name of ["GovernedVault", "ERC20", "SafeDiamondCut"]) {
      const loaded = loadTemplate(fixture.value, name);
      if (!loaded.ok) throw new Error(loaded.error);
      const recipe: Recipe = loaded.value;
      const template = fixture.value.recipes.find((t) => t.name === name);
      expect(recipe.catalog).toEqual({ tag: fixture.value.lattice.tag, hash: live });
      expect(recipe.template).toEqual({ name, catalogHash: live });
      const source = template && recipeOf(template);
      expect(recipe.facets).toEqual(source?.facets ?? []);
      expect(recipe.init).toEqual(source?.init ?? { kind: "none" });
      expect(normalizeRecipe(recipe, fixture.value)).toEqual(recipe);
    }
    const vault = loadTemplate(fixture.value, "GovernedVault");
    expect(vault.ok && vault.value.facets.length).toBe(14);
    const erc20 = loadTemplate(fixture.value, "ERC20");
    expect(erc20.ok && erc20.value.immutable).toBe(true);
  });
});

test("notes and refusals pass the copy lint", () => {
  const copy = [
    ...templateList(catalog).flatMap((item) => (item.note === undefined ? [] : [item.note])),
    ...["Nope", "Account", "Account6900", "Bridge", "Someday"].map((name) => {
      const loaded = loadTemplate(catalog, name);
      return loaded.ok ? "" : loaded.error;
    }),
  ];
  expect(copy.filter((text) => text === "")).toEqual([]);
  expect(copy.flatMap((text) => lintCopy(text))).toEqual([]);
});

describe("blankDiamond", () => {
  const fixture = loadFixtureCatalog();
  test.skipIf(!fixture.ok)("fixture: core, AccessControl and AccessControlDiamondCut, with the deploying account as admin", () => {
    if (!fixture.ok) return;
    const recipe = blankDiamond(fixture.value);
    expect(recipe).toEqual({
      schemaVersion: 1,
      catalog: { tag: fixture.value.lattice.tag, hash: fixture.value.hash },
      // Catalog order.
      facets: ["AccessControlDiamondCut", "AccessControl", "Receive", "DiamondLoupeFacet", "ERC165Facet"],
      owners: {},
      exclude: [],
      init: { kind: "steps", steps: [{ spec: "AccessControlInit", args: { admin: { $ref: "deployer" } } }] },
    });
    expect(recipe.template).toBeUndefined();
    expect(recipe.immutable).toBeUndefined();
    expect([...recipe.facets].sort()).toEqual([...BLANK_DIAMOND_FACETS].sort());
    // Every facet and the init exist in the catalog.
    for (const name of recipe.facets) expect(fixture.value.facets.some((f) => f.name === name)).toBe(true);
    const init = fixture.value.inits.find((i) => i.name === "AccessControlInit");
    expect(init?.params.map((p) => p.name)).toEqual(["admin"]);
    expect(fixture.value.facets.find((f) => f.name === "AccessControl")?.init).toBe("AccessControlInit");
  });

  test.skipIf(!fixture.ok)("fixture: its one expected warning is DEP-02, EmergencyStop beside AccessControlDiamondCut (Q13)", () => {
    if (!fixture.ok) return;
    const recipe = blankDiamond(fixture.value);
    const placed = new Set(recipe.facets);
    const unmet = fixture.value.facets
      .filter((f) => placed.has(f.name))
      .flatMap((f) => f.requires.filter((r) => !r.anyOf.some((name) => placed.has(name))).map((r) => [f.name, r.strength, r.anyOf]));
    expect(unmet).toEqual([["AccessControlDiamondCut", "convention", ["EmergencyStop"]]]);
  });

  test("is deterministic: the same catalog gives the same recipe hash", () => {
    const tiny = makeCatalog({ facets: BLANK_DIAMOND_FACETS.map((name) => makeFacet({ name, selectors: [`${name.toLowerCase()}()`] })) });
    expect(recipeHash(blankDiamond(tiny))).toBe(recipeHash(blankDiamond(tiny)));
    expect(blankDiamond(tiny).catalog).toEqual({ tag: "test", hash: tiny.hash });
  });
});
