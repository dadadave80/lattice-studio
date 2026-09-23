import { describe, expect, test } from "bun:test";
import { encodeFunctionData, parseAbi, toFunctionSelector } from "viem";
import { API_OWNERS } from "../../model/api";
import type { Catalog, InitSpec } from "../../model/catalog";
import type { Address } from "../../model/hex";
import type { InitPlan, InitStepView } from "../../model/init";
import type { Arg } from "../../model/recipe";
import { addr, loadFixtureCatalog, makeCatalog, makeInit, makeShared } from "../../testing";
import * as mod from "./index";
import { decodeInit, encodeInit, UNSUPPORTED_IN_V1 } from "./index";

const fixture = loadFixtureCatalog();
const catalog = (): Catalog => {
  if (!fixture.ok) throw new Error(fixture.error);
  return fixture.value;
};
const spec = (name: string): InitSpec => {
  const found = catalog().inits.find((s) => s.name === name);
  if (!found) throw new Error(`fixture has no ${name}`);
  return found;
};
const address = (name: string) => spec(name).release?.address ?? "0x";

/** A plan step as C4a's planInit shapes it (C4a isn't built yet, so tests build plans by hand). */
function stepView(s: InitSpec, path: string, index: number, args: Record<string, Arg>): InitStepView {
  const auto = s.name.startsWith("DiamondIntrospectionInit.") ? (s.name.split(".")[1] as "initUpgradeable" | "initImmutable") : undefined;
  return {
    path, index, spec: s.name, contract: s.contract, fn: s.fn, locked: auto !== undefined, args, fields: [], missing: [], examples: [],
    ...(auto === undefined ? {} : { automatic: auto }),
  };
}

const ASSET: Address = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
const SAFE: Address = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";
const DEPLOYER: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const DIAMOND: Address = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const ZERO: Address = "0x0000000000000000000000000000000000000000";

const multiInit = parseAbi(["function multiInit(address[] _initAddresses, bytes[] _initData)"]);

describe.skipIf(!fixture.ok)("selectors at the pin", () => {
  test("the brief's selectors equal the fixture's functions", () => {
    expect(toFunctionSelector("function multiInit(address[],bytes[])")).toBe("0x6e02fa3c");
    expect(toFunctionSelector(`function ${spec("MultiInit").fn}`)).toBe("0x6e02fa3c");
    expect(toFunctionSelector(`function ${spec("DiamondIntrospectionInit.initUpgradeable").fn}`)).toBe("0xfdff4c12");
    expect(toFunctionSelector(`function ${spec("DiamondIntrospectionInit.initImmutable").fn}`)).toBe("0xd1a4dbd8");
    expect(toFunctionSelector(`function ${spec("GovernedVaultInit").fn}`)).toBe("0x7ee12e1b");
    expect(toFunctionSelector("function initialize((address,uint8,bytes4[])[],address,bytes)")).toBe("0x341bedc6");
  });

  test("GovernedVaultInit's struct shows as nine named components", () => {
    expect(spec("GovernedVaultInit").params[0]?.components?.map((c) => c.name)).toEqual([
      "asset", "name", "symbol", "decimalsOffset", "minDelay", "votingDelay", "votingPeriod", "proposalThreshold", "quorumNumerator",
    ]);
  });
});

describe("module", () => {
  test("exports the four C4b functions", () => {
    for (const name of ["resolveRefs", "collectRefs", "encodeInit", "decodeInit"] as const) {
      expect(typeof (mod as Record<string, unknown>)[name]).toBe("function");
      expect(API_OWNERS[name]).toBe("C4b");
    }
  });
});

