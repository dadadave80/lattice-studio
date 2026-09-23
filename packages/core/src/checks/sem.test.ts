import { describe, expect, test } from "bun:test";
import { computeRouting } from "../analysis/routing";
import { catalog, fixture, S, sheet, template } from "../analysis/test-support";
import type { Problem } from "../model/problems";
import type { Recipe } from "../model/recipe";
import { runChecks } from "./index";
import { checkSel } from "./sel";
import { checkSem } from "./sem";

function sem(recipe: Recipe): Problem[] {
  return runChecks({ recipe, catalog: catalog(), routing: computeRouting(recipe, catalog()), ctx: { known: [], unconfirmed: [] } }, [checkSem]);
}

function withPausable(owners: Recipe["owners"]): Recipe {
  const recipe = template("GovernedVault");
  recipe.facets.push("ERC20Pausable");
  recipe.owners = { ...recipe.owners, ...owners };
  return recipe;
}

describe("SEM-01", () => {
  test.skipIf(fixture === null).each(["GovernedVault", "ERC20", "SafeDiamondCut"])("%s raises none", (name) => {
    expect(sem(template(name))).toEqual([]);
  });

  test.skipIf(fixture === null)("GovernedVault + ERC20Pausable with no stale owner raises none", () => {
    expect(sem(withPausable({}))).toEqual([]);
  });

  test.skipIf(fixture === null)("an imported owner outside the seam's anyOf: anchored on that owner, while the seam still routes", () => {
    const recipe = withPausable({ [S.transfer]: "ERC20Pausable" });
    expect(sem(recipe)).toEqual([
      {
        id: "SEM-01:0xa9059cbb",
        code: "SEM-01",
        severity: "blocker",
        where: [{ kind: "selector", selector: S.transfer, facet: "ERC20Pausable" }],
        params: {
          selector: S.transfer,
          signature: "transfer(address,uint256)",
          allowed: ["GovernedVault", "ERC20Votes"],
          reason: "moves vote checkpoints with balances",
          owner: "ERC20Pausable",
          nonePlaced: false,
        },
        message:
          "`transfer(address,uint256)` must be served by a version that moves vote checkpoints with balances (GovernedVault or ERC20Votes), not ERC20Pausable.",
        fixes: [
          { id: "selector.route", args: { selector: S.transfer, facet: "GovernedVault" } },
          { id: "facet.remove", args: { facets: ["ERC20Pausable"] } },
        ],
      },
    ]);
    expect(computeRouting(recipe, catalog())[S.transfer]).toEqual({
      owner: "GovernedVault",
      contenders: ["ERC20", "ERC20Pausable", "ERC20Votes", "GovernedVault"],
      via: "seam",
    });
  });

  test.skipIf(fixture === null)("a stale owner that isn't on the sheet is SEL-05's, not SEM-01's", () => {
    const recipe = sheet(["ERC20", "ERC20Votes"], { owners: { [S.transfer]: "ERC20Pausable" } });
    expect(sem(recipe)).toEqual([]);
    const input = { recipe, catalog: catalog(), routing: computeRouting(recipe, catalog()), ctx: { known: [], unconfirmed: [] } };
    expect(runChecks(input, [checkSel]).map((p) => p.id)).toContain("SEL-05:0xa9059cbb");
  });

  test.skipIf(fixture === null)("a seam whose allowed facets aren't placed: place one; routing falls back to the only exporter", () => {
    const recipe = sheet(["ERC20", "ERC4626", "GovernedVault"]);
    const [p] = sem(recipe).filter((x) => x.id === "SEM-01:0x01e1d114");
    expect(p?.params).toEqual({
      selector: S.totalAssets,
      signature: "totalAssets()",
      allowed: ["VaultCore"],
      reason: "counts the assets strategies hold",
      nonePlaced: true,
    });
    expect(p?.where).toEqual([{ kind: "selector", selector: S.totalAssets, facet: "ERC4626" }]);
    expect(p?.fixes).toEqual([{ id: "facet.place", args: { facet: "VaultCore" } }]);
    expect(p?.message).toBe("`totalAssets()` must be served by a version that counts the assets strategies hold: place VaultCore.");
    expect(computeRouting(recipe, catalog())[S.totalAssets]).toEqual({ owner: "ERC4626", contenders: ["ERC4626"], via: "only" });
  });

  test.skipIf(fixture === null)("with nothing placed that exports the selector, SEM-01 anchors the seam's facets", () => {
    const problems = sem(sheet(["GovernedVault"]));
    expect(problems.map((p) => p.id)).toEqual(["SEM-01:0x01e1d114", "SEM-01:0x313ce567"]);
    expect(problems[0]?.where).toEqual([{ kind: "facet", facet: "GovernedVault" }]);
  });

  test.skipIf(fixture === null)("an excluded seam selector raises nothing", () => {
    expect(sem(sheet(["ERC20", "ERC4626", "GovernedVault"], { exclude: [S.totalAssets, S.decimals] }))).toEqual([]);
  });
});
