import { describe, expect, test } from "bun:test";
import { recipeHash } from "../canonical/hash";
import { normalizeRecipe } from "../canonical/normalize";
import { isCoreFacet } from "../diamond/core";
import type { EditResult, Project } from "../model/project";
import type { Recipe } from "../model/recipe";
import { loadFixtureCatalog } from "../testing/fixtures";
import { makeCatalog, makeFacet, makeProject, makeRecipe } from "../testing/builders";
import {
  addInitStep, clearOwner, excludeSelector, includeSelector, loadRecipe, moveInitStep, placeFacet, removeFacets,
  removeInitStep, routeSelector, setImmutable, setInitArg,
} from "./recipe-ops";
import { ADDRESS, catalog, changedIssues, deepFreeze, noOpIssues, projectWith, SEL } from "./testkit";

function expectChanged(result: EditResult, before: Project, summary: string): Project {
  expect(changedIssues(result, before, summary)).toEqual([]);
  return result.project;
}

function expectNoOp(result: EditResult, before: Project, summary: string): void {
  expect(noOpIssues(result, before, summary)).toEqual([]);
}

/** Runs `op` on a frozen deep copy, so any mutation of the input throws, and checks the input survived. */
function untouched<T>(project: Project, op: (p: Project) => T): T {
  const snapshot = structuredClone(project);
  const result = op(deepFreeze(project));
  expect(project).toEqual(snapshot);
  return result;
}

describe("the core", () => {
  // The testkit catalog plus the core: DiamondLoupeFacet and ERC165Facet after Receive, in catalog order.
  const LOUPE = ["facets()", "facetFunctionSelectors(address)", "facetAddresses()", "facetAddress(bytes4)"];
  const core = makeCatalog({
    ...catalog,
    facets: [...catalog.facets, makeFacet({ name: "DiamondLoupeFacet", selectors: LOUPE }), makeFacet({ name: "ERC165Facet", selectors: ["supportsInterface(bytes4)"] })],
  });

  /** A project on `core` holding `facets`, with a card for each one that isn't the core's. */
  function on(facets: string[], extra: Partial<Recipe> = {}): Project {
    const layout: Project["layout"] = {};
    facets.filter((name) => !isCoreFacet(name)).forEach((name, index) => {
      layout[name] = { x: index * 320, y: 0, pins: "right" };
    });
    return makeProject({ recipe: makeRecipe({ facets, ...extra }, core), layout });
  }

  test("placing a core facet is a no-op that says it's in every diamond, the name as given, before any catalog lookup", () => {
    const before = on(["ERC20", "DiamondLoupeFacet", "ERC165Facet"]);
    expectNoOp(untouched(before, (p) => placeFacet(p, core, "DiamondLoupeFacet", { x: 0, y: 0 })), before, "DiamondLoupeFacet is part of every diamond's core.");
    expectNoOp(placeFacet(before, core, "ERC165Facet", { x: 0, y: 0 }), before, "ERC165Facet is part of every diamond's core.");
    // Even on a catalog that doesn't list them, and even when the recipe lacks them.
    const bare = projectWith({ facets: ["ERC20"] });
    expectNoOp(placeFacet(bare, catalog, "ERC165Facet", { x: 0, y: 0 }), bare, "ERC165Facet is part of every diamond's core.");
  });

  test("removing only core facets is a no-op that names the first; a mixed list removes the rest and says so", () => {
    const before = on(["ERC20", "Receive", "DiamondLoupeFacet", "ERC165Facet"]);
    expectNoOp(untouched(before, (p) => removeFacets(p, core, ["DiamondLoupeFacet"])), before, "DiamondLoupeFacet is the diamond's core and stays.");
    expectNoOp(removeFacets(before, core, ["ERC165Facet", "DiamondLoupeFacet"]), before, "ERC165Facet is the diamond's core and stays.");
    const result = untouched(before, (p) => removeFacets(p, core, ["DiamondLoupeFacet", "ERC20", "ERC165Facet"]));
    const after = expectChanged(result, before, "Removed ERC20 (DiamondLoupeFacet is the diamond's core and stays)");
    expect(after.recipe.facets).toEqual(["Receive", "DiamondLoupeFacet", "ERC165Facet"]);
    expect(Object.keys(after.layout)).toEqual(["Receive"]);
  });

  test("the core's five selectors can't be left out, whatever else is placed", () => {
    const before = on(["ERC20", "DiamondLoupeFacet", "ERC165Facet"]);
    const refusals = [
      ["0x7a0ed627", "facets"], ["0xadfca15e", "facetFunctionSelectors"], ["0x52ef6b2c", "facetAddresses"], ["0xcdffacc6", "facetAddress"],
      ["0x01ffc9a7", "supportsInterface"],
    ] as const;
    for (const [selector, name] of refusals) {
      expectNoOp(untouched(before, (p) => excludeSelector(p, core, selector)), before, `\`${name} · ${selector}\` is part of the diamond's core and can't be left out.`);
    }
    // Uppercase hex is the same selector.
    expectNoOp(excludeSelector(before, core, "0x7A0ED627"), before, "`facets · 0x7a0ed627` is part of the diamond's core and can't be left out.");
    // Other selectors still go.
    expect(excludeSelector(before, core, SEL.transfer).changed).toBe(true);
  });

  test("loadRecipe puts the core back in catalog order and copies the layout without the core's cards", () => {
    const before = on(["DiamondLoupeFacet", "ERC165Facet"]);
    const recipe = makeRecipe({ name: "Token", facets: ["Receive", "ERC20"] }, core);
    const layout: Project["layout"] = {
      ERC20: { x: 0, y: 0, pins: "right" },
      DiamondLoupeFacet: { x: 320, y: 0, pins: "left" },
      Receive: { x: 640, y: 0, pins: "right", expanded: true },
      ERC165Facet: { x: 960, y: 0, pins: "right" },
    };
    const result = untouched(before, (p) => loadRecipe(p, core, recipe, layout));
    const after = expectChanged(result, before, "Loaded Token");
    expect(after.recipe.facets).toEqual(["ERC20", "Receive", "DiamondLoupeFacet", "ERC165Facet"]);
    expect(after.layout).toEqual({ ERC20: { x: 0, y: 0, pins: "right" }, Receive: { x: 640, y: 0, pins: "right", expanded: true } });
    // Loading the same again, stale core cards and all, changes nothing.
    expectNoOp(loadRecipe(after, core, recipe, layout), after, "The sheet already holds Token.");
  });
});

