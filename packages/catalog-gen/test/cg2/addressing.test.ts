import { describe, expect, test } from "bun:test";
import { ARACHNID_PROXY, type AbiItem, type Address, type Hex, isAddress } from "@lattice-studio/core";
import { encodeAbiParameters, getCreate2Address, keccak256, stringToHex, toHex } from "viem";
import {
  constructorInputs,
  formatReleaseReport,
  libraryName,
  linkedLibraries,
  parseLatticeVersion,
  predictShared,
  pruneStandardJson,
  REGISTRY_OWNER_PLACEHOLDER,
  releaseConstructorArgs,
  toSharedContract,
  withConstructorArgs,
} from "../../src/addressing";
import type { SolcMetadata } from "../../src/artifacts";

const VERSION_SOURCE = `library LatticeVersion {
    /// @notice The full semantic version string of the Lattice library (e.g. "0.1.0").
    string internal constant VERSION = "0.2.0"; // x-release-please-version
    uint internal constant MAJOR = 0; // x-release-please-major
}`;

describe("parseLatticeVersion", () => {
  test("reads VERSION, not the example in the doc comment", () => {
    expect(parseLatticeVersion(VERSION_SOURCE)).toEqual({ ok: true, value: "0.2.0" });
  });

  test("refuses no declaration, two, or a version DeployRelease can't pack", () => {
    expect(parseLatticeVersion("library LatticeVersion {}").ok).toBe(false);
    expect(parseLatticeVersion(`${VERSION_SOURCE}\n${VERSION_SOURCE}`).ok).toBe(false);
    const bad = parseLatticeVersion(VERSION_SOURCE.replace('"0.2.0"', '"0.2.0-rc.1"'));
    expect(bad).toEqual({ ok: false, error: 'src/LatticeVersion.sol: VERSION "0.2.0-rc.1" isn\'t MAJOR.MINOR.PATCH.' });
  });
});

const REGISTRY_ABI: AbiItem[] = [
  { type: "constructor", stateMutability: "nonpayable", inputs: [{ name: "initialOwner", type: "address" }] },
];
const FACTORY_ABI: AbiItem[] = [
  {
    type: "constructor",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_registry", type: "address", internalType: "contract ILatticeRegistry" },
      { name: "reverseRegistrar", type: "address" },
      { name: "reverseRecordOwner", type: "address" },
    ],
  },
];
const INIT_WITH_ARGS: AbiItem[] = [
  { type: "constructor", stateMutability: "nonpayable", inputs: [{ name: "validator", type: "address" }] },
];
const REGISTRY: Address = "0x1111111111111111111111111111111111111111";

describe("constructor arguments", () => {
  test("the placeholder owner is D6's, non-zero and checksummed", () => {
    expect(REGISTRY_OWNER_PLACEHOLDER).toBe("0x000000000000000000000000000000000000dEaD");
    expect(isAddress(REGISTRY_OWNER_PLACEHOLDER)).toBe(true);
  });

  test("LatticeRegistry(initialOwner) gets the owner", () => {
    const args = releaseConstructorArgs("LatticeRegistry", REGISTRY_ABI, { registryOwner: REGISTRY_OWNER_PLACEHOLDER });
    expect(args).toEqual({ ok: true, value: `0x${"0".repeat(24)}000000000000000000000000000000000000dead` });
  });

  test("LatticeFactory(registry, 0, 0): the registry's address and no ENS reverse registrar", () => {
    const args = releaseConstructorArgs("LatticeFactory", FACTORY_ABI, {
      registryOwner: REGISTRY_OWNER_PLACEHOLDER,
      registry: REGISTRY,
    });
    const zero = "0x0000000000000000000000000000000000000000";
    expect(args).toEqual({
      ok: true,
      value: encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "address" }], [REGISTRY, zero, zero]),
    });
    expect(releaseConstructorArgs("LatticeFactory", FACTORY_ABI, { registryOwner: REGISTRY_OWNER_PLACEHOLDER })).toEqual({
      ok: false,
      error: "LatticeFactory needs the registry's address.",
    });
  });

  test("a contract without a constructor takes none; one with inputs is per-deployment", () => {
    expect(releaseConstructorArgs("ERC20Init", [], { registryOwner: REGISTRY_OWNER_PLACEHOLDER })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(releaseConstructorArgs("AccountInit", INIT_WITH_ARGS, { registryOwner: REGISTRY_OWNER_PLACEHOLDER })).toEqual({
      ok: false,
      error: "AccountInit takes constructor arguments (address validator), so it's deployed per use.",
    });
  });

  test("a registry or factory whose constructor changed shape is an error, not a guess", () => {
    const res = releaseConstructorArgs("LatticeRegistry", FACTORY_ABI, { registryOwner: REGISTRY_OWNER_PLACEHOLDER });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("not the 1 arguments the release passes");
  });

  test("constructorInputs and withConstructorArgs", () => {
    expect(constructorInputs(REGISTRY_ABI).map((i) => i.name)).toEqual(["initialOwner"]);
    expect(constructorInputs([])).toEqual([]);
    expect(withConstructorArgs("0x6000", undefined)).toBe("0x6000");
    expect(withConstructorArgs("0x6000", "0xABCD")).toBe("0x6000abcd");
  });
});