describe.skipIf(!fixture.ok)("encodeInit", () => {
  const vault: Record<string, Arg> = {
    p: {
      asset: ASSET, name: "Grant vault", symbol: "gVLT", decimalsOffset: "0", minDelay: "300", votingDelay: "60",
      votingPeriod: "600", proposalThreshold: "0", quorumNumerator: "4",
    },
  };

  test("none is the zero target with empty data", () => {
    expect(encodeInit({ kind: "none", steps: [] }, catalog(), {})).toEqual({ ok: true, value: { target: ZERO, data: "0x" } });
  });

  test("a bundle calls its contract, the p.* fields wrapped into its one struct", () => {
    const plan: InitPlan = { kind: "bundle", steps: [stepView(spec("GovernedVaultInit"), "bundle", 0, vault)] };
    const expected = encodeFunctionData({
      abi: parseAbi([
        "struct P { address asset; string name; string symbol; uint8 decimalsOffset; uint256 minDelay; uint48 votingDelay; uint32 votingPeriod; uint256 proposalThreshold; uint256 quorumNumerator; }",
        "function init(P p)",
      ]),
      functionName: "init",
      args: [{ asset: ASSET, name: "Grant vault", symbol: "gVLT", decimalsOffset: 0, minDelay: 300n, votingDelay: 60, votingPeriod: 600, proposalThreshold: 0n, quorumNumerator: 4n }],
    });
    expect(encodeInit(plan, catalog(), {})).toEqual({ ok: true, value: { target: address("GovernedVaultInit"), data: expected } });
  });

  test("ERC20 equals DeployERC20: MultiInit([ERC20Init, DiamondIntrospectionInit.initImmutable])", () => {
    const plan: InitPlan = {
      kind: "steps",
      steps: [
        stepView(spec("ERC20Init"), "steps[0]", 0, { name_: "Example Token", symbol_: "EXT" }),
        stepView(spec("DiamondIntrospectionInit.initImmutable"), "auto", 1, {}),
      ],
    };
    // DeployERC20.buildCuts → BaseDeploy._withIntrospection(ERC20Init, abi.encodeCall(ERC20Init.init, (name_, symbol_)), false)
    const erc20 = encodeFunctionData({ abi: parseAbi(["function init(string,string)"]), args: ["Example Token", "EXT"] });
    const immutable = encodeFunctionData({ abi: parseAbi(["function initImmutable()"]) });
    expect(immutable).toBe("0xd1a4dbd8");
    const data = encodeFunctionData({
      abi: multiInit,
      args: [[address("ERC20Init"), address("DiamondIntrospectionInit.initImmutable")], [erc20, immutable]],
    });
    expect(encodeInit(plan, catalog(), {})).toEqual({ ok: true, value: { target: address("MultiInit"), data } });
  });

  test("steps run in plan index order, each resolving its own references", () => {
    const plan: InitPlan = {
      kind: "steps",
      steps: [
        stepView(spec("DiamondIntrospectionInit.initUpgradeable"), "auto", 2, {}),
        stepView(spec("AccessControlInit"), "steps[0]", 0, { admin: { $ref: "deployer" } }),
        stepView(spec("SafeDiamondCutInit"), "steps[1]", 1, { admin: { $ref: "self" }, safe: SAFE, minThreshold: "2" }),
      ],
    };
    const result = encodeInit(plan, catalog(), { self: DIAMOND, deployer: DEPLOYER });
    const data = encodeFunctionData({
      abi: multiInit,
      args: [
        [address("AccessControlInit"), address("SafeDiamondCutInit"), address("DiamondIntrospectionInit.initUpgradeable")],
        [
          encodeFunctionData({ abi: parseAbi(["function init(address)"]), args: [DEPLOYER] }),
          encodeFunctionData({ abi: parseAbi(["function init(address,address,uint256)"]), args: [DIAMOND, SAFE, 2n] }),
          "0xfdff4c12",
        ],
      ],
    });
    expect(result).toEqual({ ok: true, value: { target: address("MultiInit"), data } });
  });

  test("the automatic step resolves by contract and entry point when its spec names the contract", () => {
    const auto = { ...stepView(spec("DiamondIntrospectionInit.initImmutable"), "auto", 0, {}), spec: "DiamondIntrospectionInit" };
    const result = encodeInit({ kind: "steps", steps: [auto] }, catalog(), {});
    expect(result.ok && decodeInit(result.value.data, catalog())).toEqual({
      ok: true,
      value: { kind: "steps", steps: [{ target: address("DiamondIntrospectionInit.initImmutable"), spec: "DiamondIntrospectionInit.initImmutable", fn: "initImmutable()", args: {}, fromRef: {} }] },
    });
  });

  test("the fixture templates' own args fail on what they leave for the person to fill", () => {
    const template = catalog().recipes.find((r) => r.name === "GovernedVault")?.recipe.init;
    if (template?.kind !== "bundle") throw new Error("fixture GovernedVault isn't a bundle");
    const vaultPlan: InitPlan = { kind: "bundle", steps: [stepView(spec("GovernedVaultInit"), "bundle", 0, template.args)] };
    expect(encodeInit(vaultPlan, catalog(), {})).toEqual({ ok: false, error: "bundle.p.asset is missing." });
    const safePlan: InitPlan = {
      kind: "steps",
      steps: [stepView(spec("SafeDiamondCutInit"), "steps[0]", 0, { admin: { $ref: "deployer" }, minThreshold: "2" })],
    };
    expect(encodeInit(safePlan, catalog(), { deployer: DEPLOYER })).toEqual({ ok: false, error: "steps[0].safe is missing." });
  });

  test("an unresolved reference is an error, never a symbolic value in calldata", () => {
    const plan: InitPlan = { kind: "steps", steps: [stepView(spec("AccessControlInit"), "steps[0]", 0, { admin: { $ref: "self" } })] };
    expect(encodeInit(plan, catalog(), { deployer: DEPLOYER })).toEqual({
      ok: false, error: "steps[0].admin is This diamond, whose address isn't known yet.",
    });
  });

  test("inits with constructor arguments are unsupported in v1", () => {
    const plan: InitPlan = { kind: "steps", steps: [stepView(spec("AccountInit"), "steps[0]", 0, { owner: DEPLOYER })] };
    const result = encodeInit(plan, catalog(), {});
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.startsWith(`${UNSUPPORTED_IN_V1}: AccountInit`)).toBe(true);
  });

  test("argument errors name the path", () => {
    const run = (p: Record<string, Arg>) =>
      encodeInit({ kind: "bundle", steps: [stepView(spec("GovernedVaultInit"), "bundle", 0, { p })] }, catalog(), {});
    const base = vault.p as Record<string, Arg>;
    expect(run({ ...base, decimalsOffset: "256" })).toEqual({ ok: false, error: "bundle.p.decimalsOffset is 256, outside uint8's range 0 to 255." });
    expect(run({ ...base, minDelay: "1e3" })).toEqual({ ok: false, error: 'bundle.p.minDelay must be a whole number written in decimal; it is "1e3".' });
    expect(run({ ...base, minDelay: "-1" })).toEqual({ ok: false, error: "bundle.p.minDelay is -1, outside uint256's range 0 to 115792089237316195423570985008687907853269984665640564039457584007913129639935." });
    expect(run({ ...base, asset: "0xnope" })).toEqual({ ok: false, error: 'bundle.p.asset must be an address; it is "0xnope".' });
    expect(run({ ...base, extra: "1" })).toEqual({ ok: false, error: "bundle.p.extra isn't a field of bundle.p." });
    const step = encodeInit({ kind: "steps", steps: [stepView(spec("ERC20Init"), "steps[0]", 0, { name_: "A", symbol_: "B", decimals: "18" })] }, catalog(), {});
    expect(step).toEqual({ ok: false, error: "steps[0].decimals isn't a parameter of ERC20Init.init(string,string)." });
  });

  test("addresses are accepted in lowercase and encoded checksummed", () => {
    const plan = (admin: string): InitPlan => ({ kind: "steps", steps: [stepView(spec("AccessControlInit"), "steps[0]", 0, { admin })] });
    expect(encodeInit(plan(DEPLOYER.toLowerCase()), catalog(), {})).toEqual(encodeInit(plan(DEPLOYER), catalog(), {}));
  });

  test("a bundle plan must be exactly one call", () => {
    expect(encodeInit({ kind: "bundle", steps: [] }, catalog(), {})).toEqual({ ok: false, error: "A bundle init is one call; this plan has 0." });
  });

  test("steps with no calls are the zero target, like none", () => {
    expect(encodeInit({ kind: "steps", steps: [] }, catalog(), {})).toEqual({ ok: true, value: { target: ZERO, data: "0x" } });
  });

  test("an unknown spec is an error", () => {
    const ghost = { ...stepView(spec("ERC20Init"), "steps[0]", 0, {}), spec: "GhostInit" };
    expect(encodeInit({ kind: "steps", steps: [ghost] }, catalog(), {})).toEqual({ ok: false, error: "steps[0] runs GhostInit, which this catalog doesn't have." });
  });
});