describe("placeFacet", () => {
  test("adds the facet in catalog order and its card at the given point", () => {
    const before = projectWith({ facets: ["GovernedVault"] });
    const result = untouched(before, (p) => placeFacet(p, catalog, "ERC20", { x: 64, y: 128 }));
    const after = expectChanged(result, before, "Placed ERC20");
    expect(after.recipe.facets).toEqual(["ERC20", "GovernedVault"]);
    expect(after.layout.ERC20).toEqual({ x: 64, y: 128, pins: "right" });
    expect(after.layout.GovernedVault).toEqual(before.layout.GovernedVault);
  });

  test("names are exact: the console resolves case before it calls this", () => {
    const before = projectWith();
    expectNoOp(placeFacet(before, catalog, "erc20", { x: 0, y: 0 }), before, "The catalog has no facet named erc20.");
  });

  test("placing twice says it's already on the sheet and leaves the card where it is", () => {
    const before = projectWith({ facets: ["ERC20"] });
    expectNoOp(placeFacet(before, catalog, "ERC20", { x: 999, y: 999 }), before, "ERC20 is already on the sheet.");
  });

  test("a name the catalog lacks, or a position that isn't a number, places nothing", () => {
    const before = projectWith();
    expectNoOp(placeFacet(before, catalog, "Nope", { x: 0, y: 0 }), before, "The catalog has no facet named Nope.");
    expectNoOp(placeFacet(before, catalog, "ERC20", { x: Number.NaN, y: 0 }), before, "ERC20 wasn't placed: the position isn't a number.");
  });

  test("placed again after removal, it brings back no owner chosen by hand (PA bug 7)", () => {
    let project = projectWith({ facets: ["Axelar", "Hyperlane"] });
    project = routeSelector(project, catalog, SEL.send, "Hyperlane").project;
    expect(project.recipe.owners).toEqual({ [SEL.send]: "Hyperlane" });
    project = removeFacets(project, catalog, ["Hyperlane"]).project;
    expect(project.recipe.owners).toEqual({});
    project = placeFacet(project, catalog, "Hyperlane", { x: 0, y: 0 }).project;
    expect(project.recipe.owners).toEqual({});
    expect(project.recipe.facets).toEqual(["Axelar", "Hyperlane"]);
  });

  test("Keep A, remove B, place B again: a fresh choice, not a silent route to A (spec L429)", () => {
    let project = projectWith({ facets: ["Axelar", "Hyperlane"] });
    project = routeSelector(project, catalog, SEL.send, "Axelar").project;
    expect(project.recipe.owners).toEqual({ [SEL.send]: "Axelar" });
    project = removeFacets(project, catalog, ["Hyperlane"]).project;
    expect(project.recipe.owners).toEqual({});
    project = placeFacet(project, catalog, "Hyperlane", { x: 0, y: 0 }).project;
    expect(project.recipe.owners).toEqual({});
  });

  test("never adds an init step: INIT-04 offers that", () => {
    const before = projectWith();
    const after = placeFacet(before, catalog, "ERC20", { x: 0, y: 0 }).project;
    expect(after.recipe.init).toEqual({ kind: "none" });
  });
});

