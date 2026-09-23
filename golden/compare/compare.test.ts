import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { err } from "@lattice-studio/core";
import { loadFixtureCatalog } from "@lattice-studio/core/testing";
import { serialize, type RoutingFile } from "../lib/report.ts";
import { type StudioSide, diffStudio, studioSide } from "./compare.ts";
import { loadGolden } from "./load.ts";

const expected: RoutingFile = {
  recipe: "ERC20",
  script: "script/base/tokens/DeployERC20.s.sol",
  buildCuts: "buildCuts(string,string)",
  facets: ["ERC165Facet", "ERC20", "Receive"],
  routing: { "0x00000000": "Receive", "0x01ffc9a7": "ERC165Facet", "0xa9059cbb": "ERC20" },
  signatures: { "0x00000000": "receive()", "0x01ffc9a7": "supportsInterface(bytes4)", "0xa9059cbb": "transfer(address,uint256)" },
  init: {
    kind: "MultiInit",
    steps: [
      { init: "ERC20Init", selector: "0x7029144c", signature: "init(string,string)" },
      { init: "DiamondIntrospectionInit", selector: "0xd1a4dbd8", signature: "initImmutable()" },
    ],
  },
};

/** Studio's side agreeing with `expected`, facets in a different (catalog) order. */
function matching(): StudioSide {
  return {
    recipe: "ERC20",
    script: "script/base/tokens/DeployERC20.s.sol",
    routing: { "0x00000000": "Receive", "0x01ffc9a7": "ERC165Facet", "0xa9059cbb": "ERC20" },
    signatures: { "0x00000000": "receive()", "0x01ffc9a7": "supportsInterface(bytes4)", "0xa9059cbb": "transfer(address,uint256)" },
    facets: ["ERC20", "Receive", "ERC165Facet"],
    init: {
      kind: "MultiInit",
      steps: [
        { init: "ERC20Init", signature: "init(string,string)" },
        { init: "DiamondIntrospectionInit", signature: "initImmutable()" },
      ],
    },
    inconsistencies: [],
  };
}

describe("diffStudio", () => {
  test("agrees when routing, signatures and init match, whatever the facet order", () => {
    expect(diffStudio(expected, matching())).toEqual([]);
  });

  test("a wrong owner names the selector, its signature, the expected facet and Studio's", () => {
    const studio = matching();
    studio.routing["0xa9059cbb"] = "ERC165Facet";
    expect(diffStudio(expected, studio)).toEqual(["0xa9059cbb transfer(address,uint256): expected ERC20, Studio ERC165Facet"]);
  });

  test("a facet on one side only is listed by name", () => {
    const studio = matching();
    studio.facets = ["ERC20", "Receive", "DiamondLoupeFacet"];
    expect(diffStudio(expected, studio)).toEqual([
      "facets only in Lattice's script: ERC165Facet",
      "facets only in Studio's plan: DiamondLoupeFacet",
    ]);
  });

  test("a selector on one side only reads as not routed", () => {
    const studio = matching();
    delete studio.routing["0x01ffc9a7"];
    studio.routing["0x095ea7b3"] = "ERC20";
    studio.signatures["0x095ea7b3"] = "approve(address,uint256)";
    expect(diffStudio(expected, studio)).toEqual([
      "0x01ffc9a7 supportsInterface(bytes4): expected ERC165Facet, Studio (not routed)",
      "0x095ea7b3 approve(address,uint256): expected (not routed), Studio ERC20",
    ]);
  });

  test("uppercase selectors in the expected file compare case-insensitively", () => {
    const upper: RoutingFile = { ...expected, routing: { ...expected.routing, "0xA9059CBB": "ERC20" }, signatures: { ...expected.signatures } };
    delete upper.routing["0xa9059cbb"];
    expect(diffStudio(upper, matching())).toEqual([]);
  });

  test("a signature drift on the same owner is its own line", () => {
    const studio = matching();
    studio.signatures["0xa9059cbb"] = "transfer(address,uint128)";
    expect(diffStudio(expected, studio)).toEqual(["0xa9059cbb: signature expected transfer(address,uint256), Studio transfer(address,uint128)"]);
  });

  test("the script pin, the init kind and each init step are compared in order", () => {
    const studio = matching();
    studio.script = "script/base/tokens/DeployERC20Other.s.sol";
    studio.init = { kind: "direct", steps: [{ init: "ERC20Init", signature: "init(string,string)" }] };
    expect(diffStudio(expected, studio)).toEqual([
      "script: expected script/base/tokens/DeployERC20.s.sol, Studio script/base/tokens/DeployERC20Other.s.sol",
      "init: expected MultiInit, Studio direct",
      "init step 1: expected DiamondIntrospectionInit.initImmutable(), Studio (no step)",
    ]);
  });

  test("swapped init steps fail at both positions", () => {
    const studio = matching();
    studio.init.steps.reverse();
    expect(diffStudio(expected, studio)).toEqual([
      "init step 0: expected ERC20Init.init(string,string), Studio DiamondIntrospectionInit.initImmutable()",
      "init step 1: expected DiamondIntrospectionInit.initImmutable(), Studio ERC20Init.init(string,string)",
    ]);
  });

  test("Studio's own inconsistencies fail too", () => {
    const studio = matching();
    studio.inconsistencies = ["0xa9059cbb: the analysis routes it to ERC20, the cut plan to (not routed)"];
    expect(diffStudio(expected, studio)).toEqual(["Studio: 0xa9059cbb: the analysis routes it to ERC20, the cut plan to (not routed)"]);
  });
});

