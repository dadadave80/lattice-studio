import { describe, expect, test } from "bun:test";
import { encodeErrorResult, encodeFunctionData, keccak256, parseAbi, stringToHex, type Abi } from "viem";
import { CREATEX } from "../address/diamond";
import type { AbiItem, Catalog, FacetDetail } from "../model/catalog";
import type { RevertContext } from "../model/chain";
import type { Hex } from "../model/hex";
import type { DecodedInit } from "../model/init";
import { makeCatalog, makeFacet, makeInit } from "../testing/builders";
import { loadFixtureCatalog } from "../testing/fixtures";
import { addr } from "../testing/ids";
import { unpackVersion } from "./args";
import { decodeRevert } from "./index";

// Revert fixtures are built with viem's encodeErrorResult against hand-written ABIs (K3's fixture shards hold
// functions only); Q5 later replays real reverts from Anvil.

function detail(name: string, signatures: readonly string[]): FacetDetail {
  return { name, abi: parseAbi(signatures) as unknown as AbiItem[], natspec: { functions: {} }, source: { path: `src/${name}.sol`, url: "" } };
}

function encode(signature: string, args: readonly unknown[] = []): Hex {
  const abi = parseAbi([`error ${signature}`]) as Abi;
  const [item] = abi;
  if (!item || item.type !== "error") throw new Error(signature);
  return encodeErrorResult({ abi, errorName: item.name, args: args as never });
}

const REGISTRY_DETAIL = detail("LatticeRegistry", [
  "error LatticeRegistry__RecordNotFound(bytes32 nameHash, uint64 version)",
  "error LatticeRegistry__Unauthorized(address caller)",
]);
const ACCESS = "error AccessControlUnauthorizedAccount(address account, bytes32 neededRole)";
const ERC20_ERROR = "error ERC20InvalidReceiver(address receiver)";

const erc20Init = makeInit({ name: "ERC20Init", fn: "init(string,string)", initializes: [{ module: "ERC20" }] });
const accessInit = makeInit({ name: "AccessControlInit", fn: "init(address)", initializes: [{ module: "AccessControl" }] });
const vaultInit = makeInit({
  name: "VaultCoreInit",
  fn: "init(address,string,string,address,uint8)",
  initializes: [{ module: "AccessControl" }, { module: "ERC20" }, { module: "ERC4626" }, { module: "VaultCore" }],
});
const multiInit = makeInit({ name: "MultiInit", fn: "multiInit(address[],bytes[])" });
const introspection = makeInit({ name: "DiamondIntrospectionInit.initImmutable", contract: "DiamondIntrospectionInit", fn: "initImmutable()" });

const catalog: Catalog = makeCatalog({
  facets: [
    makeFacet({ name: "AccessControl" }),
    makeFacet({ name: "ERC20" }),
    makeFacet({ name: "ERC4626" }),
    makeFacet({ name: "VaultCore" }),
  ],
  inits: [multiInit, introspection, erc20Init, accessInit, vaultInit],
});

const details: Record<string, FacetDetail> = {
  LatticeRegistry: REGISTRY_DETAIL,
  AccessControl: detail("AccessControl", [ACCESS]),
  VaultCore: detail("VaultCore", [ACCESS, "error VaultCore__ZeroAssets()"]),
  ERC20: detail("ERC20", [ERC20_ERROR]),
  ERC20Init: detail("ERC20Init", [ERC20_ERROR]),
  AccessControlInit: detail("AccessControlInit", [ACCESS]),
};

const context: RevertContext = { details };

function packVersion(version: string): bigint {
  const [major = 0n, minor = 0n, patch = 0n] = version.split(".").map(BigInt);
  return (major << 48n) | (minor << 24n) | patch;
}

const nameHash = (name: string): Hex => keccak256(stringToHex(`lattice.${name}`));

