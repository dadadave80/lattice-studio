/**
 * `releaseData` and `proxyRelease` over a synthetic Lattice checkout: hand-assembled contracts whose creation
 * code returns a fixed runtime, so ordering, constructor arguments, library linking and skipping are checked on a
 * real Anvil in milliseconds. The real Lattice is `real-build.test.ts`'s.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type AbiItem, arachnidAddress, type Hex, sharedSalt } from "@lattice-studio/core";
import { encodeAbiParameters, keccak256, stringToHex, toHex, zeroAddress } from "viem";
import { REGISTRY_OWNER_PLACEHOLDER } from "../../src/addressing";
import { type AnvilHandle, getCode, startAnvil } from "../../src/anvil";
import { libraryPlaceholder } from "../../src/artifacts";
import { proxyRelease, type ReleaseData, releaseData, releaseReport } from "../../src/release";

const hex = (n: number): string => n.toString(16).padStart(2, "0");

/** Init code that copies `runtime` (hex without 0x, placeholders allowed) to memory and returns it. */
function creation(runtime: string): string {
  const length = runtime.includes("__$") ? (runtime.length - 40) / 2 + 20 : runtime.length / 2;
  // PUSH1 len, PUSH1 12, PUSH1 0, CODECOPY, PUSH1 len, PUSH1 0, RETURN: 12 bytes, then the runtime.
  return `0x60${hex(length)}600c60003960${hex(length)}6000f3${runtime}`;
}

type Fixture = { file: string; contract: string; runtime: string; abi?: AbiItem[]; links?: Record<string, number[]> };

async function writeArtifact(outDir: string, f: Fixture): Promise<void> {
  const sourcePath = f.file;
  const object = creation(f.runtime);
  const linkReferences: Record<string, Record<string, { start: number; length: number }[]>> = {};
  for (const [key, starts] of Object.entries(f.links ?? {})) {
    const colon = key.lastIndexOf(":");
    linkReferences[key.slice(0, colon)] = { [key.slice(colon + 1)]: starts.map((start) => ({ start, length: 20 })) };
  }
  const rawMetadata = JSON.stringify({
    compiler: { version: "0.8.36+commit.fixture" },
    language: "Solidity",
    settings: {
      compilationTarget: { [sourcePath]: f.contract },
      evmVersion: "osaka",
      libraries: {},
      metadata: { bytecodeHash: "ipfs" },
      optimizer: { enabled: true, runs: 1_000_000 },
      remappings: [],
    },
    sources: { [sourcePath]: { keccak256: keccak256(toHex(`contract ${f.contract} {}`)) } },
    output: { abi: f.abi ?? [], userdoc: {}, devdoc: {} },
  });
  const artifact = {
    abi: f.abi ?? [],
    bytecode: { object, linkReferences },
    deployedBytecode: { object: `0x${f.runtime}`, linkReferences, immutableReferences: {} },
    methodIdentifiers: {},
    rawMetadata,
  };
  const base = sourcePath.slice(sourcePath.lastIndexOf("/") + 1);
  const path = join(outDir, base, `${f.contract}.json`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(artifact));
}

const LIB_KEY = "lib/poseidon-solidity/PoseidonT3.sol:PoseidonT3";
const ctor = (...types: string[]): AbiItem[] => [
  { type: "constructor", stateMutability: "nonpayable", inputs: types.map((type, i) => ({ name: `a${i}`, type })) },
];
// PUSH20 <library>, POP, STOP: the library's address sits 13 bytes into the creation code.
const linkingRuntime = `73${libraryPlaceholder("lib/poseidon-solidity/PoseidonT3.sol", "PoseidonT3")}5000`;
const FIXTURES: Fixture[] = [
  { file: "src/LatticeRegistry.sol", contract: "LatticeRegistry", runtime: "01", abi: ctor("address") },
  { file: "src/LatticeFactory.sol", contract: "LatticeFactory", runtime: "02", abi: ctor("address", "address", "address") },
  { file: "src/tokens/ERC20/ERC20.sol", contract: "ERC20", runtime: "03" },
  { file: "src/privacy/semaphore/Semaphore.sol", contract: "Semaphore", runtime: linkingRuntime, links: { [LIB_KEY]: [13] } },
  { file: "src/accounts/erc7579/AccountInit.sol", contract: "AccountInit", runtime: "04", abi: ctor("address") },
  { file: "lib/poseidon-solidity/PoseidonT3.sol", contract: "PoseidonT3", runtime: "05" },
  { file: "src/Lattice.sol", contract: "Lattice", runtime: "06" },
];

let root = "";
let anvil: AnvilHandle | undefined;
let data: ReleaseData | undefined;
const ANVIL = Bun.which("anvil");