const fixture = loadFixtureCatalog();
const dirs: string[] = [];
function tempDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "gt1b-"));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("loadGolden", () => {
  test("skips, saying why, when the catalog isn't built", () => {
    const setup = loadGolden(err("catalog/manifest.json doesn't exist yet"));
    expect(setup).toEqual({ ready: false, skip: "the real catalog isn't built (catalog/manifest.json doesn't exist yet). Run bun run catalog." });
  });

  test.skipIf(!fixture.ok)("skips, saying why, when there are no expected files", () => {
    const setup = loadGolden(fixture, tempDir({}));
    expect(setup.ready).toBe(false);
    if (!setup.ready) expect(setup.skip).toContain("has no *.routing.json files. Run bun run golden --update to record them.");
  });

  test.skipIf(!fixture.ok)("fails a v1 recipe without an expected file, a file without a v1 recipe and an unreadable file", () => {
    const dir = tempDir({
      "ERC20.routing.json": serialize(expected),
      "GovernedVault.routing.json": "{ not json",
      "Account.routing.json": serialize({ ...expected, recipe: "Account" }),
    });
    const setup = loadGolden(fixture, dir);
    if (!setup.ready) throw new Error(setup.skip);
    expect(setup.cases.map((c) => c.name)).toEqual(["ERC20"]);
    expect(setup.problems).toHaveLength(3);
    expect(setup.problems[0]).toMatch(/GovernedVault\.routing\.json isn't valid JSON/);
    expect(setup.problems[1]).toMatch(/^SafeDiamondCut is a v1 recipe but .*SafeDiamondCut\.routing\.json doesn't exist/);
    expect(setup.problems[2]).toMatch(/Account\.routing\.json names Account, which isn't a v1 recipe in catalog fixture\./);
  });

  test.skipIf(!fixture.ok)("loads each template the way the app does, with the live catalog hash", () => {
    if (!fixture.ok) return;
    const setup = loadGolden(fixture, tempDir({ "ERC20.routing.json": serialize(expected) }));
    if (!setup.ready) throw new Error(setup.skip);
    const erc20 = setup.cases[0];
    expect(erc20?.recipe.catalog.hash).toBe(fixture.value.hash);
    expect(erc20?.template.script).toBe(erc20?.expected.script ?? "");
  });
});

describe.skipIf(!fixture.ok)("studioSide on the fixture catalog", () => {
  test("reads routing, signatures and the init calls off analyze and planInit", () => {
    if (!fixture.ok) return;
    const setup = loadGolden(fixture, tempDir({ "ERC20.routing.json": serialize(expected) }));
    if (!setup.ready) throw new Error(setup.skip);
    const c = setup.cases[0];
    if (c === undefined) throw new Error("no ERC20 case");
    const side = studioSide(c.template, c.recipe, fixture.value);
    expect(side.inconsistencies).toEqual([]);
    expect(side.routing["0xa9059cbb"]).toBe("ERC20");
    expect(side.signatures["0xa9059cbb"]).toBe("transfer(address,uint256)");
    expect(side.init.steps.map((s) => s.init)).toEqual(["ERC20Init", "DiamondIntrospectionInit"]);
  });
});