describe("module errors", () => {
  test("LatticeRegistry__RecordNotFound reads the name hash as a name and the packed version as 0.4.0 (spec L727)", () => {
    const data = encode("LatticeRegistry__RecordNotFound(bytes32 nameHash, uint64 version)", [nameHash("ERC20"), packVersion("0.4.0")]);
    const decoded = decodeRevert(data, catalog, context);
    expect(decoded).toEqual({
      module: "LatticeRegistry",
      shared: [],
      error: "LatticeRegistry__RecordNotFound",
      signature: "LatticeRegistry__RecordNotFound(bytes32,uint64)",
      args: [
        { name: "nameHash", type: "bytes32", value: "lattice.ERC20" },
        { name: "version", type: "uint64", value: "0.4.0" },
      ],
      wrappers: [],
      raw: data,
    });
  });

  test("a name hash the catalog doesn't know stays hex; addresses come back checksummed", () => {
    const unknown = nameHash("NotInTheCatalog");
    const decoded = decodeRevert(encode("LatticeRegistry__RecordNotFound(bytes32 nameHash, uint64 version)", [unknown, 0n]), catalog, context);
    expect(decoded.args.map((arg) => arg.value)).toEqual([unknown, "0"]);
    const caller = addr(0xabcdef);
    const unauthorized = decodeRevert(encode("LatticeRegistry__Unauthorized(address caller)", [caller.toLowerCase()]), catalog, context);
    expect(unauthorized.args).toEqual([{ name: "caller", type: "address", value: caller }]);
  });

  test("the zero role reads as DEFAULT_ADMIN_ROLE", () => {
    const account = addr(7);
    const decoded = decodeRevert(encode("AccessControlUnauthorizedAccount(address account, bytes32 neededRole)", [account, `0x${"0".repeat(64)}`]), catalog, {
      details,
      placed: ["AccessControl"],
    });
    expect(decoded.module).toBe("AccessControl");
    expect(decoded.args[1]).toEqual({ name: "neededRole", type: "bytes32", value: "DEFAULT_ADMIN_ROLE" });
  });

  test("the decoder uses the catalog index's name hashes (fixture catalog)", () => {
    const fixture = loadFixtureCatalog();
    if (!fixture.ok) throw new Error(fixture.error);
    const decoded = decodeRevert(
      encode("LatticeRegistry__RecordNotFound(bytes32 nameHash, uint64 version)", [nameHash("GovernedVault"), packVersion("0.2.0")]),
      fixture.value,
      { details: { LatticeRegistry: REGISTRY_DETAIL } },
    );
    expect(decoded.module).toBe("LatticeRegistry");
    expect(decoded.args.map((arg) => arg.value)).toEqual(["lattice.GovernedVault", "0.2.0"]);
  });
});

describe("modules that share an error (spec L75)", () => {
  const data = encode("AccessControlUnauthorizedAccount(address account, bytes32 neededRole)", [addr(1), `0x${"0".repeat(64)}`]);

  test("several placed modules declare it: all are named rather than guessed", () => {
    const decoded = decodeRevert(data, catalog, { details, placed: ["AccessControl", "VaultCore"] });
    expect(decoded.shared).toEqual(["AccessControl", "VaultCore"]);
    expect(decoded.module).toBe("AccessControl");
  });

  test("only one of them placed: that one, alone", () => {
    const decoded = decodeRevert(data, catalog, { details, placed: ["VaultCore", "ERC20"] });
    expect(decoded.module).toBe("VaultCore");
    expect(decoded.shared).toEqual([]);
  });

  test("an init contract that raises a module's error through its library never displaces the module", () => {
    const decoded = decodeRevert(encode("ERC20InvalidReceiver(address receiver)", [addr(0)]), catalog, context);
    expect(decoded.module).toBe("ERC20");
    expect(decoded.shared).toEqual([]);
  });
});

