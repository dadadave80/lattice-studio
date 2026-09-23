import { describe, expect, test } from "bun:test";
import type { CheckInput, Routing } from "../model/analysis";
import type { Catalog } from "../model/catalog";
import type { Hex4 } from "../model/hex";
import type { Recipe } from "../model/recipe";
import { renderProblem } from "../narrate/problem";
import { blankDiamond } from "../plan";
import { loadFixtureCatalog, makeCatalog, makeFacet, makeRecipe } from "../testing";
import { checkCore, upgradeConflictReason } from "./core";

/**
 * A minimal stand-in for C2's routing, enough for the six selectors CORE reads: every selector a placed facet
 * exports and the recipe doesn't exclude, owned by its only contender or by `recipe.owners`.
 */
function route(recipe: Recipe, catalog: Catalog): Routing {
  const routing: Routing = {};
  for (const facet of catalog.facets) {
    if (!recipe.facets.includes(facet.name)) continue;
    for (const { hex } of facet.selectors) {
      if (recipe.exclude.includes(hex)) continue;
      const entry = routing[hex] ?? { contenders: [], via: "only" as const };
      entry.contenders.push(facet.name);
      routing[hex] = entry;
    }
  }
  for (const [hex, entry] of Object.entries(routing) as [Hex4, Routing[Hex4]][]) {
    const chosen = recipe.owners[hex];
    if (entry.contenders.length === 1) entry.owner = entry.contenders[0] as string;
    else if (chosen !== undefined) routing[hex] = { ...entry, owner: chosen, via: "chosen" };
  }
  return routing;
}

function input(catalog: Catalog, recipe: Partial<Recipe>): CheckInput {
  const full = makeRecipe(recipe, catalog);
  return { recipe: full, catalog, routing: route(full, catalog), ctx: { known: [], unconfirmed: [] } };
}

const LOUPE = ["facets()", "facetFunctionSelectors(address)", "facetAddresses()", "facetAddress(bytes4)"];

const catalog = makeCatalog({
  facets: [
    makeFacet({ name: "ERC20", selectors: ["transfer(address,uint256)"] }),
    makeFacet({ name: "AccessControlDiamondCut", family: "upgrade", selectors: ["diamondCut((address,uint8,bytes4[])[],address,bytes)"] }),
    makeFacet({ name: "GovernedDiamondCut", family: "upgrade", selectors: ["diamondCut((address,uint8,bytes4[])[],address,bytes)", "cutCount()"] }),
    makeFacet({ name: "GovernedSafeDiamondCut", family: "upgrade", selectors: ["scheduleCut(bytes32)"] }),
    makeFacet({ name: "SafeDiamondCut", family: "upgrade", selectors: ["diamondCut((address,uint8,bytes4[])[],address,bytes)", "safe()"] }),
    makeFacet({ name: "Receive", selectors: [{ hex: "0x00000000", signature: "receive()" }] }),
    makeFacet({ name: "DiamondCutFacet", family: "upgrade", selectors: ["diamondCut((address,uint8,bytes4[])[],address,bytes)"] }),
    makeFacet({ name: "DiamondLoupeFacet", selectors: LOUPE }),
    makeFacet({ name: "ERC165Facet", selectors: ["supportsInterface(bytes4)"] }),
    makeFacet({ name: "OtherUpgrade", family: "upgrade", selectors: ["upgrade()"] }),
  ],
});

/** Everything CORE wants, with one upgrade mechanism. */
const COMPLETE = ["AccessControlDiamondCut", "Receive", "DiamondLoupeFacet", "ERC165Facet"];

function codes(recipe: Partial<Recipe>): string[] {
  return checkCore(input(catalog, recipe)).map((p) => p.code);
}

