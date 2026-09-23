/**
 * `export foundry | brief | recipe | safe`: the bytes are core's exporters' bytes for the same inputs, to stdout
 * or `--out`; Foundry and Safe exports refuse on blockers with exit 1.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildSalt, exportBrief, exportFoundry, exportRecipeJson, exportSafeBatch, factoryPredict, type Project, toChecksum } from "@lattice-studio/core";
import { STUDIO_VERSION } from "../src/version";
import { BUILT, coreRead, ENTROPY, makeProject, REPO_ROOT, runCli, SAFE, spawnCli, tempDir, template, writeProject, writeRecipe } from "./support";

const dir = tempDir();
const erc20 = writeRecipe(dir, template(BUILT, "ERC20"), BUILT, "erc20.json");
const vault = writeRecipe(dir, template(BUILT, "GovernedVault"), BUILT, "vault.json");
const PROXY_CODE = readFileSync(join(REPO_ROOT, "catalog", "dev-f4a32c8", BUILT.proxy.creationCode.path), "utf8").trim() as `0x${string}`;

/** The project the CLI makes from a recipe and the command line's salt. */
function cliProject(path: Project["deploy"]["path"] = "factory"): Project {
  const { recipe } = coreRead(erc20, BUILT);
  return { id: "lattice-studio-cli", name: "ERC20", recipe, layout: {}, deploy: { path, entropy: ENTROPY, scope: "every-chain" }, provenance: {}, predicted: [] };
}

describe("export foundry", () => {
  test("stdout is exportFoundry's text, byte for byte", async () => {
    const { code, stdout } = await spawnCli(["export", "foundry", erc20, "--chain", "11155111", "--chain", "31337", "--entropy", ENTROPY]);
    expect(code).toBe(0);
    const { analysis } = coreRead(erc20, BUILT);
    const expected = exportFoundry({ project: cliProject(), catalog: BUILT, analysis, studioVersion: STUDIO_VERSION, chainIds: [31337, 11155111] });
    if (!expected.ok) throw new Error(expected.error);
    expect(stdout).toBe(expected.value.text);
  });

  test("the CreateX path embeds the bundled Lattice proxy code, as core does with the catalog's file", async () => {
    const { code, stdout } = await runCli(["export", "foundry", erc20, "--chain", "11155111", "--entropy", ENTROPY, "--path", "createx"]);
    expect(code).toBe(0);
    const { analysis } = coreRead(erc20, BUILT);
    const expected = exportFoundry({ project: cliProject("createx"), catalog: BUILT, analysis, studioVersion: STUDIO_VERSION, chainIds: [11155111], proxyCreationCode: PROXY_CODE });
    if (!expected.ok) throw new Error(expected.error);
    expect(stdout).toBe(expected.value.text);
  });

  test("a project file brings its own name and salt", async () => {
    const project = makeProject(coreRead(erc20, BUILT).recipe, { entropy: "0x0b0a090807060504030201" }, { name: "Grant token" });
    const file = writeProject(dir, project, [], "grant.lattice.json");
    const { code, stdout } = await runCli(["export", "foundry", file, "--chain", "11155111"]);
    expect(code).toBe(0);
    const expected = exportFoundry({ project, catalog: BUILT, analysis: coreRead(erc20, BUILT).analysis, studioVersion: STUDIO_VERSION, chainIds: [11155111] });
    if (!expected.ok) throw new Error(expected.error);
    expect(stdout).toBe(expected.value.text);
    expect(stdout).toContain("contract DeployGrantToken");
  });

  test("--out to a folder writes the script under its own name; --json reports it", async () => {
    const out = tempDir();
    const { code, stdout } = await runCli(["export", "foundry", erc20, "--chain", "11155111", "--entropy", ENTROPY, "--out", `${out}/`, "--json"]);
    expect(code).toBe(0);
    const report = JSON.parse(stdout) as { filename: string; path: string; bytes: number };
    expect(report.filename).toBe("DeployERC20.s.sol");
    expect(report.path).toBe(join(out, "DeployERC20.s.sol"));
    const text = readFileSync(report.path, "utf8");
    expect(report.bytes).toBe(new TextEncoder().encode(text).length);
    const human = await runCli(["export", "foundry", erc20, "--chain", "11155111", "--entropy", ENTROPY, "--out", join(out, "x.s.sol")]);
    expect(human.stdout).toBe(`Wrote ${join(out, "x.s.sol")} (${new Intl.NumberFormat("en-US").format(report.bytes)} bytes).\n`);
    expect(readFileSync(join(out, "x.s.sol"), "utf8")).toBe(text);
  });

  test("blockers: exit 1 and nothing written", async () => {
    const { code, stdout, stderr } = await spawnCli(["export", "foundry", vault, "--chain", "11155111", "--entropy", ENTROPY]);
    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("Resolve 1 blocker to export.\n  Blocker  INIT-01  Asset is required. Fill it in before deploying.");
    const json = await runCli(["export", "foundry", vault, "--chain", "11155111", "--entropy", ENTROPY, "--json"]);
    const error = (JSON.parse(json.stdout) as { error: { exit: number; problems: { code: string }[] } }).error;
    expect(error.exit).toBe(1);
    expect(error.problems.map((p) => p.code)).toEqual(["INIT-01"]);
  });

  test("no chain: exit 2 saying why (the catalog lists none)", async () => {
    const { code, stderr } = await runCli(["export", "foundry", erc20, "--entropy", ENTROPY]);
    expect(code).toBe(2);
    expect(stderr).toContain("export foundry needs --chain <id> (repeatable)");
  });

  test("fresh entropy is printed on stderr, never into the script's stdout", async () => {
    const { code, stdout, stderr } = await runCli(["export", "foundry", erc20, "--chain", "11155111"]);
    expect(code).toBe(0);
    expect(stderr).toContain(`Drew new salt entropy 0x${"42".repeat(11)}`);
    expect(stdout.startsWith("// SPDX-License-Identifier: MIT")).toBe(true);
  });
});

