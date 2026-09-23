import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { analyze, planInit, type Catalog, type PlanEntry } from "@lattice-studio/core";
import { serialize, type RoutingFile } from "../lib/report.ts";
import { type StudioSide, diffStudio, sideOf, studioSide } from "./compare.ts";
import { type GoldenCase, type GoldenSetup, REPO_ROOT, loadGolden, readCatalog } from "./load.ts";

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

const FIXTURES = join(REPO_ROOT, "fixtures", "catalog");
const fixture = readCatalog(FIXTURES);
const fixtureCatalog = fixture.state === "ok" ? fixture.catalog : undefined;
const noFixture = fixtureCatalog === undefined;
const dirs: string[] = [];
function tempDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "gt1b-"));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function ready(setup: GoldenSetup): Extract<GoldenSetup, { ready: true }> {
  if (!setup.ready) throw new Error("error" in setup ? setup.error : setup.skip);
  return setup;
}

/** A copy of the fixture catalog folder whose default index is replaced by `index`. */
function catalogCopy(index: string): string {
  const manifest = readFileSync(join(FIXTURES, "manifest.json"), "utf8");
  return tempDir({ "manifest.json": manifest, "fixture/index.json": index });
}

describe("readCatalog", () => {
  test("a folder without manifest.json is missing, not broken", () => {
    const state = readCatalog(tempDir({}));
    expect(state.state).toBe("missing");
    if (state.state === "missing") expect(state.reason).toMatch(/manifest\.json doesn't exist\. Run bun run catalog\.$/);
  });

  test("a corrupted index is broken", () => {
    const state = readCatalog(catalogCopy("{ corrupted"));
    expect(state.state).toBe("broken");
    if (state.state === "broken") expect(state.error).toMatch(/fixture\/index\.json isn't valid JSON/);
  });

  test("an index that isn't a catalog is broken", () => {
    const state = readCatalog(catalogCopy("{}"));
    expect(state.state).toBe("broken");
  });

  test("a manifest without its default index is broken", () => {
    const state = readCatalog(tempDir({ "manifest.json": readFileSync(join(FIXTURES, "manifest.json"), "utf8") }));
    expect(state.state).toBe("broken");
    if (state.state === "broken") expect(state.error).toMatch(/fixture\/index\.json doesn't exist, though .*manifest\.json names it/);
  });

  test.skipIf(noFixture)("an intact catalog loads", () => {
    expect(fixture.state).toBe("ok");
  });
});

describe("loadGolden", () => {
  test("skips, saying why, only when the catalog isn't built", () => {
    const setup = loadGolden({ state: "missing", reason: "catalog/manifest.json doesn't exist. Run bun run catalog." });
    expect(setup).toEqual({ ready: false, skip: "the real catalog isn't built: catalog/manifest.json doesn't exist. Run bun run catalog." });
  });

  test("a broken catalog is an error, not a skip", () => {
    const setup = loadGolden(readCatalog(catalogCopy("{ corrupted")));
    expect(setup.ready).toBe(false);
    expect("error" in setup && setup.error).toMatch(/^the real catalog doesn't load: .*isn't valid JSON/);
    expect("skip" in setup).toBe(false);
  });

  test.skipIf(noFixture)("skips, saying why, when there are no expected files", () => {
    const setup = loadGolden(fixture, tempDir({}));
    expect(setup.ready).toBe(false);
    expect("skip" in setup && setup.skip).toContain("has no *.routing.json files. Run bun run golden --update to record them.");
  });

  test.skipIf(noFixture)("fails a v1 recipe without an expected file, a file without a v1 recipe and an unreadable file", () => {
    const dir = tempDir({
      "ERC20.routing.json": serialize(expected),
      "GovernedVault.routing.json": "{ not json",
      "Account.routing.json": serialize({ ...expected, recipe: "Account" }),
    });
    const setup = ready(loadGolden(fixture, dir));
    expect(setup.cases.map((c) => c.name)).toEqual(["ERC20"]);
    expect(setup.problems).toHaveLength(3);
    expect(setup.problems[0]).toMatch(/GovernedVault\.routing\.json isn't valid JSON/);
    expect(setup.problems[1]).toMatch(/^SafeDiamondCut is a v1 recipe but .*SafeDiamondCut\.routing\.json doesn't exist/);
    expect(setup.problems[2]).toMatch(/Account\.routing\.json names Account, which isn't a v1 recipe in catalog fixture\./);
  });

  test.skipIf(noFixture)("loads each template the way the app does, with the live catalog hash", () => {
    const setup = ready(loadGolden(fixture, tempDir({ "ERC20.routing.json": serialize(expected) })));
    const erc20 = setup.cases[0];
    expect(erc20?.recipe.catalog.hash).toBe(setup.catalog.hash);
    expect(erc20?.template.script).toBe(erc20?.expected.script ?? "");
  });
});

describe("run.ts", () => {
  test("exits 1, saying why, on a catalog that's there but corrupted", () => {
    const run = Bun.spawnSync(["bun", join(import.meta.dir, "run.ts")], {
      env: { ...process.env, STUDIO_GOLDEN_CATALOG: catalogCopy("{ corrupted") },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(run.exitCode).toBe(1);
    expect(run.stderr.toString()).toMatch(/Studio's plan couldn't be compared: the real catalog doesn't load: .*isn't valid JSON/);
  });

  test("exits 0, saying why, when there's no catalog to compare", () => {
    const run = Bun.spawnSync(["bun", join(import.meta.dir, "run.ts")], {
      env: { ...process.env, STUDIO_GOLDEN_CATALOG: tempDir({}) },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(run.exitCode).toBe(0);
    expect(run.stdout.toString()).toMatch(/Studio's plan wasn't compared: the real catalog isn't built/);
  });
});

describe.skipIf(noFixture)("studioSide on the fixture catalog", () => {
  function erc20Case(): { c: GoldenCase; catalog: Catalog } {
    const setup = ready(loadGolden(fixture, tempDir({ "ERC20.routing.json": serialize(expected) })));
    const c = setup.cases[0];
    if (c === undefined) throw new Error("no ERC20 case");
    return { c, catalog: setup.catalog };
  }

  test("reads routing, signatures and the init calls off analyze and planInit", () => {
    const { c, catalog } = erc20Case();
    const side = studioSide(c.template, c.recipe, catalog);
    expect(side.inconsistencies).toEqual([]);
    expect(side.routing["0xa9059cbb"]).toBe("ERC20");
    expect(side.signatures["0xa9059cbb"]).toBe("transfer(address,uint256)");
    expect(side.init.steps.map((s) => s.init)).toEqual(["ERC20Init", "DiamondIntrospectionInit"]);
  });

  test("a cut plan that adds a facet twice, or one selector in two entries, is inconsistent", () => {
    const { c, catalog } = erc20Case();
    const analysis = structuredClone(analyze(c.recipe, catalog));
    const erc20 = analysis.plan.find((entry) => entry.facet === "ERC20");
    const loupe = analysis.plan.find((entry) => entry.facet === "DiamondLoupeFacet");
    if (erc20 === undefined || loupe === undefined) throw new Error("the fixture ERC20 plan lacks ERC20 or the loupe");
    const plan: PlanEntry[] = [
      ...analysis.plan,
      { ...erc20, selectors: [] },
      { ...loupe, facet: "Receive", selectors: ["0xa9059cbb"] },
    ];
    const side = sideOf(c.template, { ...analysis, plan }, planInit(c.recipe, catalog), catalog);
    expect(side.inconsistencies).toEqual([
      "the cut plan adds ERC20 more than once",
      "the cut plan adds Receive more than once",
      "0xa9059cbb: the cut plan adds it twice (ERC20, then Receive)",
    ]);
    expect(diffStudio(expected, side)).toContain("Studio: the cut plan adds ERC20 more than once");
  });
});