describe("predictShared", () => {
  const code: Hex = "0x6001600c60003960016000f32a";

  test("versioned salt, init-code hash and CREATE2 from Arachnid's proxy", () => {
    const a = predictShared("ERC20", "0.2.0", code);
    expect(a.salt).toBe(keccak256(stringToHex("lattice.ERC20.0.2.0")));
    expect(a.initCodeHash).toBe(keccak256(code));
    expect(a.address).toBe(getCreate2Address({ from: ARACHNID_PROXY, salt: a.salt, bytecodeHash: keccak256(code) }));
    expect(a).toMatchObject({ name: "ERC20", version: "0.2.0", creationCode: code });
  });

  test("the registry and factory salts carry no version; the version is still recorded", () => {
    expect(predictShared("LatticeRegistry", "0.2.0", code).salt).toBe(keccak256(stringToHex("lattice.LatticeRegistry")));
    expect(predictShared("LatticeFactory", "0.2.0", code)).toMatchObject({
      salt: keccak256(stringToHex("lattice.LatticeFactory")),
      version: "0.2.0",
    });
  });

  test("a library gets the same rule as any shared contract", () => {
    expect(predictShared("PoseidonT3", "0.2.0", code).salt).toBe(keccak256(stringToHex("lattice.PoseidonT3.0.2.0")));
  });

  test("toSharedContract keeps the catalog fields only", () => {
    const a = predictShared("ERC20", "0.2.0", code);
    const ref = { path: "code/ERC20.creation.hex", bytes: 30, hash: keccak256("0x00") };
    expect(toSharedContract({ ...a, codehash: keccak256("0x2a") }, ref)).toEqual({
      salt: a.salt,
      version: "0.2.0",
      address: a.address,
      codehash: keccak256("0x2a"),
      initCodeHash: a.initCodeHash,
      creationCode: ref,
    });
  });
});

describe("library keys", () => {
  test("linkedLibraries lists file:Lib keys in link-reference order; libraryName takes the name", () => {
    const refs = {
      "lib/poseidon-solidity/PoseidonT3.sol": { PoseidonT3: [{ start: 10, length: 20 }] },
      "src/B.sol": { B: [{ start: 40, length: 20 }], A: [{ start: 80, length: 20 }] },
    };
    expect(linkedLibraries(refs)).toEqual(["lib/poseidon-solidity/PoseidonT3.sol:PoseidonT3", "src/B.sol:B", "src/B.sol:A"]);
    expect(libraryName("lib/poseidon-solidity/PoseidonT3.sol:PoseidonT3")).toBe("PoseidonT3");
    expect(linkedLibraries({})).toEqual([]);
  });
});