describe.skipIf(ANVIL === null)(`releaseData on a synthetic checkout${ANVIL ? "" : " (skipped: anvil isn't installed)"}`, () => {
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "cg2-release-"));
    for (const f of FIXTURES) await writeArtifact(join(root, "out"), f);
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "LatticeVersion.sol"), 'string internal constant VERSION = "9.8.7";');
    const started = await startAnvil();
    if (!started.ok) throw new Error(started.error);
    anvil = started.value;
    const res = await releaseData(root, anvil, ["ERC20", "Semaphore", "AccountInit", "LatticeFactory", "LatticeRegistry"]);
    if (!res.ok) throw new Error(res.error);
    data = res.value;
  });

  afterAll(async () => {
    await anvil?.stop();
    if (root) await rm(root, { recursive: true, force: true });
  });

  const byName = (name: string) => {
    const e = data?.contracts.find((c) => c.name === name) ?? data?.libraries.find((c) => c.name === name);
    if (!e) throw new Error(`no entry for ${name}`);
    return e;
  };

  test("reads the version from LatticeVersion.sol and records the placeholder owner", () => {
    expect(data?.version).toBe("9.8.7");
    expect(data?.registryOwner).toBe(REGISTRY_OWNER_PLACEHOLDER);
    expect(data?.deployer.address).toBe("0x4e59b44847b379578588920cA78FbF26c0B4956C");
  });

  test("keeps the order asked, skips the contract with constructor arguments and says why", () => {
    expect(data?.contracts.map((c) => c.name)).toEqual(["ERC20", "Semaphore", "LatticeFactory", "LatticeRegistry"]);
    expect(data?.skipped).toEqual([
      { name: "AccountInit", reason: "AccountInit takes constructor arguments (address a0), so it's deployed per use." },
    ]);
  });

  test("the registry takes the owner; the factory takes the registry's predicted address and two zeros", () => {
    const registry = byName("LatticeRegistry");
    const factory = byName("LatticeFactory");
    const ownerArg = encodeAbiParameters([{ type: "address" }], [REGISTRY_OWNER_PLACEHOLDER]);
    expect(registry.constructorArgs).toBe(ownerArg);
    expect(registry.creationCode).toBe(`${creation("01")}${ownerArg.slice(2)}` as Hex);
    expect(registry.salt).toBe(keccak256(stringToHex("lattice.LatticeRegistry")));
    const factoryArgs = encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "address" }],
      [registry.address, zeroAddress, zeroAddress],
    );
    expect(factory.constructorArgs).toBe(factoryArgs);
    expect(factory.creationCode.endsWith(factoryArgs.slice(2))).toBe(true);
  });

  test("every address is Arachnid's CREATE2 of the salt and init-code hash, and holds the codehash on Anvil", async () => {
    if (!anvil || !data) throw new Error("no data");
    for (const e of [...data.libraries, ...data.contracts]) {
      expect(e.salt).toBe(sharedSalt(e.name, e.version));
      expect(e.initCodeHash).toBe(keccak256(e.creationCode));
      expect(e.address).toBe(arachnidAddress(e.salt, e.initCodeHash));
      expect(e.codehash).toBe(keccak256(await getCode(anvil, e.address)));
    }
    expect(byName("ERC20").codehash).toBe(keccak256("0x03"));
  });

  test("the linked library is released first, linked by address, and both are flagged provisional", () => {
    const lib = byName("PoseidonT3");
    const semaphore = byName("Semaphore");
    expect(data?.libraries.map((l) => l.name)).toEqual(["PoseidonT3"]);
    expect(lib.library).toBe(true);
    expect(lib.salt).toBe(keccak256(stringToHex("lattice.PoseidonT3.9.8.7")));
    expect(lib.provisional).toBe(
      "Lattice doesn't release PoseidonT3: Studio deploys it through Arachnid's proxy with salt " +
        'keccak256("lattice.PoseidonT3.9.8.7") and links that address.',
    );
    expect(semaphore.links).toEqual({ [LIB_KEY]: lib.address });
    expect(semaphore.dependsOn).toEqual(["PoseidonT3"]);
    expect(semaphore.creationCode).toContain(lib.address.slice(2).toLowerCase());
    expect(semaphore.provisional).toContain("Links PoseidonT3, which Lattice doesn't pin yet");
    expect(byName("ERC20").provisional).toBeUndefined();
    expect(byName("LatticeRegistry").provisional).toBeUndefined();
  });

  test("a second run on the same chain reuses the deployments and returns the same data", async () => {
    if (!anvil) throw new Error("no anvil");
    const again = await releaseData(root, anvil, ["ERC20", "Semaphore", "AccountInit", "LatticeFactory", "LatticeRegistry"]);
    expect(again).toEqual({ ok: true, value: data as ReleaseData });
  });

  test("asking for the factory alone still builds it on the registry's address", async () => {
    if (!anvil) throw new Error("no anvil");
    const alone = await releaseData(root, anvil, ["LatticeFactory"]);
    if (!alone.ok) throw new Error(alone.error);
    expect(alone.value.contracts.map((c) => c.name)).toEqual(["LatticeFactory"]);
    expect(alone.value.contracts[0]?.address).toBe(byName("LatticeFactory").address);
  });

  test("a different owner moves the registry and the factory, nothing else", async () => {
    if (!anvil) throw new Error("no anvil");
    const other = await releaseData(root, anvil, ["ERC20", "LatticeRegistry", "LatticeFactory"], {
      registryOwner: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    });
    if (!other.ok) throw new Error(other.error);
    const [erc20, registry, factory] = other.value.contracts;
    expect(erc20?.address).toBe(byName("ERC20").address);
    expect(registry?.address).not.toBe(byName("LatticeRegistry").address);
    expect(factory?.address).not.toBe(byName("LatticeFactory").address);
  });

  test("refuses a zero owner, a duplicate, and a contract with no artifact", async () => {
    if (!anvil) throw new Error("no anvil");
    expect(await releaseData(root, anvil, ["ERC20"], { registryOwner: zeroAddress })).toEqual({
      ok: false,
      error: `registry owner ${zeroAddress} must be a non-zero address.`,
    });
    expect(await releaseData(root, anvil, ["ERC20", "ERC20"])).toEqual({ ok: false, error: "ERC20 is listed twice." });
    const missing = await releaseData(root, anvil, ["Nope"]);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toStartWith("Nope: no artifact for Nope.sol:Nope");
  });

  test("an explicit artifact reference wins over name lookup", async () => {
    if (!anvil) throw new Error("no anvil");
    const res = await releaseData(root, anvil, [
      { name: "ERC20", ref: { file: "ERC20.sol", contract: "ERC20", sourcePath: "src/tokens/ERC20/ERC20.sol" } },
    ]);
    expect(res.ok && res.value.contracts[0]?.address).toBe(byName("ERC20").address);
  });

  test("the report lists salt, address and codehash per contract, libraries first", () => {
    if (!data) throw new Error("no data");
    const lines = releaseReport(data).trimEnd().split("\n");
    expect(lines).toHaveLength(2 + 5 + 1);
    expect(lines[2]).toStartWith("PoseidonT3");
    for (const [i, name] of ["ERC20", "Semaphore", "LatticeFactory", "LatticeRegistry"].entries()) {
      const e = byName(name);
      expect(lines[3 + i]).toStartWith(name);
      expect(lines[3 + i]).toContain(`${e.salt}  ${e.address}  ${e.codehash}`);
    }
    expect(lines[4]).toEndWith("provisional (links PoseidonT3)");
    expect(lines[7]).toBe("skipped AccountInit: AccountInit takes constructor arguments (address a0), so it's deployed per use.");
  });
});

