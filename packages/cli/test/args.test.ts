/** The command line itself: help, version, unknown commands and options, and the bundled catalog's identity. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCommandLine } from "../src/args";
import { BUNDLED_CATALOG_ID, bundledCatalogs } from "../src/catalogs";
import { STUDIO_VERSION } from "../src/version";
import { BUILT, BUILT_DEFAULT_ID, CLI_DIR, runCli, spawnCli } from "./support";

describe("help", () => {
  test("bun packages/cli/src/main.ts --help lists every command and exit code", async () => {
    const { code, stdout } = await spawnCli(["--help"]);
    expect(code).toBe(0);
    for (const command of ["check <file>", "plan <file>", "predict", "export foundry <file>", "export brief <file>", "export recipe <file>", "export safe <file>", "verify-catalog"]) {
      expect(stdout).toContain(`  ${command}`);
    }
    expect(stdout).toContain("Exit codes: 0 no blockers, 1 blockers, 2 invalid input, 3 catalog mismatch.");
  });

  test("a command's --help adds its examples; help and -h work too", async () => {
    const one = await runCli(["predict", "--help"]);
    expect(one.code).toBe(0);
    expect(one.stdout).toContain("Examples (predict):");
    expect((await runCli(["help"])).stdout).toContain("Usage: lattice-studio <command> [options]");
    expect((await runCli(["-h"])).code).toBe(0);
    expect((await runCli(["export", "--help"])).code).toBe(0);
  });

  test("--version prints the package version", async () => {
    const version = (JSON.parse(readFileSync(join(CLI_DIR, "package.json"), "utf8")) as { version: string }).version;
    expect(STUDIO_VERSION).toBe(version);
    expect((await runCli(["--version"])).stdout).toBe(`${version}\n`);
  });
});

describe("invalid input exits 2 with the usage", () => {
  test.each([
    [[], "Name a command"],
    [["deploy"], "deploy isn't a command."],
    [["export"], "export takes foundry, brief, recipe or safe."],
    [["export", "script"], "export takes foundry, brief, recipe or safe, not script."],
    [["check", "r.json", "--nope"], "Unknown option '--nope'."],
    [["check", "r.json", "--safe", "0x0"], "check doesn't take --safe."],
    [["check", "r.json", "--chain", "1", "--chain", "2"], "check takes one --chain."],
    [["check", "r.json", "--chain"], "Option '--chain <value>' argument missing"],
  ] as [string[], string][])("%p", async (argv, message) => {
    const { code, stderr } = await runCli(argv);
    expect(code).toBe(2);
    expect(stderr).toContain(message);
    expect(stderr).toContain("Usage: lattice-studio");
  });

  test.each([
    [["check", "r.json", "--nope", "--json"], "Unknown option '--nope'."],
    [["--json"], "Name a command: check, plan, predict, export or verify-catalog."],
    [["export", "script", "--json"], "export takes foundry, brief, recipe or safe, not script."],
  ] as [string[], string][])("with --json, %p is JSON on stdout", async (argv, message) => {
    const { code, stdout, stderr } = await runCli(argv);
    expect(code).toBe(2);
    expect(JSON.parse(stdout)).toEqual({ error: { exit: 2, message } });
    expect(stderr).toBe("");
  });

  test("spawned: an unknown command exits 2", async () => {
    const { code, stderr } = await spawnCli(["deploy"]);
    expect(code).toBe(2);
    expect(stderr).toContain("deploy isn't a command.");
  });

  test("the parser keeps positionals after the export kind", () => {
    const parsed = parseCommandLine(["export", "safe", "r.json", "--safe", "0xabc", "--chain", "1"]);
    expect(parsed.ok && parsed.value).toEqual({ command: "export safe", args: ["r.json"], values: { safe: "0xabc", chain: ["1"] } });
  });
});

describe("the bundled catalog", () => {
  test("is catalog/manifest.json's default, and validates with its own hash", () => {
    expect(BUNDLED_CATALOG_ID).toBe(BUILT_DEFAULT_ID);
    const bundled = bundledCatalogs();
    expect(bundled.ok && bundled.value.fallback.catalog.hash).toBe(BUILT.hash);
  });
});
