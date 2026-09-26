import { describe, expect, test } from "bun:test";
import { computeRouting } from "../analysis/routing";
import { catalog, fixture, S, sheet, template } from "../analysis/test-support";
import type { Catalog } from "../model/catalog";
import type { Hex4 } from "../model/hex";
import type { Problem } from "../model/problems";
import type { Recipe } from "../model/recipe";
import { makeCatalog, makeFacet, makeRecipe } from "../testing";
import { runChecks } from "./index";
import { checkSel } from "./sel";

/** checkSel on `recipe`, with messages rendered as `runChecks` renders them. */
function sel(recipe: Recipe, on: Catalog = catalog()): Problem[] {
  return runChecks({ recipe, catalog: on, routing: computeRouting(recipe, on), ctx: { known: [], unconfirmed: [] } }, [checkSel]);
}

function byCode(problems: readonly Problem[], code: string): Problem[] {
  return problems.filter((p) => p.code === code);
}

const ADAPTERS = ["AxelarGatewayAdapter", "HyperlaneGatewayAdapter"];

describe("SEL-01", () => {
  test.skipIf(fixture === null)("Axelar + Hyperlane: one blocker per shared selector, with stable ids and the spec's message", () => {
    const problems = byCode(sel(sheet(ADAPTERS)), "SEL-01");
    expect(problems.map((p) => p.id)).toEqual(["SEL-01:0xcdfe7f5c", "SEL-01:0xdc680a0f"]);
    const [send] = problems;
    expect(send).toEqual({
      id: "SEL-01:0xcdfe7f5c",
      code: "SEL-01",
      severity: "blocker",
      where: [
        { kind: "selector", selector: S.sendMessage, facet: "AxelarGatewayAdapter" },
        { kind: "selector", selector: S.sendMessage, facet: "HyperlaneGatewayAdapter" },
      ],
      params: { selector: S.sendMessage, signature: "sendMessage(bytes,bytes,bytes[])", contenders: ADAPTERS },
      message:
        "`sendMessage(bytes,bytes,bytes[])` 0xcdfe7f5c is exported by AxelarGatewayAdapter and HyperlaneGatewayAdapter. Choose one owner.",
      fixes: [
        { id: "selector.route", args: { selector: S.sendMessage, facet: "AxelarGatewayAdapter", verb: "keep" } },
        { id: "selector.route", args: { selector: S.sendMessage, facet: "HyperlaneGatewayAdapter" } },
      ],
    });
  });

  test.skipIf(fixture === null)("owners resolve both: no SEL-01", () => {
    const owners = { [S.sendMessage]: "HyperlaneGatewayAdapter", [S.supportsAttribute]: "HyperlaneGatewayAdapter" };
    expect(byCode(sel(sheet(ADAPTERS, { owners })), "SEL-01")).toEqual([]);
  });

  test.skipIf(fixture === null)("an excluded contested selector needs no choice", () => {
    const problems = byCode(sel(sheet(ADAPTERS, { exclude: [S.supportsAttribute] })), "SEL-01");
    expect(problems.map((p) => p.id)).toEqual(["SEL-01:0xcdfe7f5c"]);
  });

  test("three contenders: one route per contender (the owner menu), no Keep verb, then Choose owner… (spec L311)", () => {
    const three = makeCatalog({ facets: ["A", "B", "C"].map((name) => makeFacet({ name, selectors: ["same()"] })) });
    const [p] = sel(makeRecipe({ facets: ["C", "B", "A"] }), three);
    const selector = three.facets[0]?.selectors[0]?.hex ?? "0x";
    expect(p?.params["contenders"]).toEqual(["A", "B", "C"]);
    expect(p?.fixes).toEqual([
      ...["A", "B", "C"].map((facet) => ({ id: "selector.route", args: { selector, facet } })),
      { id: "collision.choosePerSelector", args: { selectors: [selector] } },
    ]);
  });

  test("four contenders: still one Choose owner… for the one selector", () => {
    const four = makeCatalog({ facets: ["A", "B", "C", "D"].map((name) => makeFacet({ name, selectors: ["same()"] })) });
    const [p] = sel(makeRecipe({ facets: ["A", "B", "C", "D"] }), four);
    const choose = p?.fixes.filter((fix) => fix.id === "collision.choosePerSelector");
    expect(choose).toEqual([{ id: "collision.choosePerSelector", args: { selectors: [four.facets[0]?.selectors[0]?.hex ?? "0x"] } }]);
  });

  test("two contenders never offer Choose owner…", () => {
    const two = makeCatalog({ facets: ["A", "B"].map((name) => makeFacet({ name, selectors: ["same()"] })) });
    const [p] = sel(makeRecipe({ facets: ["A", "B"] }), two);
    expect(p?.fixes.map((fix) => fix.id)).toEqual(["selector.route", "selector.route"]);
  });

  test.skipIf(fixture === null).each([
    ["AccessControlDiamondCut", "DiamondCutFacet"],
    ["AccessControlDiamondCut", "GovernedDiamondCut"],
  ])("two upgrade mechanisms share diamondCut (%s + %s): CORE-03 reports it, not SEL-01", (a, b) => {
    const recipe = sheet([a, b]);
    expect(computeRouting(recipe, catalog())[S.diamondCut]).toEqual({ contenders: [a, b], via: "chosen" });
    expect(byCode(sel(recipe), "SEL-01")).toEqual([]);
  });

  test.skipIf(fixture === null)("two access models share their role functions: DEP-03 reports it, not SEL-01", () => {
    expect(byCode(sel(sheet(["AccessControl", "AccessControlEnumerable"])), "SEL-01")).toEqual([]);
  });

  test("family members plus an outsider still collide", () => {
    const mixed = makeCatalog({
      facets: [
        makeFacet({ name: "Up1", family: "upgrade", selectors: ["cut()"] }),
        makeFacet({ name: "Up2", family: "upgrade", selectors: ["cut()"] }),
        makeFacet({ name: "Other", selectors: ["cut()"] }),
      ],
    });
    const problems = byCode(sel(makeRecipe({ facets: ["Up1", "Up2", "Other"] }), mixed), "SEL-01");
    expect(problems.map((p) => p.params["contenders"])).toEqual([["Up1", "Up2", "Other"]]);
  });

  test("a selector governed by an active seam is SEM-01's, never SEL-01's", () => {
    const seamed = makeCatalog({
      facets: [
        makeFacet({ name: "Gate", selectors: ["gate()"] }),
        makeFacet({ name: "X", selectors: ["move()"] }),
        makeFacet({ name: "Y", selectors: ["move()"] }),
        makeFacet({ name: "Safe", selectors: ["move()"] }),
      ],
      seams: [{ selector: makeFacet({ name: "t", selectors: ["move()"] }).selectors[0]?.hex ?? "0x", when: ["Gate"], anyOf: ["Safe"], reason: "r" }],
    });
    expect(byCode(sel(makeRecipe({ facets: ["Gate", "X", "Y"] }), seamed), "SEL-01")).toEqual([]);
    expect(byCode(sel(makeRecipe({ facets: ["X", "Y"] }), seamed), "SEL-01")).toHaveLength(1);
  });
});

