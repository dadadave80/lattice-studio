/**
 * The published shape: `bun run --cwd packages/cli build` bundles the workspace packages and the default catalog
 * into `dist/main.js` with one `#!/usr/bin/env node` line, and Node runs it from a directory outside the repo.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUILT, CLI_DIR, ENTROPY, SAFE, spawnCli, tempDir, template, writeRecipe } from "./support";

const DIST = join(CLI_DIR, "dist", "main.js");
const NODE = Bun.which("node");

describe.skipIf(NODE === null)("dist/main.js under Node", () => {
  let outside = "";
  let recipe = "";

  beforeAll(async () => {
    const build = Bun.spawnSync(["bun", "run", "build"], { cwd: CLI_DIR, stdout: "pipe", stderr: "pipe" });
    if (build.exitCode !== 0) throw new Error(`build failed: ${build.stderr.toString()}`);
    outside = tempDir("lattice-cli-outside-");
    recipe = writeRecipe(outside, template(BUILT, "ERC20"), BUILT);
    writeRecipe(outside, template(BUILT, "GovernedVault"), BUILT, "vault.json");
  }, 60_000);

  const node = (argv: string[]) => spawnCli(argv, { cwd: outside, cmd: [NODE ?? "node", DIST] });

  test("one shebang line, for node", () => {
    const lines = readFileSync(DIST, "utf8").split("\n", 3);
    expect(lines[0]).toBe("#!/usr/bin/env node");
    expect(lines[1]?.startsWith("#!")).toBe(false);
  });

  test("check <recipe> works from a temp directory outside the repo, with the bundled catalog", async () => {
    const ok = await node(["check", "recipe.json"]);
    expect(ok.code).toBe(0);
    expect(ok.stdout).toContain("ERC20 · recipe 0x");
    expect((await node(["check", "vault.json"])).code).toBe(1);
  });

  test("--help, predict, and a CreateX export with the bundled proxy code", async () => {
    expect((await node(["--help"])).stdout).toContain("verify-catalog");
    const predicted = await node(["predict", "--deployer", SAFE, "--chain", "11155111", "--entropy", ENTROPY]);
    expect(predicted.code).toBe(0);
    const script = await node(["export", "foundry", recipe, "--chain", "11155111", "--entropy", ENTROPY, "--path", "createx"]);
    expect(script.code).toBe(0);
    expect(script.stdout).toContain("// SPDX-License-Identifier: MIT");
  });

  test("verify-catalog under Node says it needs Bun (exit 2) instead of crashing", async () => {
    const { code, stderr } = await node(["verify-catalog", "--lattice", outside]);
    expect(code).toBe(2);
    expect(stderr).toContain("verify-catalog runs under Bun from a Lattice Studio checkout");
  });
});
