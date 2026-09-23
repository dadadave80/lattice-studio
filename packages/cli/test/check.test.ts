/**
 * `check` and `plan`, spawned as the real CLI: exit codes 0, 1, 2 and 3, the `--json` shapes (check mirrors core's
 * Analysis exactly), the human output in C10's formats, LINK-01 and `--confirm`, and `--catalog`.
 */
import { describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyze, buildPlan, formatAddress, recipeStats } from "@lattice-studio/core";
import {
  BUILT,
  coreRead,
  FIXTURE,
  FIXTURE_CATALOGS,
  makeProject,
  runCli,
  SAFE,
  spawnCli,
  tempDir,
  template,
  writeProject,
  writeRecipe,
} from "./support";

const dir = tempDir();
const erc20 = writeRecipe(dir, template(BUILT, "ERC20"), BUILT, "erc20.json");
const vault = writeRecipe(dir, template(BUILT, "GovernedVault"), BUILT, "vault.json");

/** SafeDiamondCut with a literal Safe address: the upgrade role goes to an address from the file (LINK-01). */
function safeCut() {
  const recipe = template(BUILT, "SafeDiamondCut");
  if (recipe.init.kind !== "steps" || recipe.init.steps[0] === undefined) throw new Error("SafeDiamondCut changed shape");
  recipe.init.steps[0].args["safe"] = SAFE;
  return recipe;
}
const linked = writeRecipe(dir, safeCut(), BUILT, "safe-cut.json");