describe("removeFacets", () => {
  test("drops the facets, their owners, owners left without a contest, and their cards", () => {
    const before = projectWith({
      facets: ["Axelar", "Hyperlane", "ERC20", "ERC20Votes", "GovernedVault"],
      owners: { [SEL.send]: "Hyperlane", [SEL.supports]: "Axelar", [SEL.name]: "ERC20", [SEL.transfer]: "ERC20Votes" },
    });
    const result = untouched(before, (p) => removeFacets(p, catalog, ["Hyperlane", "ERC20"]));
    const after = expectChanged(result, before, "Removed Hyperlane and ERC20");
    expect(after.recipe.facets).toEqual(["Axelar", "ERC20Votes", "GovernedVault"]);
    // send: its owner went. supports: Axelar is its only exporter now. transfer: still contested, so kept.
    expect(after.recipe.owners).toEqual({ [SEL.transfer]: "ERC20Votes" });
    expect(Object.keys(after.layout)).toEqual(["Axelar", "ERC20Votes", "GovernedVault"]);
    expect(recipeHash(after.recipe)).not.toBe(recipeHash(before.recipe, catalog));
  });

  test("leaves owners of selectors the removed facets didn't export alone, stale imported ones included (SEL-05)", () => {
    const before = projectWith({
      facets: ["ERC20", "GovernedVault", "Receive"],
      owners: { [SEL.balanceOf]: "Vault", "0x0ef22643": "ERC20" },
    });
    const after = expectChanged(removeFacets(before, catalog, ["Receive"]), before, "Removed Receive");
    expect(after.recipe.owners).toEqual({ "0x0ef22643": "ERC20", [SEL.balanceOf]: "Vault" });
  });

  test("drops exclusions only the removed facets exported, and keeps the rest", () => {
    const before = projectWith({
      facets: ["ERC20", "GovernedVault", "Receive"],
      exclude: [SEL.balanceOf, SEL.transfer, SEL.delegate],
    });
    const after = removeFacets(before, catalog, ["ERC20"]).project;
    // balanceOf was only ERC20's; transfer is still exported by GovernedVault; delegate wasn't ERC20's to begin with.
    expect(after.recipe.exclude).toEqual([SEL.delegate, SEL.transfer]);
  });

  test("drops the removed facets' init steps, unless a facet still placed shares the init", () => {
    const before = projectWith(
      {
        facets: ["ERC20", "OwnableFacet", "DiamondCutFacet"],
        init: {
          kind: "steps",
          steps: [
            { spec: "OwnableInit", args: { _owner: { $ref: "deployer" } } },
            { spec: "ERC20Init", args: { name_: "Token" } },
            { spec: "AccessInit", args: { admin: ADDRESS } },
          ],
        },
      },
      { provenance: { "steps[0]._owner": "file", "steps[1].name_": "link", "steps[2].admin": "link" } },
    );
    const after = removeFacets(before, catalog, ["ERC20", "DiamondCutFacet"]).project;
    expect(after.recipe.init).toEqual({
      kind: "steps",
      steps: [
        { spec: "OwnableInit", args: { _owner: { $ref: "deployer" } } },
        { spec: "AccessInit", args: { admin: ADDRESS } },
      ],
    });
    expect(after.provenance).toEqual({ "steps[0]._owner": "file", "steps[1].admin": "link" });

    const both = removeFacets(after, catalog, ["OwnableFacet"]).project;
    expect(both.recipe.init).toEqual({ kind: "steps", steps: [{ spec: "AccessInit", args: { admin: ADDRESS } }] });
    expect(both.provenance).toEqual({ "steps[0].admin": "link" });
  });

  test("drops a bundle whose facet goes, leaving an empty step plan, and its provenance", () => {
    const before = projectWith(
      { facets: ["Vault", "Receive"], init: { kind: "bundle", spec: "VaultInit", args: { p: { asset: ADDRESS } } } },
      { provenance: { "bundle.p.asset": "link" } },
    );
    const after = removeFacets(before, catalog, ["Vault"]).project;
    expect(after.recipe.init).toEqual({ kind: "steps", steps: [] });
    expect(after.provenance).toEqual({});
  });

  test("removes what's there when some names aren't on the sheet", () => {
    const before = projectWith({ facets: ["ERC20"] });
    const after = expectChanged(removeFacets(before, catalog, ["ERC20", "Receive"]), before, "Removed ERC20");
    expect(after.recipe.facets).toEqual([]);
  });

  test("says what isn't on the sheet when nothing is removed", () => {
    const before = projectWith({ facets: ["ERC20"] });
    expectNoOp(removeFacets(before, catalog, ["Receive"]), before, "Receive isn't on the sheet.");
    expectNoOp(removeFacets(before, catalog, ["Receive", "Vault"]), before, "Receive and Vault aren't on the sheet.");
    expectNoOp(removeFacets(before, catalog, []), before, "Select a facet to remove.");
  });
});

describe("routeSelector", () => {
  const contested = projectWith({ facets: ["Axelar", "Hyperlane"] });

  test("routes a contested selector to the chosen facet", () => {
    const result = untouched(contested, (p) => routeSelector(p, catalog, SEL.send, "Hyperlane"));
    const after = expectChanged(result, contested, "Routed `sendMessage · 0xcdfe7f5c` to Hyperlane");
    expect(after.recipe.owners).toEqual({ [SEL.send]: "Hyperlane" });
    expect(after.recipe.facets).toEqual(contested.recipe.facets);
  });

  test("routing again says it already routes there", () => {
    const routed = routeSelector(contested, catalog, SEL.send, "Hyperlane").project;
    expectNoOp(routeSelector(routed, catalog, SEL.send, "Hyperlane"), routed, "`sendMessage · 0xcdfe7f5c` already routes to Hyperlane.");
  });

  test("accepts a selector in any case", () => {
    const after = routeSelector(contested, catalog, "0xCDFE7F5C", "Axelar").project;
    expect(after.recipe.owners).toEqual({ [SEL.send]: "Axelar" });
  });

  test("routing to the default owner is a no-op; routing away from it records the choice", () => {
    const before = projectWith({ facets: ["ERC20", "GovernedVault"] });
    expectNoOp(routeSelector(before, catalog, SEL.name, "GovernedVault"), before, "`name · 0x06fdde03` already routes to GovernedVault.");
    const after = expectChanged(routeSelector(before, catalog, SEL.name, "ERC20"), before, "Routed `name · 0x06fdde03` to ERC20");
    expect(after.recipe.owners).toEqual({ [SEL.name]: "ERC20" });
  });

  test("routing to the default owner replaces an owner that isn't on the sheet (SEL-05)", () => {
    const before = projectWith({ facets: ["ERC20", "GovernedVault"], owners: { [SEL.name]: "Axelar" } });
    const after = expectChanged(routeSelector(before, catalog, SEL.name, "GovernedVault"), before, "Routed `name · 0x06fdde03` to GovernedVault");
    expect(after.recipe.owners).toEqual({ [SEL.name]: "GovernedVault" });
  });

  test("a seam says why it can't move, and allows its other allowed facets", () => {
    const before = projectWith({ facets: ["ERC20", "ERC20Votes", "GovernedVault"] });
    expectNoOp(
      routeSelector(before, catalog, SEL.transfer, "ERC20"),
      before,
      "`transfer · 0xa9059cbb` stays on GovernedVault: its version moves vote checkpoints with balances.",
    );
    const after = routeSelector(before, catalog, SEL.transfer, "ERC20Votes").project;
    expect(after.recipe.owners).toEqual({ [SEL.transfer]: "ERC20Votes" });
    expectNoOp(
      routeSelector(after, catalog, SEL.transfer, "ERC20"),
      after,
      "`transfer · 0xa9059cbb` stays on ERC20Votes: its version moves vote checkpoints with balances.",
    );
  });

  test("brings an excluded selector back when routing it", () => {
    const before = projectWith({ facets: ["ERC20"], exclude: [SEL.balanceOf] });
    const after = expectChanged(routeSelector(before, catalog, SEL.balanceOf, "ERC20"), before, "Routed `balanceOf · 0x70a08231` to ERC20");
    expect(after.recipe.exclude).toEqual([]);
    expect(after.recipe.owners).toEqual({});
  });

  test("refuses a facet that isn't placed or doesn't export the selector", () => {
    expectNoOp(routeSelector(contested, catalog, SEL.send, "ERC20"), contested, "ERC20 isn't on the sheet.");
    const before = projectWith({ facets: ["ERC20", "Axelar"] });
    expectNoOp(routeSelector(before, catalog, SEL.send, "ERC20"), before, "ERC20 doesn't export `sendMessage · 0xcdfe7f5c`.");
  });
});