describe("pruneStandardJson", () => {
  const sources = { "src/Lattice.sol": "contract Lattice {}", "src/Dep.sol": "library Dep {}", "test/X.t.sol": "x" };
  const settings = {
    remappings: ["@lattice/=src/"],
    optimizer: { enabled: true, runs: 1_000_000 },
    metadata: { useLiteralContent: false, bytecodeHash: "ipfs", appendCBOR: true },
    outputSelection: { "*": { "*": ["abi"] } },
    evmVersion: "osaka",
    viaIR: false,
    libraries: {},
  };
  const input = {
    language: "Solidity",
    sources: Object.fromEntries(Object.entries(sources).map(([p, content]) => [p, { content }])),
    settings,
  };
  const metadata = (over: Partial<SolcMetadata["settings"]> = {}): SolcMetadata => ({
    compiler: { version: "0.8.36+commit.aaaaaaaa" },
    language: "Solidity",
    settings: {
      compilationTarget: { "src/Lattice.sol": "Lattice" },
      evmVersion: "osaka",
      libraries: {},
      metadata: { bytecodeHash: "ipfs" },
      optimizer: { enabled: true, runs: 1_000_000 },
      remappings: [":@lattice/=src/"],
      ...over,
    },
    sources: {
      "src/Dep.sol": { keccak256: keccak256(toHex(sources["src/Dep.sol"])) },
      "src/Lattice.sol": { keccak256: keccak256(toHex(sources["src/Lattice.sol"])) },
    },
    output: { abi: [], userdoc: {}, devdoc: {} },
  });

  test("keeps exactly the metadata's sources, in its order, and the build's settings", () => {
    expect(pruneStandardJson(input, metadata())).toEqual({
      ok: true,
      value: {
        language: "Solidity",
        sources: { "src/Dep.sol": { content: "library Dep {}" }, "src/Lattice.sol": { content: "contract Lattice {}" } },
        settings,
      },
    });
  });

  test("refuses a missing source or one whose content the metadata didn't hash", () => {
    const { "src/Dep.sol": _, ...rest } = input.sources;
    expect(pruneStandardJson({ ...input, sources: rest }, metadata())).toEqual({
      ok: false,
      error: "build info lacks src/Dep.sol.",
    });
    const changed = { ...input, sources: { ...input.sources, "src/Dep.sol": { content: "library Dep { }" } } };
    expect(pruneStandardJson(changed, metadata())).toEqual({
      ok: false,
      error: "build info holds a different src/Dep.sol than the metadata hashed.",
    });
  });

  test("refuses settings that would compile different bytecode", () => {
    const res = pruneStandardJson(input, metadata({ evmVersion: "cancun", optimizer: { enabled: true, runs: 200 } }));
    expect(res).toEqual({
      ok: false,
      error:
        'build settings differ from the metadata: evmVersion: build info "osaka", metadata "cancun"; ' +
        "optimizer.runs: build info 1000000, metadata 200.",
    });
    expect(pruneStandardJson({ ...input, language: "Yul" }, metadata()).ok).toBe(false);
  });
});

describe("formatReleaseReport", () => {
  test("one aligned line per contract with salt, address and codehash, then skips and the proxy", () => {
    const a = predictShared("LatticeRegistry", "0.2.0", "0x6000");
    const b = predictShared("PoseidonT3", "0.2.0", "0x6001");
    const text = formatReleaseReport({
      version: "0.2.0",
      registryOwner: REGISTRY_OWNER_PLACEHOLDER,
      rows: [
        { name: b.name, salt: b.salt, address: b.address, codehash: keccak256("0x01"), note: "provisional (library)" },
        { name: a.name, salt: a.salt, address: a.address, codehash: keccak256("0x02") },
      ],
      skipped: [{ name: "AccountInit", reason: "takes constructor arguments" }],
      proxy: { initCodeHash: keccak256("0x03"), sources: 5 },
    });
    const lines = text.trimEnd().split("\n");
    expect(lines).toHaveLength(6);
    expect(lines[0]).toBe(
      "Release 0.2.0 through Arachnid's proxy 0x4e59b44847b379578588920cA78FbF26c0B4956C · registry owner 0x000000000000000000000000000000000000dEaD",
    );
    expect(lines[2]).toBe(`PoseidonT3       ${b.salt}  ${b.address}  ${keccak256("0x01")}  provisional (library)`);
    expect(lines[3]).toBe(`LatticeRegistry  ${a.salt}  ${a.address}  ${keccak256("0x02")}`);
    expect(lines[4]).toBe("skipped AccountInit: takes constructor arguments");
    expect(lines[5]).toBe(`Lattice proxy · init-code hash ${keccak256("0x03")} · standard JSON with 5 sources`);
    expect(lines[1]?.indexOf("salt")).toBe(lines[3]?.indexOf("0x"));
  });
});