describe("check", () => {
  test("no blockers: exit 0, the stats and the problems chip in C10's formats", async () => {
    const { code, stdout, stderr } = await spawnCli(["check", erc20]);
    expect(code).toBe(0);
    const { analysis } = coreRead(erc20, BUILT);
    const lines = stdout.trimEnd().split("\n");
    expect(lines[0]).toBe(`ERC20 · recipe ${analysis.recipeHash} · Lattice dev-f4a32c8`);
    expect(lines[1]).toBe(recipeStats(analysis, BUILT).text);
    expect(lines[2]).toBe("1 warning");
    expect(lines[3]).toBe(`  Warning  INIT-05  ${analysis.problems[0]?.message}`);
    // The provisional catalog note goes to stderr, so stdout stays the command's output.
    expect(stderr).toContain("Provisional catalog: Lattice 0.2.0 at dev f4a32c8");
  });

  test("blockers: exit 1, listed first", async () => {
    const { code, stdout } = await spawnCli(["check", vault]);
    expect(code).toBe(1);
    expect(stdout).toContain("1 blocker · 1 warning");
    expect(stdout).toContain("  Blocker  INIT-01  Asset is required. Fill it in before deploying.");
  });

  test("--json mirrors core's Analysis exactly", async () => {
    const ok = await spawnCli(["check", erc20, "--json"]);
    expect(ok.code).toBe(0);
    expect(JSON.parse(ok.stdout)).toEqual(JSON.parse(JSON.stringify(coreRead(erc20, BUILT).analysis)));
    const blocked = await spawnCli(["check", vault, "--json"]);
    expect(blocked.code).toBe(1);
    const analysis = JSON.parse(blocked.stdout) as Record<string, unknown>;
    expect(Object.keys(analysis).sort()).toEqual(["init", "plan", "problems", "recipeHash", "routing", "stats"]);
    expect(analysis).toEqual(JSON.parse(JSON.stringify(coreRead(vault, BUILT).analysis)));
  });

  test("a file that isn't valid: exit 2 with the file and the reason; --json gives the issues", async () => {
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{ not json");
    const human = await spawnCli(["check", bad]);
    expect(human.code).toBe(2);
    expect(human.stderr).toContain("bad.json: This file isn't valid JSON. Choose a .lattice.json or recipe.json file.");
    const json = await spawnCli(["check", bad, "--json"]);
    expect(json.code).toBe(2);
    expect(JSON.parse(json.stdout)).toEqual({
      error: {
        exit: 2,
        message: `${bad} can't be used: 1 problem in the file.`,
        issues: [{ path: "", message: "This file isn't valid JSON. Choose a .lattice.json or recipe.json file.", file: "bad.json" }],
      },
    });
  });

  test("a facet the catalog doesn't have: exit 2 naming the path", async () => {
    const recipe = JSON.parse(readFileSync(erc20, "utf8")) as { facets: string[] };
    recipe.facets.push("ERC20X");
    const file = join(dir, "unknown-facet.json");
    writeFileSync(file, JSON.stringify(recipe));
    const { code, stderr } = await runCli(["check", file]);
    expect(code).toBe(2);
    expect(stderr).toContain("unknown-facet.json: facets[4] ‘ERC20X’ isn't in Lattice dev-f4a32c8.");
  });

  test("a missing file, no file, too many files: exit 2", async () => {
    expect((await runCli(["check", join(dir, "nope.json")])).code).toBe(2);
    const none = await runCli(["check"]);
    expect(none.code).toBe(2);
    expect(none.stderr).toContain("check needs a recipe.json or .lattice.json file");
    expect((await runCli(["check", erc20, vault])).code).toBe(2);
  });

  test("a recipe pinned to a catalog the CLI doesn't have: exit 3; with --catalog: checked", async () => {
    const fixtureRecipe = writeRecipe(dir, template(FIXTURE, "ERC20"), FIXTURE, "fixture-erc20.json");
    const missing = await spawnCli(["check", fixtureRecipe]);
    expect(missing.code).toBe(3);
    expect(missing.stderr).toContain(`is pinned to catalog fixture (${FIXTURE.hash}), which this CLI doesn't have`);
    const found = await spawnCli(["check", fixtureRecipe, "--catalog", FIXTURE_CATALOGS, "--json"]);
    expect(found.code).toBe(0);
    expect(JSON.parse(found.stdout)).toEqual(JSON.parse(JSON.stringify(coreRead(fixtureRecipe, FIXTURE).analysis)));
    // One catalog folder works as well as a manifest's folder.
    const single = await runCli(["check", fixtureRecipe, "--catalog", join(FIXTURE_CATALOGS, "fixture")]);
    expect(single.code).toBe(0);
  });

  test("a catalog whose index doesn't hash to its own hash: exit 3", async () => {
    const tampered = join(tempDir(), "fixture");
    mkdirSync(tampered);
    const index = JSON.parse(readFileSync(join(FIXTURE_CATALOGS, "fixture", "index.json"), "utf8")) as { facets: { summary: string }[] };
    if (index.facets[0]) index.facets[0].summary = "Tampered.";
    writeFileSync(join(tampered, "index.json"), JSON.stringify(index));
    const { code, stderr } = await runCli(["check", erc20, "--catalog", tampered]);
    expect(code).toBe(3);
    expect(stderr).toContain(`says its hash is ${FIXTURE.hash}, but its contents hash to`);
  });

  test("a manifest entry whose hash isn't its index's: exit 3", async () => {
    const root = tempDir();
    mkdirSync(join(root, "fixture"));
    copyFileSync(join(FIXTURE_CATALOGS, "fixture", "index.json"), join(root, "fixture", "index.json"));
    const hash = `0x${"ab".repeat(32)}`;
    writeFileSync(
      join(root, "manifest.json"),
      JSON.stringify({ default: "fixture", catalogs: [{ id: "fixture", tag: "fixture", commit: FIXTURE.lattice.commit, hash, path: "fixture/index.json" }] }),
    );
    const { code, stderr } = await runCli(["check", erc20, "--catalog", root]);
    expect(code).toBe(3);
    expect(stderr).toContain(`manifest.json lists fixture with hash ${hash}`);
  });

  test("a folder that isn't a catalog: exit 2", async () => {
    const { code, stderr } = await runCli(["check", erc20, "--catalog", tempDir()]);
    expect(code).toBe(2);
    expect(stderr).toContain("has neither manifest.json nor index.json");
  });

  test("a project file: its predictions and deployments feed AUTH-02", async () => {
    const recipe = safeCut();
    const project = makeProject(recipe, {}, { predicted: [{ chainId: 11155111, address: SAFE }] });
    const file = writeProject(dir, project);
    const { code, stdout } = await runCli(["check", file, "--json"]);
    expect(code).toBe(1);
    const codes = (JSON.parse(stdout) as { problems: { code: string }[] }).problems.map((p) => p.code);
    expect(codes).toContain("AUTH-02");
  });
});

describe("LINK-01 and --confirm", () => {
  test("an authority address from the file blocks, and the hint shows it in full", async () => {
    const { code, stdout } = await spawnCli(["check", linked]);
    expect(code).toBe(1);
    expect(stdout).toContain(`  Blocker  LINK-01  The upgrade role goes to ${formatAddress(SAFE)}, which came from an opened file.`);
    expect(stdout).toContain(`Check the full address, then confirm it: --confirm 'steps[0].safe=${SAFE}'`);
  });

  test("--confirm with the full address clears it; the analysis equals core's with the path confirmed", async () => {
    const { code, stdout } = await spawnCli(["check", linked, "--confirm", `steps[0].safe=${SAFE.toLowerCase()}`, "--json"]);
    const { recipe } = coreRead(linked, BUILT);
    const expected = analyze(recipe, BUILT, { known: [], unconfirmed: [] });
    expect(JSON.parse(stdout)).toEqual(JSON.parse(JSON.stringify(expected)));
    expect(expected.problems.some((p) => p.code === "LINK-01")).toBe(false);
    expect(code).toBe(expected.problems.some((p) => p.severity === "blocker") ? 1 : 0);
  });

  test("a different address or a path with nothing to confirm: exit 2", async () => {
    const wrong = await runCli(["check", linked, "--confirm", `steps[0].safe=0x5afe00000000000000000000000000000000a11d`]);
    expect(wrong.code).toBe(2);
    expect(wrong.stderr).toContain(`steps[0].safe holds ${SAFE}, not 0x5afe00000000000000000000000000000000a11d.`);
    const nothing = await runCli(["check", linked, "--confirm", `steps[0].admin=${SAFE}`]);
    expect(nothing.code).toBe(2);
    expect(nothing.stderr).toContain("Nothing to confirm at steps[0].admin");
    const shape = await runCli(["check", linked, "--confirm", "steps[0].safe"]);
    expect(shape.code).toBe(2);
  });
});

describe("plan", () => {
  test("human: the cut plan rows, [00] ADD name, address, routed/total selectors, version", async () => {
    const { code, stdout } = await spawnCli(["plan", erc20]);
    expect(code).toBe(0);
    const { analysis } = coreRead(erc20, BUILT);
    const lines = stdout.split("\n");
    expect(lines[1]).toBe("Cut plan · 4 facets · 15 selectors");
    expect(lines[2]).toMatch(/^\[00\] ADD ERC20 0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4} · 9\/9 selectors · 0\.2\.0$/);
    expect(lines.filter((line) => line.startsWith("["))).toHaveLength(analysis.plan.length);
    expect(stdout).toContain("Init: calls MultiInit");
  });

  test("--json: the plan, what it leaves out, the init call, stats and problems; exit 1 on blockers", async () => {
    const { code, stdout } = await spawnCli(["plan", vault, "--json"]);
    expect(code).toBe(1);
    const { recipe, analysis } = coreRead(vault, BUILT);
    const { omitted } = buildPlan(recipe, BUILT, analysis.routing);
    expect(JSON.parse(stdout)).toEqual(
      JSON.parse(JSON.stringify({ recipeHash: analysis.recipeHash, plan: analysis.plan, omitted, init: analysis.init, stats: analysis.stats, problems: analysis.problems })),
    );
  });

  test("salt flags without --deployer and --chain do nothing, so they're refused", async () => {
    const { code, stderr } = await runCli(["plan", erc20, "--entropy", "0x0102030405060708090a0b"]);
    expect(code).toBe(2);
    expect(stderr).toContain("plan uses --path, --entropy, --scope, --project and --rpc only with --deployer and --chain.");
  });
});