describe("proxyRelease on a synthetic build", () => {
  let dir = "";
  const lattice = FIXTURES.find((f) => f.contract === "Lattice") as Fixture;
  const source = "contract Lattice {}";
  const buildInfo = (object: string) => ({
    id: "x",
    input: {
      language: "Solidity",
      sources: { "src/Lattice.sol": { content: source }, "test/Other.t.sol": { content: "x" } },
      settings: { optimizer: { enabled: true, runs: 1_000_000 }, evmVersion: "osaka", metadata: { bytecodeHash: "ipfs" }, libraries: {} },
    },
    output: { contracts: { "src/Lattice.sol": { Lattice: { evm: { bytecode: { object } } } } } },
  });

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "cg2-proxy-"));
    await writeArtifact(join(dir, "out"), lattice);
  });
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  test("no build info: says to build with the ci profile", async () => {
    const res = await proxyRelease(dir);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("Build with FOUNDRY_PROFILE=ci forge build");
  });

  test("one matching build-info file: creation code, init-code hash and the pruned standard JSON", async () => {
    await mkdir(join(dir, "out", "build-info"), { recursive: true });
    await writeFile(join(dir, "out", "build-info", "a.json"), JSON.stringify(buildInfo(creation("06").slice(2))));
    await writeFile(join(dir, "out", "build-info", "b.json"), JSON.stringify({ id: "b", input: {}, output: { contracts: {} } }));
    const res = await proxyRelease(dir);
    if (!res.ok) throw new Error(res.error);
    expect(res.value.creationCode).toBe(creation("06") as Hex);
    expect(res.value.initCodeHash).toBe(keccak256(creation("06") as Hex));
    expect(Object.keys(res.value.standardJson.sources)).toEqual(["src/Lattice.sol"]);
    expect(res.value.buildInfo).toBe(join("out", "build-info", "a.json"));
  });

  test("two build-info files that compiled it: build clean", async () => {
    await writeFile(join(dir, "out", "build-info", "c.json"), JSON.stringify(buildInfo(creation("06").slice(2))));
    const res = await proxyRelease(dir);
    expect(res).toEqual({
      ok: false,
      error: "2 build-info files compiled Lattice (a.json, c.json). Build clean: forge clean, then FOUNDRY_PROFILE=ci forge build.",
    });
  });

  test("build info from another compile of Lattice doesn't count", async () => {
    await rm(join(dir, "out", "build-info", "c.json"));
    await writeFile(join(dir, "out", "build-info", "a.json"), JSON.stringify(buildInfo(creation("07").slice(2))));
    const res = await proxyRelease(dir);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("a.json compiled a different Lattice than out/ holds.");
  });
});