describe("MultiInit and bundle attribution", () => {
  const erc20Target = addr(0x1001);
  const accessTarget = addr(0x1002);
  const vaultTarget = addr(0x1003);
  const steps = (entries: [string, Hex][]): DecodedInit => ({
    kind: "steps",
    steps: entries.map(([spec, target]) => ({ spec, target, fn: "init", args: {}, fromRef: {} })),
  });

  test("a raw bubble names the module and the one step that could raise it", () => {
    const init = steps([["ERC20Init", erc20Target], ["AccessControlInit", accessTarget], ["DiamondIntrospectionInit.initImmutable", addr(0x1004)]]);
    const decoded = decodeRevert(encode("ERC20InvalidReceiver(address receiver)", [addr(0)]), catalog, { details, init });
    expect(decoded.module).toBe("ERC20");
    expect(decoded.target).toBe(erc20Target);
    expect(decoded.wrappers).toEqual([]);
  });

  test("two steps initialize the module: no step is named", () => {
    const init = steps([["AccessControlInit", accessTarget], ["VaultCoreInit", vaultTarget]]);
    const data = encode("AccessControlUnauthorizedAccount(address account, bytes32 neededRole)", [addr(1), `0x${"0".repeat(64)}`]);
    const decoded = decodeRevert(data, catalog, { details, init, placed: ["AccessControl"] });
    expect(decoded.module).toBe("AccessControl");
    expect(decoded.target).toBeUndefined();
  });

  test("a bundle revert names the module, and the bundle as its target", () => {
    const init: DecodedInit = { kind: "bundle", steps: [{ spec: "VaultCoreInit", target: vaultTarget, fn: "init", args: {}, fromRef: {} }] };
    const decoded = decodeRevert(encode("VaultCore__ZeroAssets()"), catalog, { details, init });
    expect(decoded.module).toBe("VaultCore");
    expect(decoded.target).toBe(vaultTarget);
  });

  test("infrastructure errors are never pinned on an init step", () => {
    const init = steps([["ERC20Init", erc20Target]]);
    const decoded = decodeRevert(encode("LatticeRegistry__Unauthorized(address caller)", [addr(3)]), catalog, { details, init });
    expect(decoded.module).toBe("LatticeRegistry");
    expect(decoded.target).toBeUndefined();
  });

  test("InitializeReverted: the step reverted with no data; the wrapper is kept and the step named", () => {
    const target = erc20Init.release?.address ?? addr(0);
    const calldata = encodeFunctionData({ abi: parseAbi(["function init(string,string)"]), functionName: "init", args: ["Token", "TKN"] });
    const data = encode("InitializeReverted(address initAddress, bytes initCalldata)", [target, calldata]);
    const decoded = decodeRevert(data, catalog, context);
    expect(decoded.wrappers).toEqual(["InitializeReverted"]);
    expect(decoded.module).toBe("ERC20Init");
    expect(decoded.target).toBe(target);
    expect(decoded.error).toBe("");
    expect(decoded.hint).toBe("`ERC20Init.init(string,string)` reverted without a reason: replay it with `eth_call` to see where it failed.");
  });

  test("AddressAndCalldataLengthMismatch is MultiInit's", () => {
    const decoded = decodeRevert(encode("AddressAndCalldataLengthMismatch()"), catalog, context);
    expect(decoded.module).toBe("MultiInit");
    expect(decoded.signature).toBe("AddressAndCalldataLengthMismatch()");
  });

  test("NoBytecodeAtAddress: MultiInit for a step's address, Lattice for a facet's", () => {
    const init = steps([["ERC20Init", erc20Target]]);
    const step = decodeRevert(encode("NoBytecodeAtAddress(address initAddress)", [erc20Target]), catalog, { details, init });
    expect(step).toMatchObject({ module: "MultiInit", shared: [], target: erc20Target });
    expect(step.hint).toBe("ERC20Init has no code on this chain: deploy the missing contracts first.");
    const facetAddress = catalog.facets[1]?.release.address ?? addr(0);
    const facet = decodeRevert(encode("NoBytecodeAtAddress(address contractAddress)", [facetAddress]), catalog, { details, init });
    expect(facet).toMatchObject({ module: "Lattice", target: facetAddress });
    const nowhere = decodeRevert(encode("NoBytecodeAtAddress(address contractAddress)", [addr(9)]), catalog, context);
    expect(nowhere.shared).toEqual(["Lattice", "MultiInit"]);
  });
});

describe("DiamondLib and Initializable", () => {
  test("InitializeDiamondCutReverted: the init reverted with no data", () => {
    const target = accessInit.release?.address ?? addr(0);
    const calldata = encodeFunctionData({ abi: parseAbi(["function init(address)"]), functionName: "init", args: [addr(5)] });
    const decoded = decodeRevert(encode("InitializeDiamondCutReverted(address initAddress, bytes data)", [target, calldata]), catalog, context);
    expect(decoded).toMatchObject({ wrappers: ["InitializeDiamondCutReverted"], module: "AccessControlInit", target, error: "", args: [] });
    expect(decoded.hint).toContain("`AccessControlInit.init(address)` reverted without a reason");
  });

  test("an unknown init address still unwraps, without a name", () => {
    const decoded = decodeRevert(encode("InitializeDiamondCutReverted(address initAddress, bytes data)", [addr(77), "0x"]), catalog, context);
    expect(decoded).toMatchObject({ wrappers: ["InitializeDiamondCutReverted"], module: null, target: addr(77), error: "" });
    expect(decoded.hint).toBe("The init call reverted without a reason: replay it with `eth_call` to see where it failed.");
  });

  test("InvalidInitialization() 0xf92ee8a9 and NotInitializing() 0xd7e6bcf8 decode though no ABI lists them", () => {
    const invalid = decodeRevert("0xf92ee8a9", catalog, { details: {} });
    expect(invalid).toMatchObject({ module: "Initializable", error: "InvalidInitialization", signature: "InvalidInitialization()" });
    expect(invalid.hint).toBeDefined();
    const notInitializing = decodeRevert("0xd7e6bcf8", catalog, { details: {} });
    expect(notInitializing).toMatchObject({ module: "Initializable", error: "NotInitializing" });
  });

  test("a DiamondLib cut error is Lattice's", () => {
    const decoded = decodeRevert(encode("CannotAddFunctionToDiamondThatAlreadyExists(bytes4 selector)", ["0xa9059cbb"]), catalog, context);
    expect(decoded).toMatchObject({ module: "Lattice", args: [{ name: "selector", type: "bytes4", value: "0xa9059cbb" }] });
  });
});