describe("clearOwner", () => {
  test("clears an owner and names the selector by signature", () => {
    const before = projectWith({ facets: ["ERC20"], owners: { [SEL.transfer]: "GovernedVault" } });
    const after = expectChanged(
      untouched(before, (p) => clearOwner(p, catalog, SEL.transfer)),
      before,
      "Cleared the owner of `transfer · 0xa9059cbb`",
    );
    expect(after.recipe.owners).toEqual({});
  });

  test("clears SEL-04's exportSelectors() owner", () => {
    const before = projectWith({ facets: ["ERC20"], owners: { "0x0ef22643": "ERC20" } });
    expectChanged(clearOwner(before, catalog, "0x0ef22643"), before, "Cleared the owner of `exportSelectors · 0x0ef22643`");
  });

  test("says when there's no owner to clear", () => {
    const before = projectWith({ facets: ["ERC20"] });
    expectNoOp(clearOwner(before, catalog, SEL.transfer), before, "`transfer · 0xa9059cbb` has no owner to clear.");
    expectNoOp(clearOwner(before, catalog, "0x12345678"), before, "`0x12345678` has no owner to clear.");
  });
});

describe("excludeSelector and includeSelector", () => {
  test("excluding stores the selector once and drops its owner", () => {
    const before = projectWith({ facets: ["Axelar", "Hyperlane"], owners: { [SEL.send]: "Axelar" } });
    const result = untouched(before, (p) => excludeSelector(p, catalog, SEL.send));
    const after = expectChanged(result, before, "Left `sendMessage · 0xcdfe7f5c` out of the diamond");
    expect(after.recipe.exclude).toEqual([SEL.send]);
    expect(after.recipe.owners).toEqual({});
    expectNoOp(excludeSelector(after, catalog, SEL.send), after, "`sendMessage · 0xcdfe7f5c` is already out.");
  });

  test("excluding a selector no placed facet exports does nothing", () => {
    const before = projectWith({ facets: ["ERC20"] });
    expectNoOp(excludeSelector(before, catalog, SEL.send), before, "No facet on the sheet exports `sendMessage · 0xcdfe7f5c`.");
  });

  test("including brings it back; repeating says it's already in", () => {
    const before = projectWith({ facets: ["ERC20"], exclude: [SEL.balanceOf] });
    const after = expectChanged(
      untouched(before, (p) => includeSelector(p, catalog, SEL.balanceOf)),
      before,
      "Brought `balanceOf · 0x70a08231` back into the diamond",
    );
    expect(after.recipe.exclude).toEqual([]);
    expectNoOp(includeSelector(after, catalog, SEL.balanceOf), after, "`balanceOf · 0x70a08231` is already in the diamond.");
  });

  test("including with a facet routes a contested selector there", () => {
    const before = projectWith({ facets: ["Axelar", "Hyperlane"], exclude: [SEL.send] });
    const after = expectChanged(
      includeSelector(before, catalog, SEL.send, "Hyperlane"),
      before,
      "Brought `sendMessage · 0xcdfe7f5c` back, routed to Hyperlane",
    );
    expect(after.recipe.exclude).toEqual([]);
    expect(after.recipe.owners).toEqual({ [SEL.send]: "Hyperlane" });
  });

  test("including with a facet that can't serve it changes nothing", () => {
    const before = projectWith({ facets: ["ERC20", "ERC20Votes", "GovernedVault"], exclude: [SEL.transfer] });
    expectNoOp(
      includeSelector(before, catalog, SEL.transfer, "ERC20"),
      before,
      "`transfer · 0xa9059cbb` stays on GovernedVault: its version moves vote checkpoints with balances.",
    );
  });
});