describe("CORE-01 · loupe coverage", () => {
  test("no loupe: a blocker naming facets() first, listing all four, with Place DiamondLoupeFacet", () => {
    const problems = checkCore(input(catalog, { facets: ["AccessControlDiamondCut", "Receive", "ERC165Facet"] }));
    expect(problems).toEqual([
      {
        id: "CORE-01:0x7a0ed627",
        code: "CORE-01",
        severity: "blocker",
        where: [{ kind: "selector", selector: "0x7a0ed627" }],
        params: {
          selector: "0x7a0ed627",
          signature: "facets()",
          missing: ["0x7a0ed627", "0xadfca15e", "0x52ef6b2c", "0xcdffacc6"],
          facet: "DiamondLoupeFacet",
          excluded: false,
        },
        message: "",
        fixes: [{ id: "facet.place", args: { facet: "DiamondLoupeFacet" } }],
      },
    ]);
    expect(renderProblem("CORE-01", problems[0]?.params ?? {})).toBe(
      "The loupe is incomplete: `facets()` is missing. Every Lattice diamond needs all four.",
    );
  });

  test("placed but one selector excluded: names that one and offers to include it again", () => {
    const problems = checkCore(input(catalog, { facets: COMPLETE, exclude: ["0x52ef6b2c"] }));
    expect(problems).toEqual([
      {
        id: "CORE-01:0x52ef6b2c",
        code: "CORE-01",
        severity: "blocker",
        where: [{ kind: "selector", selector: "0x52ef6b2c", facet: "DiamondLoupeFacet" }],
        params: { selector: "0x52ef6b2c", signature: "facetAddresses()", missing: ["0x52ef6b2c"], facet: "DiamondLoupeFacet", excluded: true },
        message: "",
        fixes: [{ id: "selector.include", args: { selector: "0x52ef6b2c" } }],
      },
    ]);
  });

  test("a complete loupe raises nothing, and a contested loupe selector is SEL-01's, not CORE-01's", () => {
    expect(codes({ facets: COMPLETE })).toEqual([]);
    const withRival = makeCatalog({ facets: [...catalog.facets, makeFacet({ name: "Rival", selectors: ["facets()"] })] });
    const recipe = makeRecipe({ facets: [...COMPLETE, "Rival"] }, withRival);
    expect(checkCore({ recipe, catalog: withRival, routing: route(recipe, withRival), ctx: { known: [], unconfirmed: [] } })).toEqual([]);
  });

  test("with no routing at all (nothing placed) every loupe selector is missing", () => {
    const [p] = checkCore(input(catalog, { facets: [] }));
    expect(p?.params.missing).toEqual(["0x7a0ed627", "0xadfca15e", "0x52ef6b2c", "0xcdffacc6"]);
  });
});

describe("CORE-02 · no upgrade mechanism", () => {
  test("a warning to acknowledge, with Choose an upgrade mechanism… and Keep immutable", () => {
    const problems = checkCore(input(catalog, { facets: ["Receive", "DiamondLoupeFacet", "ERC165Facet"] }));
    expect(problems).toEqual([
      {
        id: "CORE-02:diamond",
        code: "CORE-02",
        severity: "warning",
        where: [{ kind: "diamond" }],
        params: {},
        message: "",
        fixes: [{ id: "authority.chooseMechanism", args: {} }, { id: "recipe.keepImmutable" }],
        ack: true,
      },
    ]);
    expect(renderProblem("CORE-02", {})).toBe("Nothing can change this diamond after deploy.");
  });

  test("immutable acknowledged: nothing; one mechanism: nothing", () => {
    expect(codes({ facets: ["Receive", "DiamondLoupeFacet", "ERC165Facet"], immutable: true })).toEqual([]);
    expect(codes({ facets: COMPLETE })).toEqual([]);
  });
});

describe("CORE-03 · two upgrade mechanisms", () => {
  test("a blocker with the spec's reason and one Remove per side, even with no shared selector", () => {
    const problems = checkCore(input(catalog, { facets: [...COMPLETE, "GovernedSafeDiamondCut"] }));
    expect(problems).toEqual([
      {
        id: "CORE-03:AccessControlDiamondCut+GovernedSafeDiamondCut",
        code: "CORE-03",
        severity: "blocker",
        where: [
          { kind: "facet", facet: "AccessControlDiamondCut" },
          { kind: "facet", facet: "GovernedSafeDiamondCut" },
        ],
        params: {
          facets: ["AccessControlDiamondCut", "GovernedSafeDiamondCut"],
          reason: "AccessControlDiamondCut would let the admin skip GovernedSafeDiamondCut's delay",
        },
        message: "",
        fixes: [
          { id: "facet.remove", args: { facets: ["AccessControlDiamondCut"] } },
          { id: "facet.remove", args: { facets: ["GovernedSafeDiamondCut"] } },
        ],
      },
    ]);
    expect(renderProblem("CORE-03", problems[0]?.params ?? {})).toBe(
      "One upgrade mechanism per diamond: AccessControlDiamondCut would let the admin skip GovernedSafeDiamondCut's delay.",
    );
  });

  test("three members: one blocker per pair, in catalog order; no CORE-02", () => {
    const problems = checkCore(input(catalog, { facets: [...COMPLETE, "GovernedDiamondCut", "SafeDiamondCut"] }));
    expect(problems.map((p) => p.id)).toEqual([
      "CORE-03:AccessControlDiamondCut+GovernedDiamondCut",
      "CORE-03:AccessControlDiamondCut+SafeDiamondCut",
      "CORE-03:GovernedDiamondCut+SafeDiamondCut",
    ]);
  });

  test("the reason names the less guarded mechanism as the way around the other's guard", () => {
    expect(upgradeConflictReason("GovernedSafeDiamondCut", "AccessControlDiamondCut")).toBe(
      "AccessControlDiamondCut would let the admin skip GovernedSafeDiamondCut's delay",
    );
    expect(upgradeConflictReason("SafeDiamondCut", "DiamondCutFacet")).toBe("DiamondCutFacet would let the owner skip SafeDiamondCut's multisig");
    expect(upgradeConflictReason("GovernedDiamondCut", "SafeDiamondCut")).toBe(
      "SafeDiamondCut would let the Safe skip GovernedDiamondCut's upgrade executor role",
    );
    expect(upgradeConflictReason("AccessControlDiamondCut", "OtherUpgrade")).toBe(
      "AccessControlDiamondCut and OtherUpgrade could each upgrade it without the other",
    );
  });
});