describe("CreateX", () => {
  test("FailedContractInitialisation 0xa57ca239 is unwrapped and its inner bytes decoded", () => {
    const inner = encode("ERC20InvalidReceiver(address receiver)", [addr(0)]);
    const data = encode("FailedContractInitialisation(address emitter, bytes revertData)", [CREATEX, inner]);
    expect(data.slice(0, 10)).toBe("0xa57ca239");
    const decoded = decodeRevert(data, catalog, { details, path: "createx" });
    expect(decoded).toMatchObject({ wrappers: ["FailedContractInitialisation"], module: "ERC20", error: "ERC20InvalidReceiver" });
    expect(decoded.raw).toBe(data);
  });

  test("CreateX wrapping MultiInit's InitializeReverted keeps both wrappers, outermost first", () => {
    const target = erc20Init.release?.address ?? addr(0);
    const inner = encode("InitializeReverted(address initAddress, bytes initCalldata)", [target, "0x"]);
    const data = encode("FailedContractInitialisation(address emitter, bytes revertData)", [CREATEX, inner]);
    const decoded = decodeRevert(data, catalog, { details, path: "createx" });
    expect(decoded.wrappers).toEqual(["FailedContractInitialisation", "InitializeReverted"]);
    expect(decoded).toMatchObject({ module: "ERC20Init", target, error: "" });
  });

  test("FailedContractInitialisation with no inner data says so", () => {
    const decoded = decodeRevert(encode("FailedContractInitialisation(address emitter, bytes revertData)", [CREATEX, "0x"]), catalog, context);
    expect(decoded).toMatchObject({ wrappers: ["FailedContractInitialisation"], module: null, error: "" });
    expect(decoded.hint).toContain("`eth_call`");
  });

  test("FailedContractCreation 0xc05cee7a carries CreateX as emitter and a diagnosis hint", () => {
    const data = encode("FailedContractCreation(address emitter)", [CREATEX]);
    expect(data.slice(0, 10)).toBe("0xc05cee7a");
    const decoded = decodeRevert(data, catalog, { details, path: "createx" });
    expect(decoded).toMatchObject({ module: "CreateX", error: "FailedContractCreation", target: CREATEX, wrappers: [] });
    expect(decoded.hint).toBe(
      "CreateX gives no reason when creation fails: check the salt's addresses for code, then replay the creation with `eth_call`.",
    );
  });
});

describe("no module", () => {
  test("Error(string) and Panic(uint256)", () => {
    const error = decodeRevert(encode("Error(string message)", ["nope"]), catalog, context);
    expect(error).toMatchObject({ module: null, error: "Error", args: [{ name: "message", type: "string", value: "nope" }] });
    const panic = decodeRevert(encode("Panic(uint256 code)", [0x11n]), catalog, context);
    expect(panic.args).toEqual([{ name: "code", type: "uint256", value: "0x11 (arithmetic overflow or underflow)" }]);
  });

  test("an error no known ABI declares comes back as its selector", () => {
    const decoded = decodeRevert("0xdeadbeef0000", catalog, context);
    expect(decoded).toEqual({ module: null, shared: [], error: "0xdeadbeef", args: [], wrappers: [], raw: "0xdeadbeef0000" });
  });

  test("empty revert data: no reason, with what to check (spec R21)", () => {
    const decoded = decodeRevert("0x", catalog, context);
    expect(decoded).toMatchObject({ module: null, error: "", args: [], wrappers: [] });
    expect(decoded.hint).toBe("The revert carries no reason: check the target address for code, then replay the call with `eth_call` to see where it failed.");
  });

  test("malformed arguments never throw: the error is named without them", () => {
    const decoded = decodeRevert("0xcad731cc1234", catalog, context);
    expect(decoded).toMatchObject({ module: "LatticeRegistry", error: "LatticeRegistry__RecordNotFound", args: [] });
  });

  test("uppercase input is read the same and returned lowercase", () => {
    const data = encode("LatticeRegistry__Unauthorized(address caller)", [addr(3)]);
    expect(decodeRevert(data.toUpperCase().replace("0X", "0x") as Hex, catalog, context)).toEqual(decodeRevert(data, catalog, context));
  });
});

describe("unpackVersion", () => {
  test("major<<48 | minor<<24 | patch", () => {
    expect(unpackVersion(packVersion("0.4.0"))).toBe("0.4.0");
    expect(unpackVersion(packVersion("12.345.6789"))).toBe("12.345.6789");
    expect(unpackVersion(0n)).toBeNull();
  });
});