describe("loadRecipe", () => {
  const recipe: Recipe = {
    schemaVersion: 1,
    name: "Token",
    catalog: { tag: "test", hash: catalog.hash },
    facets: ["Receive", "ERC20"],
    owners: {},
    exclude: [],
    init: { kind: "steps", steps: [{ spec: "ERC20Init", args: { name_: "Token", symbol_: "TKN" } }] },
  };
  const layout: Project["layout"] = { ERC20: { x: 0, y: 0, pins: "right" }, Receive: { x: 320, y: 0, pins: "left" } };

  test("replaces the recipe (normalized) and the layout in one step, and resets provenance", () => {
    const before = projectWith({ facets: ["Axelar"] }, { provenance: { "steps[0].admin": "link" }, name: "Mine" });
    const result = untouched(before, (p) => loadRecipe(p, catalog, recipe, layout));
    const after = expectChanged(result, before, "Loaded Token");
    expect(after.recipe).toEqual(normalizeRecipe(recipe, catalog));
    expect(after.recipe.facets).toEqual(["ERC20", "Receive"]);
    expect(after.layout).toEqual(layout);
    expect(after.provenance).toEqual({});
    expect(after.name).toBe("Mine");
  });

  test("loading the same recipe and layout again changes nothing", () => {
    const loaded = loadRecipe(projectWith(), catalog, recipe, layout).project;
    expectNoOp(loadRecipe(loaded, catalog, recipe, layout), loaded, "The sheet already holds Token.");
  });

  test("names the template when the recipe has no name", () => {
    const { name: _name, ...unnamed } = recipe;
    const fromTemplate: Recipe = { ...unnamed, template: { name: "ERC20", catalogHash: catalog.hash } };
    expectChanged(loadRecipe(projectWith(), catalog, fromTemplate, layout), projectWith(), "Loaded ERC20");
  });
});

describe("setImmutable", () => {
  test("keeps the diamond immutable, and clears it again", () => {
    const before = projectWith({ facets: ["ERC20"] });
    const after = expectChanged(untouched(before, (p) => setImmutable(p, true)), before, "Kept the diamond immutable");
    expect(after.recipe.immutable).toBe(true);
    expect(recipeHash(after.recipe)).not.toBe(recipeHash(before.recipe));
    expectNoOp(setImmutable(after, true), after, "The diamond is already kept immutable.");
    const cleared = expectChanged(setImmutable(after, false), after, "Cleared the immutable mark");
    expect("immutable" in cleared.recipe).toBe(false);
    expectNoOp(setImmutable(cleared, false), cleared, "The diamond isn't marked immutable.");
  });
});

describe("setInitArg", () => {
  const steps = projectWith(
    {
      facets: ["ERC20", "OwnableFacet"],
      init: {
        kind: "steps",
        steps: [
          { spec: "OwnableInit", args: {} },
          { spec: "ERC20Init", args: { name_: "Example Token" } },
        ],
      },
    },
    { provenance: { "steps[0]._owner": "link", "steps[1].name_": "file" } },
  );

  test("sets a step's argument, normalized, and drops that path's link provenance", () => {
    const result = untouched(steps, (p) => setInitArg(p, catalog, "steps[0]._owner", ADDRESS.toLowerCase()));
    const after = expectChanged(result, steps, "Set OwnableInit._owner to 0x71C7…976F");
    expect(after.recipe.init).toEqual({
      kind: "steps",
      steps: [
        { spec: "OwnableInit", args: { _owner: ADDRESS } },
        { spec: "ERC20Init", args: { name_: "Example Token" } },
      ],
    });
    expect(after.provenance).toEqual({ "steps[1].name_": "file" });
    expect(after.recipe.facets).toEqual(steps.recipe.facets);
  });

  test("shows references and text in words", () => {
    expectChanged(setInitArg(steps, catalog, "steps[0]._owner", { $ref: "self" }), steps, "Set OwnableInit._owner to this diamond");
    expectChanged(setInitArg(steps, catalog, "steps[0]._owner", { $ref: "deployer" }), steps, "Set OwnableInit._owner to the deploying account");
    expectChanged(setInitArg(steps, catalog, "steps[1].name_", "Vault"), steps, "Set ERC20Init.name_ to Vault");
  });

  test("clearing removes the argument; clearing again says it's empty", () => {
    const after = expectChanged(setInitArg(steps, catalog, "steps[1].name_", undefined), steps, "Cleared ERC20Init.name_");
    expect(after.recipe.init).toEqual({ kind: "steps", steps: [{ spec: "OwnableInit", args: {} }, { spec: "ERC20Init", args: {} }] });
    expectNoOp(setInitArg(after, catalog, "steps[1].name_", undefined), after, "ERC20Init.name_ is already empty.");
  });

  test("setting the value it already has changes nothing", () => {
    expectNoOp(setInitArg(steps, catalog, "steps[1].name_", "Example Token"), steps, "ERC20Init.name_ is already Example Token.");
  });

  test("a value that normalizes to what's stored isn't an edit, and keeps provenance", () => {
    const withAddress = projectWith(
      { facets: ["OwnableFacet"], init: { kind: "steps", steps: [{ spec: "OwnableInit", args: { _owner: ADDRESS } }] } },
      { provenance: { "steps[0]._owner": "link" } },
    );
    expectNoOp(
      untouched(withAddress, (p) => setInitArg(p, catalog, "steps[0]._owner", ADDRESS.toLowerCase())),
      withAddress,
      "OwnableInit._owner is already 0x71C7…976F.",
    );
    const timed = projectWith({ facets: ["Vault"], init: { kind: "bundle", spec: "VaultInit", args: { p: { minDelay: "4" } } } });
    expectNoOp(setInitArg(timed, catalog, "bundle.p.minDelay", "004"), timed, "VaultInit.p.minDelay is already 4 seconds (4 s).");
  });

  test("shows durations and percentages in their units", () => {
    const bundle = projectWith({ facets: ["Vault"], init: { kind: "bundle", spec: "VaultInit", args: {} } });
    expectChanged(setInitArg(bundle, catalog, "bundle.p.minDelay", "300"), bundle, "Set VaultInit.p.minDelay to 5 minutes (300 s)");
    expectChanged(setInitArg(bundle, catalog, "bundle.p.quorum", "4"), bundle, "Set VaultInit.p.quorum to 4%");
    expectChanged(setInitArg(bundle, catalog, "bundle.p.cap", "1000000000000000000"), bundle, "Set VaultInit.p.cap to 1000000000000000000");
  });

  test("writes a tuple field of a bundle, and prunes the tuple once it's empty", () => {
    const bundle = projectWith({ facets: ["Vault"], init: { kind: "bundle", spec: "VaultInit", args: {} } });
    const set = expectChanged(setInitArg(bundle, catalog, "bundle.p.name", "Grant vault"), bundle, "Set VaultInit.p.name to Grant vault");
    expect(set.recipe.init).toEqual({ kind: "bundle", spec: "VaultInit", args: { p: { name: "Grant vault" } } });
    const cleared = expectChanged(setInitArg(set, catalog, "bundle.p.name", undefined), set, "Cleared VaultInit.p.name");
    expect(cleared.recipe.init).toEqual({ kind: "bundle", spec: "VaultInit", args: {} });
    expect(recipeHash(cleared.recipe)).toBe(recipeHash(bundle.recipe, catalog));
  });

  test("refuses paths that don't name a field of the plan", () => {
    expectNoOp(setInitArg(steps, catalog, "steps[1].nope", "x"), steps, "ERC20Init has no field nope.");
    expectNoOp(setInitArg(steps, catalog, "steps[1].name_.inner", "x"), steps, "ERC20Init has no field name_.inner.");
    expectNoOp(setInitArg(steps, catalog, "steps[5].name_", "x"), steps, "There's no step 6 in the init plan.");
    expectNoOp(setInitArg(steps, catalog, "bundle.p.asset", "x"), steps, "The init plan has no bundle.");
    expectNoOp(setInitArg(steps, catalog, "steps[1]", "x"), steps, "Step 2 is a whole init step; name one of its fields.");
    expectNoOp(setInitArg(steps, catalog, "args.name_", "x"), steps, "`args.name_` isn't an init field.");
  });
});

