import { describe, expect, test } from "bun:test";
import { blankDiamond, context, fixture, SAFE, template } from "../authority/test-support";
import type { AnalysisContext, CheckInput } from "../model/analysis";
import type { Catalog } from "../model/catalog";
import type { Recipe } from "../model/recipe";
import { formatAddress } from "../format/format";
import { runChecks } from "./index";
import { checkLink } from "./link";

const skip = fixture === null;
const catalog = fixture as Catalog;

function input(recipe: Recipe, ctx: AnalysisContext): CheckInput {
  return { recipe, catalog, routing: {}, ctx };
}

function safeRecipe(safe: string): Recipe {
  const recipe = template(catalog, "SafeDiamondCut");
  recipe.init = { kind: "steps", steps: [{ spec: "SafeDiamondCutInit", args: { admin: { $ref: "deployer" }, safe, minThreshold: "2" } }] };
  return recipe;
}

describe.skipIf(skip)("LINK-01", () => {
  test("an authority address from a shared link blocks until confirmed", () => {
    const ctx = context({ unconfirmed: ["steps[0].safe"], unconfirmedFrom: { "steps[0].safe": "link" } });
    expect(checkLink(input(safeRecipe(SAFE.toLowerCase()), ctx))).toEqual([
      {
        id: "LINK-01:steps[0].safe",
        code: "LINK-01",
        severity: "blocker",
        where: [{ kind: "init", path: "steps[0].safe" }],
        params: { path: "steps[0].safe", role: "diamondCut", address: SAFE, source: "link" },
        message: "",
        fixes: [
          { id: "init.confirmAddress", args: { path: "steps[0].safe" } },
          { id: "init.focusField", args: { path: "steps[0].safe" } },
        ],
      },
    ]);
  });

  test("the admin from an opened file renders the spec's wording", () => {
    const recipe: Recipe = { ...blankDiamond(catalog), init: { kind: "steps", steps: [{ spec: "AccessControlInit", args: { admin: SAFE } }] } };
    const ctx = context({ unconfirmed: ["steps[0].admin"], unconfirmedFrom: { "steps[0].admin": "file" } });
    const [p] = runChecks(input(recipe, ctx), [checkLink]);
    expect(p?.params).toEqual({ path: "steps[0].admin", role: "DEFAULT_ADMIN_ROLE", address: SAFE, source: "file" });
    expect(p?.message).toBe(`The admin role goes to ${formatAddress(SAFE)}, which came from an opened file.`);
  });

  test("without unconfirmedFrom the params carry no source", () => {
    const [p] = checkLink(input(safeRecipe(SAFE), context({ unconfirmed: ["steps[0].safe"] })));
    expect(p?.params).toEqual({ path: "steps[0].safe", role: "diamondCut", address: SAFE });
  });

  test("confirmed paths, references and arguments that receive no authority never raise it", () => {
    expect(checkLink(input(safeRecipe(SAFE), context({ unconfirmed: [] })))).toEqual([]);
    // The admin is "Deploying account": a reference can't be poisoned.
    expect(checkLink(input(safeRecipe(SAFE), context({ unconfirmed: ["steps[0].admin"] })))).toEqual([]);
    // minThreshold isn't an authority argument.
    expect(checkLink(input(safeRecipe(SAFE), context({ unconfirmed: ["steps[0].minThreshold"] })))).toEqual([]);
  });
});