describe("SEL-02 and SEL-03", () => {
  test.skipIf(fixture === null)("GovernedVault: ERC20 gives 4 selectors away; no facet cuts nothing", () => {
    const problems = sel(template("GovernedVault"));
    expect(byCode(problems, "SEL-03")).toEqual([]);
    const erc20 = problems.find((p) => p.id === "SEL-02:ERC20");
    expect(erc20?.params).toEqual({
      facet: "ERC20",
      count: 4,
      selectors: [S.name, S.decimals, S.transfer, S.transferFrom].sort((a, b) => erc20Order(a) - erc20Order(b)),
      to: ["GovernedVault", "ERC4626"],
    });
    // spec L312, word for word: GovernedVault takes 3 (name, transfer, transferFrom), ERC4626 takes 1 (decimals).
    expect(erc20?.message).toBe("ERC20 gives 4 selectors to GovernedVault and ERC4626.");
    expect(erc20?.severity).toBe("info");
    expect(erc20?.fixes).toEqual([{ id: "inspector.focusSelectors", args: { facet: "ERC20" } }]);
  });

  test.skipIf(fixture === null)("GovernedVault + ERC20Pausable: no choice for transfer or transferFrom, and SEL-03 says it cuts nothing", () => {
    const recipe = template("GovernedVault");
    recipe.facets.push("ERC20Pausable");
    const problems = sel(recipe);
    expect(byCode(problems, "SEL-01")).toEqual([]);
    expect(byCode(problems, "SEL-03")).toEqual([
      {
        id: "SEL-03:ERC20Pausable",
        code: "SEL-03",
        severity: "warning",
        where: [{ kind: "facet", facet: "ERC20Pausable" }],
        params: { facet: "ERC20Pausable", count: 2, why: "seams", servedBy: ["GovernedVault"], movable: [] },
        message: "ERC20Pausable cuts nothing: both its selectors are seams that GovernedVault serves. Remove it.",
        fixes: [{ id: "facet.remove", args: { facets: ["ERC20Pausable"] } }],
      },
    ]);
    expect(problems.find((p) => p.id === "SEL-02:ERC20Pausable")).toBeUndefined();
  });

  const X = makeFacet({ name: "X", selectors: ["one()", "two()"] });
  const Y = makeFacet({ name: "Y", selectors: ["one()", "two()", "three()"] });
  const xy = makeCatalog({ facets: [X, Y] });
  const [one, two] = X.selectors.map((s) => s.hex) as [Hex4, Hex4];

  test("owned elsewhere: SEL-03 with a Route a selector… fix; the winner gives nothing away, so no SEL-02", () => {
    const problems = sel(makeRecipe({ facets: ["X", "Y"], owners: { [one]: "Y", [two]: "Y" } }), xy);
    const cuts = problems.find((p) => p.code === "SEL-03");
    expect(cuts?.params).toEqual({ facet: "X", count: 2, why: "owned", servedBy: ["Y"], movable: [one, two] });
    expect(cuts?.fixes).toEqual([
      { id: "facet.remove", args: { facets: ["X"] } },
      { id: "inspector.focusSelectors", args: { facet: "X", verb: "route" } },
    ]);
    expect(byCode(problems, "SEL-02")).toEqual([]);
  });

  test("excluded, and mixed", () => {
    const excluded = sel(makeRecipe({ facets: ["X", "Y"], exclude: [one, two] }), xy).find((p) => p.code === "SEL-03");
    expect(excluded?.params).toEqual({ facet: "X", count: 2, why: "excluded", servedBy: [], movable: [one, two] });
    const mixed = sel(makeRecipe({ facets: ["X", "Y"], exclude: [one], owners: { [two]: "Y" } }), xy).find((p) => p.code === "SEL-03");
    expect(mixed?.params).toEqual({ facet: "X", count: 2, why: "mixed", servedBy: ["Y"], movable: [one, two] });
  });

  test("a selector still waiting for a choice holds SEL-03 back", () => {
    const problems = sel(makeRecipe({ facets: ["X", "Y"], owners: { [one]: "Y" } }), xy);
    expect(byCode(problems, "SEL-03")).toEqual([]);
    expect(byCode(problems, "SEL-01").map((p) => p.id)).toEqual([`SEL-01:${two}`]);
  });

  test("excluding the last routed selector of a facet raises SEL-03", () => {
    const solo = makeCatalog({ facets: [makeFacet({ name: "Solo", selectors: ["only()"] })] });
    const selector = solo.facets[0]?.selectors[0]?.hex ?? "0x";
    expect(byCode(sel(makeRecipe({ facets: ["Solo"] }), solo), "SEL-03")).toEqual([]);
    expect(byCode(sel(makeRecipe({ facets: ["Solo"], exclude: [selector] }), solo), "SEL-03").map((p) => p.id)).toEqual(["SEL-03:Solo"]);
  });
});