describe("CORE-04 and CORE-05 · Receive and ERC-165", () => {
  test("no Receive: a warning with Place Receive", () => {
    const problems = checkCore(input(catalog, { facets: ["AccessControlDiamondCut", "DiamondLoupeFacet", "ERC165Facet"] }));
    expect(problems).toEqual([
      {
        id: "CORE-04:diamond",
        code: "CORE-04",
        severity: "warning",
        where: [{ kind: "diamond" }],
        params: { facet: "Receive" },
        message: "",
        fixes: [{ id: "facet.place", args: { facet: "Receive" } }],
      },
    ]);
    expect(renderProblem("CORE-04", { facet: "Receive" })).toBe("Plain ETH sent to this diamond will revert.");
  });

  test("no ERC165Facet: a warning with Place ERC165Facet", () => {
    const problems = checkCore(input(catalog, { facets: ["AccessControlDiamondCut", "Receive", "DiamondLoupeFacet"] }));
    expect(problems).toEqual([
      {
        id: "CORE-05:diamond",
        code: "CORE-05",
        severity: "warning",
        where: [{ kind: "diamond" }],
        params: { facet: "ERC165Facet" },
        message: "",
        fixes: [{ id: "facet.place", args: { facet: "ERC165Facet" } }],
      },
    ]);
    expect(renderProblem("CORE-05", { facet: "ERC165Facet" })).toBe(
      "`supportsInterface()` won't exist; wallets and explorers can't detect interfaces.",
    );
  });

  test("placed but excluded: still raised, with no Place fix, since placing would change nothing", () => {
    const problems = checkCore(input(catalog, { facets: COMPLETE, exclude: ["0x00000000", "0x01ffc9a7"] }));
    expect(problems.map((p) => [p.id, p.fixes])).toEqual([
      ["CORE-04:diamond", []],
      ["CORE-05:diamond", []],
    ]);
  });

  test("another placed facet serving 0x00000000 or 0x01ffc9a7 satisfies them", () => {
    const custom = makeCatalog({
      facets: [
        ...catalog.facets,
        makeFacet({ name: "Payable", selectors: [{ hex: "0x00000000", signature: "receive()" }, "supportsInterface(bytes4)"] }),
      ],
    });
    const recipe = makeRecipe({ facets: ["AccessControlDiamondCut", "DiamondLoupeFacet", "Payable"] }, custom);
    expect(checkCore({ recipe, catalog: custom, routing: route(recipe, custom), ctx: { known: [], unconfirmed: [] } })).toEqual([]);
  });
});

describe("the fixture catalog's templates and the Blank diamond", () => {
  const fixture = loadFixtureCatalog();

  test.skipIf(!fixture.ok)("v1 templates and the Blank diamond raise no CORE-01 or CORE-03; ERC20 no CORE-02", () => {
    if (!fixture.ok) return;
    const cat = fixture.value;
    const v1 = cat.recipes.filter((r) => r.phase === "v1");
    expect(v1.map((r) => r.name).sort()).toEqual(["ERC20", "GovernedVault", "SafeDiamondCut"]);
    const blank = blankDiamond(cat);
    const recipes: [string, Partial<Recipe>][] = [...v1.map((t): [string, Partial<Recipe>] => [t.name, t.recipe]), ["Blank", blank]];
    for (const [name, recipe] of recipes) {
      const found = checkCore(input(cat, recipe)).map((p) => p.code);
      expect({ name, found: found.filter((c) => c === "CORE-01" || c === "CORE-03") }).toEqual({ name, found: [] });
      // Every template places Receive and ERC165Facet, and each has one mechanism or is immutable.
      expect({ name, found }).toEqual({ name, found: [] });
    }
    const erc20 = v1.find((t) => t.name === "ERC20");
    expect(erc20?.recipe.immutable).toBe(true);
    const mutable: Partial<Recipe> = { ...erc20?.recipe };
    delete mutable.immutable;
    expect(checkCore(input(cat, mutable)).map((p) => p.code)).toEqual(["CORE-02"]);
  });

  test.skipIf(!fixture.ok)("CORE-03 on the fixture: GovernedVault plus SafeDiamondCut", () => {
    if (!fixture.ok) return;
    const gv = fixture.value.recipes.find((r) => r.name === "GovernedVault");
    const problems = checkCore(input(fixture.value, { ...gv?.recipe, facets: [...(gv?.recipe.facets ?? []), "SafeDiamondCut"] }));
    expect(problems.map((p) => [p.id, p.params.reason])).toEqual([
      ["CORE-03:GovernedDiamondCut+SafeDiamondCut", "SafeDiamondCut would let the Safe skip GovernedDiamondCut's upgrade executor role"],
    ]);
  });
});