describe("addInitStep", () => {
  test("starts a step plan from none", () => {
    const before = projectWith({ facets: ["ERC20"] });
    const after = expectChanged(untouched(before, (p) => addInitStep(p, catalog, "ERC20Init")), before, "Added ERC20Init to the init plan");
    expect(after.recipe.init).toEqual({ kind: "steps", steps: [{ spec: "ERC20Init", args: {} }] });
  });

  test("inserts at an index and moves later steps' provenance along", () => {
    const before = projectWith(
      { init: { kind: "steps", steps: [{ spec: "OwnableInit", args: {} }, { spec: "AccessInit", args: { admin: ADDRESS } }] } },
      { provenance: { "steps[1].admin": "link" } },
    );
    const after = addInitStep(before, catalog, "ERC20Init", 1).project;
    expect(after.recipe.init).toEqual({
      kind: "steps",
      steps: [{ spec: "OwnableInit", args: {} }, { spec: "ERC20Init", args: {} }, { spec: "AccessInit", args: { admin: ADDRESS } }],
    });
    expect(after.provenance).toEqual({ "steps[2].admin": "link" });
  });

  test("refuses a duplicate, an unknown init and a mix of bundle and steps", () => {
    const stepsPlan = projectWith({ init: { kind: "steps", steps: [{ spec: "ERC20Init", args: {} }] } });
    expectNoOp(addInitStep(stepsPlan, catalog, "ERC20Init"), stepsPlan, "ERC20Init is already in the init plan.");
    expectNoOp(addInitStep(stepsPlan, catalog, "Nope"), stepsPlan, "The catalog has no init named Nope.");
    expectNoOp(addInitStep(stepsPlan, catalog, "VaultInit"), stepsPlan, "VaultInit is a bundle, so it can't join other steps. Remove them first.");
    const bundle = projectWith({ init: { kind: "bundle", spec: "VaultInit", args: {} } });
    expectNoOp(addInitStep(bundle, catalog, "ERC20Init"), bundle, "The init plan is the VaultInit bundle, so it takes no other steps.");
    expectNoOp(addInitStep(bundle, catalog, "VaultInit"), bundle, "VaultInit is already in the init plan.");
  });

  test("a bundle becomes the whole plan when there's none", () => {
    const before = projectWith({ facets: ["Vault"] });
    const after = expectChanged(addInitStep(before, catalog, "VaultInit"), before, "Added VaultInit to the init plan");
    expect(after.recipe.init).toEqual({ kind: "bundle", spec: "VaultInit", args: {} });
  });
});