describe("never a zero address inside MultiInit", () => {
  const zeroed = makeInit({ name: "ZeroInit", release: { ...makeShared("ZeroInit"), address: ZERO } });
  const multi = makeInit({
    name: "MultiInit", fn: "multiInit(address[],bytes[])",
    params: [{ name: "_initAddresses", type: "address[]", doc: "" }, { name: "_initData", type: "bytes[]", doc: "" }],
  });
  const later = makeInit({ name: "LaterInit" });

  test("a step whose init has the zero address fails instead of silently skipping later steps", () => {
    const test = makeCatalog({ inits: [multi, zeroed, later] });
    const plan: InitPlan = { kind: "steps", steps: [stepView(zeroed, "steps[0]", 0, {}), stepView(later, "steps[1]", 1, {})] };
    expect(encodeInit(plan, test, {})).toEqual({ ok: false, error: "ZeroInit (steps[0]) has the zero address, which would end MultiInit before it runs." });
  });

  test("a zero MultiInit address fails too", () => {
    const test = makeCatalog({ inits: [{ ...multi, release: { ...makeShared("MultiInit"), address: ZERO } }, later] });
    const plan: InitPlan = { kind: "steps", steps: [stepView(later, "steps[0]", 0, {})] };
    expect(encodeInit(plan, test, {}).ok).toBe(false);
  });

  test("a catalog without MultiInit can't run steps", () => {
    const plan: InitPlan = { kind: "steps", steps: [stepView(later, "steps[0]", 0, {})] };
    expect(encodeInit(plan, makeCatalog({ inits: [later] }), {})).toEqual({ ok: false, error: "This catalog has no MultiInit to run init steps through." });
  });

  test("a zero reference address is refused", () => {
    const admin = makeInit({ name: "AdminInit", fn: "init(address)", params: [{ name: "admin", type: "address", doc: "" }] });
    const plan: InitPlan = { kind: "steps", steps: [stepView(admin, "steps[0]", 0, { admin: { $ref: "deployer" } })] };
    const result = encodeInit(plan, makeCatalog({ inits: [multi, admin] }), { deployer: ZERO });
    expect(result).toEqual({ ok: false, error: "Deploying account can't be the zero address." });
  });

  test("a spec whose fn disagrees with its params is refused", () => {
    const wrong = makeInit({ name: "WrongInit", fn: "init(uint256)", params: [{ name: "admin", type: "address", doc: "" }] });
    const plan: InitPlan = { kind: "steps", steps: [stepView(wrong, "steps[0]", 0, { admin: addr(1) })] };
    expect(encodeInit(plan, makeCatalog({ inits: [multi, wrong] }), {})).toEqual({
      ok: false, error: "WrongInit declares init(uint256), but its parameters encode as a different function.",
    });
  });
});

