import { describe, expect, test } from "bun:test";
import { makeRecipe } from "../testing";
import { argLeaves, argProvenance, unconfirmedPaths } from "./paths";
import { ADMIN, ASSET, catalog, governedVault, SAFE, tokenWithAdmin } from "./test-support";

const guard = makeRecipe(
  {
    facets: ["AccessControl"],
    init: {
      kind: "steps",
      steps: [
        { spec: "AccessControlInit", args: { admin: { $ref: "deployer" } } },
        { spec: "GuardInit", args: { guardians: [ADMIN, { $ref: "self" }, SAFE], keeper: { account: ASSET, label: "0x0000000000000000000000000000000000000001" } } },
      ],
    },
  },
  catalog,
);

describe("argument paths", () => {
  test("tuples use dots, steps and array elements use indexes", () => {
    expect(argLeaves(governedVault(), catalog).map((leaf) => leaf.path)).toEqual([
      "bundle.p.asset", "bundle.p.name", "bundle.p.symbol", "bundle.p.decimalsOffset", "bundle.p.minDelay",
      "bundle.p.votingDelay", "bundle.p.votingPeriod", "bundle.p.proposalThreshold", "bundle.p.quorumNumerator",
    ]);
    expect(argLeaves(guard, catalog).map((leaf) => leaf.path)).toEqual([
      "steps[1].guardians[0]", "steps[1].guardians[2]", "steps[1].keeper.account", "steps[1].keeper.label",
    ]);
  });

  test("each leaf carries its parameter, with array elements typed as the element", () => {
    const leaves = argLeaves(guard, catalog);
    expect(leaves[0]?.param?.type).toBe("address");
    expect(leaves[0]?.param?.authority).toBe(true);
    expect(leaves[2]?.param?.name).toBe("account");
    expect(argLeaves(guard, null).every((leaf) => leaf.param === undefined)).toBe(true);
  });

  test("a recipe with no init has no arguments", () => {
    expect(argLeaves(makeRecipe({}, catalog), catalog)).toEqual([]);
  });
});

describe("unconfirmedPaths", () => {
  test("authority parameters holding literal addresses, in array elements and tuple components too", () => {
    expect(unconfirmedPaths(guard, catalog)).toEqual(["steps[1].guardians[0]", "steps[1].guardians[2]", "steps[1].keeper.account"]);
  });

  test("an address in a field that grants nothing isn't one", () => {
    expect(unconfirmedPaths(governedVault(), catalog)).toEqual([]);
  });

  test("an argument the catalog has no parameter for counts, since nothing says it grants nothing", () => {
    const recipe = makeRecipe({ init: { kind: "steps", steps: [{ spec: "ERC20Init", args: { name: "T", symbol: "T", owner: ADMIN } }] } }, catalog);
    expect(unconfirmedPaths(recipe, catalog)).toEqual(["steps[0].owner"]);
  });

  test("without the catalog, every address-shaped literal counts, in any letter case", () => {
    expect(unconfirmedPaths(guard, null)).toEqual([
      "steps[1].guardians[0]", "steps[1].guardians[2]", "steps[1].keeper.account", "steps[1].keeper.label",
    ]);
    expect(unconfirmedPaths(tokenWithAdmin(ADMIN.toLowerCase()), null)).toEqual(["steps[0].admin"]);
  });

  test("text that isn't an address isn't one", () => {
    expect(unconfirmedPaths(tokenWithAdmin("alice.eth"), catalog)).toEqual([]);
    expect(unconfirmedPaths(tokenWithAdmin(`${ADMIN}0`), catalog)).toEqual([]);
  });
});

describe("argProvenance", () => {
  test("marks every literal argument with its source", () => {
    expect(argProvenance(tokenWithAdmin(), catalog, "link")).toEqual({
      "steps[0].admin": "link", "steps[1].name": "link", "steps[1].symbol": "link",
    });
    expect(Object.values(argProvenance(guard, catalog, "file"))).toEqual(["file", "file", "file", "file"]);
  });
});
