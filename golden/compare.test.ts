// Golden comparison (spec L912, L927): for every v1 recipe, Studio's routing and init sequence must equal what
// Lattice's own deploy script builds, as golden/expected/<Recipe>.routing.json records it (GT1's harness,
// `bun run golden --update`). Skips, saying why, while the real catalog or the expected files are missing.

import { describe, expect, test } from "bun:test";
import { analyze } from "@lattice-studio/core";
import { diffStudio, studioSide } from "./compare/compare.ts";
import { type GoldenCase, type GoldenSetup, loadGolden, readCatalog } from "./compare/load.ts";
import type { RoutingFile } from "./lib/report.ts";

const setup: GoldenSetup = loadGolden(readCatalog());
/** Skip only while there's nothing to compare; a broken catalog runs the tests, which fail on it. */
const skip = !setup.ready && "skip" in setup;
const skipped = !setup.ready && "skip" in setup ? ` (skipped: ${setup.skip})` : "";
if (!setup.ready && "skip" in setup) console.warn(`golden/compare.test.ts skipped: ${setup.skip}`);

function ready(): Extract<GoldenSetup, { ready: true }> {
  if (!setup.ready) throw new Error("error" in setup ? setup.error : setup.skip);
  return setup;
}

function caseFor(name: string): GoldenCase {
  const found = ready().cases.find((c) => c.name === name);
  if (found === undefined) throw new Error(`No golden case for ${name}.`);
  return found;
}

function diffFor(c: GoldenCase, expected: RoutingFile = c.expected, recipe = c.recipe): string[] {
  return diffStudio(expected, studioSide(c.template, recipe, ready().catalog));
}

describe("golden: Studio's plan against Lattice's scripts", () => {
  test.skipIf(skip)(`the real catalog loads${skipped}`, () => {
    expect("error" in setup ? setup.error : "").toBe("");
  });

  test.skipIf(skip)(`every v1 recipe pairs with an expected file${skipped}`, () => {
    const { problems } = ready();
    expect(problems, problems.join("\n")).toEqual([]);
  });

  test.skipIf(skip)(`covers GovernedVault, ERC20 and SafeDiamondCut${skipped}`, () => {
    const names = ready().cases.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(["GovernedVault", "ERC20", "SafeDiamondCut"]));
  });

  for (const c of setup.ready ? setup.cases : []) {
    test(`${c.name}: routing and init match ${c.path}`, () => {
      const lines = diffFor(c);
      const heading = `${c.name}: ${lines.length} ${lines.length === 1 ? "difference" : "differences"} between ${c.path} (Lattice's ${c.expected.script}) and Studio's plan`;
      expect(lines, `${heading}\n  ${lines.join("\n  ")}`).toEqual([]);
    });
  }

  // A template may ask for arguments nobody can default (the vault's asset, the Safe: spec L411), which raise
  // INIT-01 as missing; any other blocker means the template no longer deploys as Lattice's script does.
  test.skipIf(skip)(`no v1 template has a blocker besides a missing argument${skipped}`, () => {
    const found = ready().cases.flatMap((c) =>
      analyze(c.recipe, ready().catalog)
        .problems.filter((p) => p.severity === "blocker" && !(p.code === "INIT-01" && p.params["missing"] === true))
        .map((p) => `${c.name}: ${p.id} ${p.message}`),
    );
    expect(found, found.join("\n")).toEqual([]);
  });

  test.skipIf(skip)(`a wrong owner in a copy of the GovernedVault recipe fails with a readable diff${skipped}`, () => {
    const c = caseFor("GovernedVault");
    const recipe = structuredClone(c.recipe);
    recipe.owners["0x06fdde03"] = "ERC20";
    expect(diffFor(c, c.expected, recipe)).toEqual(["0x06fdde03 name(): expected GovernedVault, Studio ERC20"]);
  });

  test.skipIf(skip)(`a wrong owner in a copy of ERC20's expected file fails with a readable diff${skipped}`, () => {
    const c = caseFor("ERC20");
    const expected = structuredClone(c.expected);
    expected.routing["0xa9059cbb"] = "DiamondLoupeFacet";
    expect(diffFor(c, expected)).toEqual(["0xa9059cbb transfer(address,uint256): expected DiamondLoupeFacet, Studio ERC20"]);
  });

  test.skipIf(skip)(`an excluded selector in a copy of the SafeDiamondCut recipe shows as not routed${skipped}`, () => {
    const c = caseFor("SafeDiamondCut");
    const recipe = structuredClone(c.recipe);
    recipe.exclude = ["0x5db0cb94"];
    expect(diffFor(c, c.expected, recipe)).toEqual(["0x5db0cb94 setSafe(address): expected SafeDiamondCut, Studio (not routed)"]);
  });

  test.skipIf(skip)(`a dropped init in a copy of ERC20's recipe fails step by step${skipped}`, () => {
    const c = caseFor("ERC20");
    const recipe = structuredClone(c.recipe);
    recipe.init = { kind: "none" };
    expect(diffFor(c, c.expected, recipe)).toEqual([
      "init: expected MultiInit, Studio none",
      "init step 0: expected ERC20Init.init(string,string), Studio (no step)",
      "init step 1: expected DiamondIntrospectionInit.initImmutable(), Studio (no step)",
    ]);
  });

  test.skipIf(skip)(`GovernedVault's expanded tuple init and ERC20's MultiInit read as Lattice's scripts do${skipped}`, () => {
    const vault = studioSide(caseFor("GovernedVault").template, caseFor("GovernedVault").recipe, ready().catalog);
    expect(vault.init).toEqual({
      kind: "direct",
      steps: [{ init: "GovernedVaultInit", signature: "init((address,string,string,uint8,uint256,uint48,uint32,uint256,uint256))" }],
    });
    const erc20 = studioSide(caseFor("ERC20").template, caseFor("ERC20").recipe, ready().catalog);
    expect(erc20.init.kind).toBe("MultiInit");
    expect(erc20.routing["0x00000000"]).toBe("Receive");
    expect(vault.routing["0x91ddadf4"]).toBe("GovernedVault");
    expect(vault.routing["0x4bf5d7e9"]).toBe("GovernedVault");
  });
});