describe.skipIf(!fixture.ok)("decodeInit", () => {
  test("0x is none", () => {
    expect(decodeInit("0x", catalog())).toEqual({ ok: true, value: { kind: "none", steps: [] } });
  });

  test("steps keep their targets and mark values that came from references", () => {
    const plan: InitPlan = {
      kind: "steps",
      steps: [
        stepView(spec("AccessControlInit"), "steps[0]", 0, { admin: { $ref: "deployer" } }),
        stepView(spec("OwnableInit"), "steps[1]", 1, { _owner: { $ref: "self" } }),
        stepView(spec("DiamondIntrospectionInit.initUpgradeable"), "auto", 2, {}),
      ],
    };
    const refs = { self: DIAMOND, deployer: DEPLOYER };
    const encoded = encodeInit(plan, catalog(), refs);
    if (!encoded.ok) throw new Error(encoded.error);
    expect(decodeInit(encoded.value.data, catalog(), refs)).toEqual({
      ok: true,
      value: {
        kind: "steps",
        steps: [
          { target: address("AccessControlInit"), spec: "AccessControlInit", fn: "init(address)", args: { admin: DEPLOYER }, fromRef: { admin: "deployer" } },
          { target: address("OwnableInit"), spec: "OwnableInit", fn: "init(address)", args: { _owner: DIAMOND }, fromRef: { _owner: "self" } },
          { target: address("DiamondIntrospectionInit.initUpgradeable"), spec: "DiamondIntrospectionInit.initUpgradeable", fn: "initUpgradeable()", args: {}, fromRef: {} },
        ],
      },
    });
    // Without refs nothing is marked.
    const bare = decodeInit(encoded.value.data, catalog());
    expect(bare.ok && bare.value.steps.map((s) => s.fromRef)).toEqual([{}, {}, {}]);
  });

  test("a bundle decodes its struct with dotted reference paths and no target", () => {
    const p = {
      asset: DIAMOND, name: "Grant vault", symbol: "gVLT", decimalsOffset: "0", minDelay: "300", votingDelay: "60",
      votingPeriod: "600", proposalThreshold: "0", quorumNumerator: "4",
    };
    const encoded = encodeInit({ kind: "bundle", steps: [stepView(spec("GovernedVaultInit"), "bundle", 0, { p: { ...p, asset: { $ref: "self" } } })] }, catalog(), { self: DIAMOND });
    if (!encoded.ok) throw new Error(encoded.error);
    expect(decodeInit(encoded.value.data, catalog(), { self: DIAMOND })).toEqual({
      ok: true,
      value: { kind: "bundle", steps: [{ spec: "GovernedVaultInit", fn: spec("GovernedVaultInit").fn, args: { p }, fromRef: { "p.asset": "self" } }] },
    });
  });

  test("an unknown MultiInit step keeps its target and selector", () => {
    const data = encodeFunctionData({ abi: multiInit, args: [[addr(7)], ["0x12345678aa"]] });
    expect(decodeInit(data, catalog())).toEqual({ ok: true, value: { kind: "steps", steps: [{ target: addr(7), fn: "0x12345678", args: {}, fromRef: {} }] } });
  });

  test("malformed data is an error, not a throw", () => {
    expect(decodeInit("0x12", catalog())).toEqual({ ok: false, error: "Init data is shorter than a function selector." });
    expect(decodeInit("0xdeadbeef", catalog())).toEqual({ ok: false, error: "Init data calls 0xdeadbeef, which matches no bundle init in this catalog." });
    expect(decodeInit("0x6e02fa3c00", catalog()).ok).toBe(false);
    expect(decodeInit("0xzz" as `0x${string}`, catalog())).toEqual({ ok: false, error: "Init data isn't hex bytes." });
  });
});