describe("removeInitStep", () => {
  const before = projectWith(
    {
      facets: ["ERC20", "OwnableFacet"],
      init: {
        kind: "steps",
        steps: [
          { spec: "OwnableInit", args: { _owner: ADDRESS } },
          { spec: "ERC20Init", args: {} },
          { spec: "AccessInit", args: { admin: ADDRESS } },
        ],
      },
    },
    { provenance: { "steps[0]._owner": "link", "steps[2].admin": "file" } },
  );

  test("removes the step, leaves the facets alone and moves provenance along (INIT-03's Remove {A})", () => {
    const result = untouched(before, (p) => removeInitStep(p, catalog, "steps[0]"));
    const after = expectChanged(result, before, "Removed OwnableInit from the init plan");
    expect(after.recipe.facets).toEqual(before.recipe.facets);
    expect(after.recipe.owners).toEqual(before.recipe.owners);
    expect(after.layout).toBe(before.layout);
    expect(after.recipe.init).toEqual({
      kind: "steps",
      steps: [{ spec: "ERC20Init", args: {} }, { spec: "AccessInit", args: { admin: ADDRESS } }],
    });
    expect(after.provenance).toEqual({ "steps[1].admin": "file" });
  });

  test("accepts a field path inside the step, as INIT-03's anchors carry", () => {
    const after = removeInitStep(before, catalog, "steps[2].admin").project;
    expect(after.recipe.init.kind === "steps" && after.recipe.init.steps.map((s) => s.spec)).toEqual(["OwnableInit", "ERC20Init"]);
    expect(after.provenance).toEqual({ "steps[0]._owner": "link" });
  });

  test("removing the last step leaves a step plan with no steps (the planner still adds ERC-165)", () => {
    const one = projectWith({ init: { kind: "steps", steps: [{ spec: "ERC20Init", args: {} }] } });
    expect(removeInitStep(one, catalog, "steps[0]").project.recipe.init).toEqual({ kind: "steps", steps: [] });
  });

  test("removing the bundle also leaves a step plan with no steps, and adding works from there", () => {
    const bundle = projectWith({ facets: ["Vault"], init: { kind: "bundle", spec: "VaultInit", args: {} } }, { provenance: { "bundle.p.asset": "link" } });
    const after = expectChanged(removeInitStep(bundle, catalog, "bundle"), bundle, "Removed VaultInit from the init plan");
    expect(after.recipe.init).toEqual({ kind: "steps", steps: [] });
    expect(after.recipe.facets).toEqual(["Vault"]);
    expect(after.provenance).toEqual({});
    expect(addInitStep(after, catalog, "VaultInit").project.recipe.init).toEqual({ kind: "bundle", spec: "VaultInit", args: {} });
    expect(addInitStep(after, catalog, "ERC20Init").project.recipe.init).toEqual({ kind: "steps", steps: [{ spec: "ERC20Init", args: {} }] });
  });

  test("says when there's no such step", () => {
    expectNoOp(removeInitStep(before, catalog, "steps[3]"), before, "There's no step 4 in the init plan.");
    expectNoOp(removeInitStep(before, catalog, "bundle"), before, "The init plan has no bundle.");
    expectNoOp(removeInitStep(before, catalog, "step 1"), before, "`step 1` isn't an init step.");
  });
});

describe("moveInitStep", () => {
  const before = projectWith(
    {
      init: {
        kind: "steps",
        steps: [{ spec: "OwnableInit", args: {} }, { spec: "ERC20Init", args: {} }, { spec: "AccessInit", args: {} }],
      },
    },
    { provenance: { "steps[0]._owner": "link", "steps[2].admin": "file" } },
  );

  const specs = (p: Project): string[] => (p.recipe.init.kind === "steps" ? p.recipe.init.steps.map((s) => s.spec) : []);

  test("moves a step and says where it landed, 1-based, after its new neighbor", () => {
    const result = untouched(before, (p) => moveInitStep(p, catalog, 0, 2));
    const after = expectChanged(result, before, "Moved OwnableInit to step 3, after AccessInit");
    expect(specs(after)).toEqual(["ERC20Init", "AccessInit", "OwnableInit"]);
    expect(after.provenance).toEqual({ "steps[2]._owner": "link", "steps[1].admin": "file" });
    expect(recipeHash(after.recipe)).not.toBe(recipeHash(before.recipe, catalog));
  });

  test("moving to the top names no neighbor", () => {
    const after = expectChanged(moveInitStep(before, catalog, 2, 0), before, "Moved AccessInit to step 1");
    expect(specs(after)).toEqual(["AccessInit", "OwnableInit", "ERC20Init"]);
    expect(after.provenance).toEqual({ "steps[1]._owner": "link", "steps[0].admin": "file" });
  });

  test("refuses no-ops, out-of-range steps, bundles and empty plans", () => {
    expectNoOp(moveInitStep(before, catalog, 1, 1), before, "ERC20Init is already step 2.");
    expectNoOp(moveInitStep(before, catalog, 3, 0), before, "There's no step 4 in the init plan.");
    expectNoOp(moveInitStep(before, catalog, 0, 3), before, "There's no step 4 to move to: the plan has 3 steps.");
    const bundle = projectWith({ init: { kind: "bundle", spec: "VaultInit", args: {} } });
    expectNoOp(moveInitStep(bundle, catalog, 0, 1), bundle, "VaultInit is a bundle: its order is fixed.");
    const none = projectWith();
    expectNoOp(moveInitStep(none, catalog, 0, 1), none, "The init plan has no steps to move.");
  });
});

describe("with the fixture catalog", () => {
  const fixture = loadFixtureCatalog();

  test.skipIf(!fixture.ok)("GovernedVault: a seam refuses ERC20, and removing ERC20Votes drops its owners", () => {
    if (!fixture.ok) return;
    const cat = fixture.value;
    const template = cat.recipes.find((r) => r.name === "GovernedVault");
    expect(template).toBeDefined();
    if (!template) return;
    const loaded = loadRecipe(makeProject(), cat, template.recipe, {}).project;
    expect(loaded.recipe.owners["0x5c19a95c"]).toBe("ERC20Votes");

    const refused = routeSelector(loaded, cat, "0xa9059cbb", "ERC20");
    expect(refused.changed).toBe(false);
    expect(refused.summary).toMatch(/^`transfer · 0xa9059cbb` stays on (GovernedVault|ERC20Votes): its version moves vote checkpoints with balances\.$/);

    const removed = removeFacets(loaded, cat, ["ERC20Votes"]);
    expect(removed.summary).toBe("Removed ERC20Votes");
    expect(Object.values(removed.project.recipe.owners)).not.toContain("ERC20Votes");
    expect(removed.project.recipe.facets).not.toContain("ERC20Votes");
    expect(removed.project.recipe.init).toEqual(loaded.recipe.init);
  });
});

