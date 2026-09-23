/** One vector per v1 recipe against Foundry's `cast calldata`; skipped where cast isn't installed. */
import { describe, expect, test } from "bun:test";
import type { InitSpec } from "../../model/catalog";
import type { Address } from "../../model/hex";
import type { InitPlan, InitStepView } from "../../model/init";
import type { Arg } from "../../model/recipe";
import { loadFixtureCatalog } from "../../testing";
import { encodeInit } from "./index";

const CAST = Bun.which("cast");
const fixture = loadFixtureCatalog();

function cast(...args: string[]): string {
  const run = Bun.spawnSync([CAST ?? "cast", ...args], { stdout: "pipe", stderr: "pipe" });
  if (run.exitCode !== 0) throw new Error(`cast ${args.join(" ")}: ${run.stderr.toString()}`);
  return run.stdout.toString().trim();
}

const ASSET = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
const SAFE = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";
const DEPLOYER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

describe.skipIf(CAST === null || !fixture.ok)("cast calldata", () => {
  const catalog = () => {
    if (!fixture.ok) throw new Error(fixture.error);
    return fixture.value;
  };
  const spec = (name: string): InitSpec => {
    const found = catalog().inits.find((s) => s.name === name);
    if (!found?.release) throw new Error(`fixture has no released ${name}`);
    return found;
  };
  const at = (name: string): Address => spec(name).release?.address ?? "0x";
  const view = (s: InitSpec, path: string, index: number, args: Record<string, Arg>): InitStepView => ({
    path, index, spec: s.name, contract: s.contract, fn: s.fn, locked: false, args, fields: [], missing: [], examples: [],
  });
  const templates = () => new Set(catalog().recipes.filter((r) => r.phase === "v1").map((r) => r.name));

  test("the v1 recipes are the three these vectors cover", () => {
    expect(templates()).toEqual(new Set(["GovernedVault", "ERC20", "SafeDiamondCut"]));
  });

  test("selectors", () => {
    expect(cast("sig", "multiInit(address[],bytes[])")).toBe("0x6e02fa3c");
    expect(cast("sig", "initUpgradeable()")).toBe("0xfdff4c12");
    expect(cast("sig", "initImmutable()")).toBe("0xd1a4dbd8");
    expect(cast("sig", spec("GovernedVaultInit").fn)).toBe("0x7ee12e1b");
    expect(cast("sig", "initialize((address,uint8,bytes4[])[],address,bytes)")).toBe("0x341bedc6");
  });

  test("GovernedVault: the bundle's one struct", () => {
    const args = {
      p: {
        asset: ASSET, name: "Grant vault", symbol: "gVLT", decimalsOffset: "0", minDelay: "300", votingDelay: "60",
        votingPeriod: "600", proposalThreshold: "0", quorumNumerator: "4",
      },
    };
    const result = encodeInit({ kind: "bundle", steps: [view(spec("GovernedVaultInit"), "bundle", 0, args)] }, catalog(), {});
    const expected = cast("calldata", spec("GovernedVaultInit").fn, `(${ASSET},Grant vault,gVLT,0,300,60,600,0,4)`);
    expect(result).toEqual({ ok: true, value: { target: at("GovernedVaultInit"), data: expected as `0x${string}` } });
  });

  test("ERC20: MultiInit([ERC20Init, DiamondIntrospectionInit.initImmutable])", () => {
    const plan: InitPlan = {
      kind: "steps",
      steps: [
        view(spec("ERC20Init"), "steps[0]", 0, { name_: "Example Token", symbol_: "EXT" }),
        { ...view(spec("DiamondIntrospectionInit.initImmutable"), "auto", 1, {}), automatic: "initImmutable", locked: true },
      ],
    };
    const erc20 = cast("calldata", "init(string,string)", "Example Token", "EXT");
    const immutable = cast("calldata", "initImmutable()");
    const expected = cast(
      "calldata", "multiInit(address[],bytes[])",
      `[${at("ERC20Init")},${at("DiamondIntrospectionInit.initImmutable")}]`, `[${erc20},${immutable}]`,
    );
    expect(encodeInit(plan, catalog(), {})).toEqual({ ok: true, value: { target: at("MultiInit"), data: expected as `0x${string}` } });
  });

  test("SafeDiamondCut: one step, which registers the interfaces itself (no automatic step)", () => {
    const plan: InitPlan = {
      kind: "steps",
      steps: [view(spec("SafeDiamondCutInit"), "steps[0]", 0, { admin: { $ref: "deployer" }, safe: SAFE, minThreshold: "2" })],
    };
    expect(spec("SafeDiamondCutInit").registersInterfaces).toBe(true);
    const inner = cast("calldata", "init(address,address,uint256)", DEPLOYER, SAFE, "2");
    const expected = cast("calldata", "multiInit(address[],bytes[])", `[${at("SafeDiamondCutInit")}]`, `[${inner}]`);
    expect(encodeInit(plan, catalog(), { deployer: DEPLOYER })).toEqual({
      ok: true, value: { target: at("MultiInit"), data: expected as `0x${string}` },
    });
  });
});