describe("SEL-04 and SEL-05", () => {
  test.skipIf(fixture === null)("an owner for exportSelectors() 0x0ef22643 blocks", () => {
    const problems = sel(sheet(["ERC20"], { owners: { [S.exportSelectors]: "ERC20" } }));
    expect(byCode(problems, "SEL-04")).toEqual([
      {
        id: "SEL-04:0x0ef22643",
        code: "SEL-04",
        severity: "blocker",
        where: [{ kind: "selector", selector: S.exportSelectors, facet: "ERC20" }],
        params: { selector: S.exportSelectors, signature: "exportSelectors()", facet: "ERC20" },
        message: "`exportSelectors()` is never cut into a diamond.",
        fixes: [{ id: "selector.clearOwner", args: { selector: S.exportSelectors, verb: "remove" } }],
      },
    ]);
  });

  test.skipIf(fixture === null)("an owner that isn't on the sheet", () => {
    const [p] = byCode(sel(sheet(["ERC20", "ERC20Votes"], { owners: { [S.transfer]: "GovernedVault" } })), "SEL-05");
    expect(p?.id).toBe("SEL-05:0xa9059cbb");
    expect(p?.where).toEqual([{ kind: "selector", selector: S.transfer }]);
    expect(p?.params).toEqual({ selector: S.transfer, signature: "transfer(address,uint256)", facet: "GovernedVault", reason: "not-placed" });
    expect(p?.message).toBe("GovernedVault isn't on the sheet, so it can't own `transfer` 0xa9059cbb.");
    expect(p?.fixes).toEqual([{ id: "selector.clearOwner", args: { selector: S.transfer } }]);
  });

  test.skipIf(fixture === null)("an owner that doesn't export the selector; a facet the catalog doesn't know", () => {
    const problems = byCode(sel(sheet(["ERC20", "Receive"], { owners: { [S.transfer]: "Receive", "0x12345678": "Ghost" } })), "SEL-05");
    expect(problems.map((p) => [p.id, p.params["reason"], p.params["signature"]])).toEqual([
      ["SEL-05:0x12345678", "not-placed", undefined],
      ["SEL-05:0xa9059cbb", "not-exported", "transfer(address,uint256)"],
    ]);
  });
});

describe("the v1 templates and the Blank diamond", () => {
  test.skipIf(fixture === null).each(["GovernedVault", "ERC20", "SafeDiamondCut"])("%s raises no SEL blocker or warning", (name) => {
    expect(sel(template(name)).filter((p) => p.severity !== "info")).toEqual([]);
  });

  test.skipIf(fixture === null)("Blank diamond raises no SEL problem", () => {
    const blank = sheet(["DiamondLoupeFacet", "ERC165Facet", "Receive", "AccessControl", "AccessControlDiamondCut"]);
    expect(sel(blank)).toEqual([]);
  });
});

function erc20Order(selector: Hex4): number {
  return catalog()
    .facets.find((f) => f.name === "ERC20")
    ?.selectors.findIndex((s) => s.hex === selector) ?? -1;
}