describe("ENS labels follow their init arguments (spec L462)", () => {
  const OTHER = "0x0000000000000000000000000000000000000001";
  const three = projectWith(
    {
      facets: ["ERC20", "OwnableFacet", "DiamondCutFacet"],
      init: {
        kind: "steps",
        steps: [
          { spec: "OwnableInit", args: { _owner: ADDRESS } },
          { spec: "ERC20Init", args: {} },
          { spec: "AccessInit", args: { admin: ADDRESS } },
        ],
      },
    },
    { labels: { "steps[0]._owner": "owner.eth", "steps[2].admin": "ops.eth" } },
  );
  const bundle = projectWith(
    { facets: ["Vault", "Receive"], init: { kind: "bundle", spec: "VaultInit", args: { p: { asset: ADDRESS } } } },
    { labels: { "bundle.p.asset": "asset.eth" } },
  );

  test("setting an address by hand drops its label and keeps the others'", () => {
    const after = untouched(three, (p) => setInitArg(p, catalog, "steps[0]._owner", OTHER)).project;
    expect(after.labels).toEqual({ "steps[2].admin": "ops.eth" });
    const cleared = setInitArg(after, catalog, "steps[2].admin", undefined).project;
    expect("labels" in cleared).toBe(false);
  });

  test("setting a tuple drops the labels below it", () => {
    const after = setInitArg(bundle, catalog, "bundle.p", { asset: OTHER });
    expect(after.changed).toBe(true);
    expect("labels" in after.project).toBe(false);
  });

  test("a set that stores nothing new keeps the labels as they were", () => {
    const result = setInitArg(three, catalog, "steps[0]._owner", ADDRESS.toLowerCase());
    expect(result.changed).toBe(false);
    expect(result.project.labels).toBe(three.labels);
  });

  test("a project without labels gains no key from any edit", () => {
    const plain = projectWith({ facets: three.recipe.facets, init: three.recipe.init });
    const edits = [
      setInitArg(plain, catalog, "steps[0]._owner", OTHER),
      addInitStep(removeInitStep(plain, catalog, "steps[1]").project, catalog, "ERC20Init", 0),
      removeInitStep(plain, catalog, "steps[0]"),
      moveInitStep(plain, catalog, 0, 2),
      removeFacets(plain, catalog, ["OwnableFacet", "DiamondCutFacet"]),
      loadRecipe(plain, catalog, bundle.recipe, bundle.layout),
    ];
    for (const edit of edits) expect("labels" in edit.project).toBe(false);
  });

  test("adding a step moves the later steps' labels along", () => {
    const two = projectWith(
      { init: { kind: "steps", steps: [{ spec: "OwnableInit", args: { _owner: ADDRESS } }, { spec: "AccessInit", args: { admin: ADDRESS } }] } },
      { labels: { "steps[0]._owner": "owner.eth", "steps[1].admin": "ops.eth" } },
    );
    const after = untouched(two, (p) => addInitStep(p, catalog, "ERC20Init", 1)).project;
    expect(after.labels).toEqual({ "steps[0]._owner": "owner.eth", "steps[2].admin": "ops.eth" });
  });

  test("moving a step takes its labels with it", () => {
    const after = untouched(three, (p) => moveInitStep(p, catalog, 0, 2)).project;
    expect(after.labels).toEqual({ "steps[2]._owner": "owner.eth", "steps[1].admin": "ops.eth" });
    // Reorder steps automatically is a run of these moves, so the labels follow it too.
    const back = moveInitStep(after, catalog, 2, 0).project;
    expect(back.recipe.init).toEqual(three.recipe.init);
    expect(back.labels).toEqual(three.labels);
  });

  test("removing a step drops its labels and moves the later ones along", () => {
    const after = untouched(three, (p) => removeInitStep(p, catalog, "steps[0]")).project;
    expect(after.labels).toEqual({ "steps[1].admin": "ops.eth" });
    expect("labels" in removeInitStep(after, catalog, "steps[1]").project).toBe(false);
  });

  test("removing the bundle drops its labels", () => {
    expect("labels" in removeInitStep(bundle, catalog, "bundle").project).toBe(false);
  });

  test("removing a facet drops its init step's labels and moves the later ones along", () => {
    const after = untouched(three, (p) => removeFacets(p, catalog, ["OwnableFacet", "DiamondCutFacet"])).project;
    expect(after.recipe.init.kind === "steps" && after.recipe.init.steps.map((s) => s.spec)).toEqual(["ERC20Init", "AccessInit"]);
    expect(after.labels).toEqual({ "steps[1].admin": "ops.eth" });
    expect("labels" in removeFacets(bundle, catalog, ["Vault"]).project).toBe(false);
  });

  test("removing a facet whose init stays keeps every label where it was", () => {
    // OwnableInit serves OwnableFacet too, so its step stays.
    const after = removeFacets(three, catalog, ["DiamondCutFacet"]).project;
    expect(after.recipe.init).toEqual(three.recipe.init);
    expect(after.labels).toBe(three.labels);
  });

  test("loading a recipe clears the labels with the provenance", () => {
    const loaded = untouched(three, (p) => loadRecipe(p, catalog, bundle.recipe, bundle.layout)).project;
    expect(loaded.provenance).toEqual({});
    expect("labels" in loaded).toBe(false);
  });
});
