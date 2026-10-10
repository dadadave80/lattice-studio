/**
 * `predict` (spec L921): the address core predicts for the account, salt, chain and path; the salt from
 * `--project`, `--entropy`/`--scope`, or fresh entropy that's printed and reproduces the address when passed back.
 */
import { describe, expect, test } from "bun:test";
import { buildSalt, createxPredict, factoryPredict, type Hex, toChecksum } from "@lattice-studio/core";
import { ANVIL_0, BUILT, ENTROPY, makeProject, runCli, SAFE, spawnCli, tempDir, template, writeProject, writeRecipe } from "./support";

const factory = (from: string, entropy: Hex, scope: "every-chain" | "this-chain" = "every-chain") =>
  factoryPredict({ factory: toChecksum(BUILT.factory.address), proxyInitCodeHash: BUILT.proxy.initCodeHash, from: toChecksum(from), salt: buildSalt(toChecksum(from), scope, entropy) });

describe("predict", () => {
  test("--entropy and --scope: the factory path's address, as core predicts it", async () => {
    const { code, stdout } = await spawnCli(["predict", "--deployer", ANVIL_0, "--chain", "11155111", "--entropy", ENTROPY]);
    expect(code).toBe(0);
    const lines = stdout.split("\n");
    expect(lines[0]).toBe(factory(ANVIL_0, ENTROPY));
    expect(lines[1]).toBe(`Diamond address on Sepolia (11155111) through LatticeFactory, deployed by ${ANVIL_0}.`);
  });

  test("--json: the address, salt and where the entropy came from", async () => {
    const { code, stdout } = await spawnCli(["predict", "--deployer", SAFE, "--chain", "8453", "--path", "createx", "--entropy", ENTROPY, "--scope", "this-chain", "--json"]);
    expect(code).toBe(0);
    const salt = buildSalt(SAFE, "this-chain", ENTROPY);
    expect(JSON.parse(stdout)).toEqual({
      address: createxPredict({ from: SAFE, salt, chainId: 8453 }),
      chainId: 8453,
      chain: "Base",
      path: "createx",
      scope: "this-chain",
      entropy: ENTROPY,
      entropySource: "flags",
      from: SAFE,
      salt,
      catalog: "dev-6c8db45",
    });
  });

  test("no salt given: fresh entropy is drawn, printed, and gives the same address when passed back", async () => {
    const first = await runCli(["predict", "--deployer", ANVIL_0, "--chain", "11155111", "--json"]);
    expect(first.code).toBe(0);
    const drawn = JSON.parse(first.stdout) as { address: string; entropy: Hex; entropySource: string };
    expect(drawn.entropySource).toBe("fresh");
    expect(drawn.entropy).toBe(`0x${"42".repeat(11)}`);
    expect(first.stderr).toContain(`Drew new salt entropy ${drawn.entropy} (scope every-chain). Pass --entropy ${drawn.entropy} --scope every-chain to use it again.`);
    const again = await runCli(["predict", "--deployer", ANVIL_0, "--chain", "11155111", "--entropy", drawn.entropy, "--scope", "every-chain", "--json"]);
    expect((JSON.parse(again.stdout) as { address: string }).address).toBe(drawn.address);
  });

  test("--project: its entropy, scope and path", async () => {
    const dir = tempDir();
    const file = writeProject(dir, makeProject(template(BUILT, "ERC20"), { path: "createx", scope: "this-chain", entropy: "0x0b0a090807060504030201" }));
    const { code, stdout } = await runCli(["predict", "--deployer", ANVIL_0, "--chain", "10", "--project", file, "--json"]);
    expect(code).toBe(0);
    const salt = buildSalt(ANVIL_0, "this-chain", "0x0b0a090807060504030201");
    expect(JSON.parse(stdout)).toMatchObject({ address: createxPredict({ from: ANVIL_0, salt, chainId: 10 }), entropySource: "project", path: "createx" });
    // A recipe isn't a project file.
    const recipe = writeRecipe(dir, template(BUILT, "ERC20"), BUILT);
    const wrong = await runCli(["predict", "--deployer", ANVIL_0, "--chain", "10", "--project", recipe]);
    expect(wrong.code).toBe(2);
    expect(wrong.stderr).toContain("--project takes a .lattice.json project file");
    // The salt comes from one place.
    const both = await runCli(["predict", "--deployer", ANVIL_0, "--chain", "10", "--project", file, "--entropy", ENTROPY]);
    expect(both.code).toBe(2);
  });

  test.each([
    [["--chain", "1"], "--deployer needs an address."],
    [["--deployer", ANVIL_0], "--chain needs a chain id"],
    [["--deployer", "0x1234", "--chain", "1"], "--deployer 0x1234 isn't an address."],
    [["--deployer", "0xF39fd6e51aad88f6f4ce6ab8827279cfffb92266", "--chain", "1"], "its checksum doesn't match"],
    [["--deployer", ANVIL_0, "--chain", "0"], "--chain 0 isn't a chain id."],
    [["--deployer", ANVIL_0, "--chain", "1", "--path", "create2"], "--path is factory or createx, not create2."],
    [["--deployer", ANVIL_0, "--chain", "1", "--entropy", "0x01"], "--entropy 0x01 isn't 11 bytes of hex."],
    [["--deployer", ANVIL_0, "--chain", "1", "--scope", "everywhere"], "--scope is every-chain or this-chain, not everywhere."],
    [["recipe.json", "--deployer", ANVIL_0, "--chain", "1"], "predict takes no file."],
  ] as [string[], string][])("invalid: %p exits 2", async (argv, message) => {
    const { code, stderr } = await runCli(["predict", ...argv]);
    expect(code).toBe(2);
    expect(stderr).toContain(message);
  });

  test("--json failures are JSON on stdout", async () => {
    const { code, stdout } = await runCli(["predict", "--chain", "1", "--json"]);
    expect(code).toBe(2);
    expect(JSON.parse(stdout)).toEqual({ error: { exit: 2, message: "--deployer needs an address." } });
  });
});