describe("export brief and recipe", () => {
  test("brief: exportBrief's text; exit 1 when the recipe has blockers, written anyway (Flow 11: always)", async () => {
    const ok = await spawnCli(["export", "brief", erc20]);
    expect(ok.code).toBe(0);
    const { recipe, analysis } = coreRead(erc20, BUILT);
    expect(ok.stdout).toBe(exportBrief({ recipe, catalog: BUILT, analysis, studioVersion: STUDIO_VERSION }).text);
    const blocked = await runCli(["export", "brief", vault]);
    expect(blocked.code).toBe(1);
    const v = coreRead(vault, BUILT);
    expect(blocked.stdout).toBe(exportBrief({ recipe: v.recipe, catalog: BUILT, analysis: v.analysis, studioVersion: STUDIO_VERSION }).text);
    expect(blocked.stderr).toContain("The recipe has 1 blocker; run lattice-studio check to see them.");
  });

  test("recipe: exportRecipeJson's text; --json gives the ExportFile", async () => {
    const { code, stdout } = await runCli(["export", "recipe", erc20, "--json"]);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual(exportRecipeJson(coreRead(erc20, BUILT).recipe, BUILT));
  });
});

describe("export safe", () => {
  const NOW = 1_790_000_000_000;

  test("the batch is exportSafeBatch's text for the Safe, chain, salt and time", async () => {
    const { code, stdout } = await runCli(["export", "safe", erc20, "--safe", SAFE, "--chain", "11155111", "--entropy", ENTROPY, "--json"], { now: () => NOW });
    expect(code).toBe(0);
    const expected = exportSafeBatch({
      recipe: coreRead(erc20, BUILT).recipe,
      catalog: BUILT,
      safe: SAFE,
      chainId: 11155111,
      entropy: ENTROPY,
      scope: "every-chain",
      path: "factory",
      now: NOW,
      studioVersion: STUDIO_VERSION,
      context: { known: [], unconfirmed: [] },
    });
    if (!expected.ok) throw new Error(expected.error);
    const address = factoryPredict({ factory: toChecksum(BUILT.factory.address), proxyInitCodeHash: BUILT.proxy.initCodeHash, from: SAFE, salt: buildSalt(SAFE, "every-chain", ENTROPY) });
    expect(JSON.parse(stdout)).toEqual({ ...expected.value, address, salt: buildSalt(SAFE, "every-chain", ENTROPY) });
  });

  test("spawned: stdout is the batch, byte for byte, at the time it names", async () => {
    const { code, stdout } = await spawnCli(["export", "safe", erc20, "--safe", SAFE, "--chain", "11155111", "--entropy", ENTROPY, "--path", "createx"]);
    expect(code).toBe(0);
    const createdAt = (JSON.parse(stdout) as { createdAt: number }).createdAt;
    const expected = exportSafeBatch({
      recipe: coreRead(erc20, BUILT).recipe,
      catalog: BUILT,
      safe: SAFE,
      chainId: 11155111,
      entropy: ENTROPY,
      scope: "every-chain",
      path: "createx",
      now: createdAt,
      studioVersion: STUDIO_VERSION,
      context: { known: [], unconfirmed: [] },
      proxyCreationCode: PROXY_CODE,
    });
    if (!expected.ok) throw new Error(expected.error);
    expect(stdout).toBe(expected.value.text);
  });

  test("needs --safe and --chain; refuses blockers with exit 1", async () => {
    expect((await runCli(["export", "safe", erc20, "--chain", "1", "--entropy", ENTROPY])).stderr).toContain("--safe needs an address.");
    expect((await runCli(["export", "safe", erc20, "--safe", SAFE, "--entropy", ENTROPY])).code).toBe(2);
    const blocked = await runCli(["export", "safe", vault, "--safe", SAFE, "--chain", "1", "--entropy", ENTROPY]);
    expect(blocked.code).toBe(1);
    expect(blocked.stdout).toBe("");
  });
});
