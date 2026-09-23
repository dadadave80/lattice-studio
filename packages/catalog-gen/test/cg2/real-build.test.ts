/**
 * Integration: release data for the pinned Lattice, built with FOUNDRY_PROFILE=ci, on two real Anvils with
 * different chain ids. Runs when forge and anvil are installed and this run owns a Lattice checkout (CG1's
 * gate); skipped otherwise. The build is incremental. When the build info doesn't hold one consistent compile of
 * the proxy, the test fails with proxyRelease's "build clean" message, unless CG2_CLEAN_BUILD=1 lets it run
 * `forge clean` and rebuild (about 2 minutes).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { arachnidAddress, type Hex, sharedSalt } from "@lattice-studio/core";
import { encodeAbiParameters, encodeFunctionData, getAddress, keccak256, parseAbi, slice, stringToHex, zeroAddress } from "viem";
import { REGISTRY_OWNER_PLACEHOLDER } from "../../src/addressing";
import { type AnvilHandle, ethCall, getCode, startAnvil, studioEnv } from "../../src/anvil";
import { readInventory } from "../../src/inventory";
import {
  buildLattice,
  checkProxyInitCodeHash,
  type ProxyRelease,
  proxyRelease,
  type ReleaseData,
  releaseData,
  releaseReport,
  type ReleaseTarget,
} from "../../src/release";
import { realBuildGate } from "../cg1/real-build-gate";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");
const gate = realBuildGate((name) => studioEnv(name, REPO_ROOT), REPO_ROOT, (bin) => Bun.which(bin));
const LATTICE = gate.latticeDir;
/** Under the merge gate's 1200 s limit for the whole test run (scripts/wp/merge.ts). */
const BUILD_TIMEOUT_MS = 15 * 60_000;
/** Opt-in: when the build info splits the proxy's compile, `forge clean` and rebuild (about 2 minutes). */
const CLEAN_FLAG = "CG2_CLEAN_BUILD";
const CLEAN_ON_SPLIT = studioEnv(CLEAN_FLAG, REPO_ROOT) === "1";

/** Stateless inits resolved by name (CG4 passes the full list), and one with constructor arguments. */
const INITS = ["ERC20Init", "MultiInit", "DiamondIntrospectionInit", "AccountInit"];

/** solc 0.8.36 as forge installs it (svm), to recompile the proxy's standard JSON. */
function findSolc(): string | undefined {
  const candidates = [
    join(homedir(), "Library", "Application Support", "svm", "0.8.36", "solc-0.8.36"),
    join(homedir(), ".svm", "0.8.36", "solc-0.8.36"),
  ];
  return candidates.find((p) => existsSync(p));
}

const title = "release data for the pinned Lattice, built with FOUNDRY_PROFILE=ci";
describe.skipIf(!gate.run)(gate.run ? title : `${title} (skipped: ${gate.reason})`, () => {
  const anvils: AnvilHandle[] = [];
  let targets: ReleaseTarget[] = [];
  let first: ReleaseData | undefined;
  let second: ReleaseData | undefined;
  let proxy: ProxyRelease | undefined;

  beforeAll(async () => {
    const built = await buildLattice(LATTICE);
    if (!built.ok) throw new Error(built.error);
    let p = await proxyRelease(LATTICE);
    if (!p.ok && CLEAN_ON_SPLIT) {
      const clean = await buildLattice(LATTICE, { clean: true });
      if (!clean.ok) throw new Error(clean.error);
      p = await proxyRelease(LATTICE);
    }
    if (!p.ok) throw new Error(`${p.error} (or rerun with ${CLEAN_FLAG}=1 to let this test build clean, about 2 minutes)`);
    proxy = p.value;

    const inventory = await readInventory(LATTICE);
    if (!inventory.ok) throw new Error(inventory.error);
    targets = ["LatticeRegistry", "LatticeFactory", ...inventory.value.map((e) => e.name), ...INITS];

    for (const args of [[], ["--chain-id", "11155111"]]) {
      const started = await startAnvil({ args });
      if (!started.ok) throw new Error(started.error);
      anvils.push(started.value);
    }
    const [a, b] = anvils as [AnvilHandle, AnvilHandle];
    const one = await releaseData(LATTICE, a, targets);
    if (!one.ok) throw new Error(one.error);
    first = one.value;
    const two = await releaseData(LATTICE, b, targets);
    if (!two.ok) throw new Error(two.error);
    second = two.value;
    console.log(releaseReport(first, proxy));
  }, BUILD_TIMEOUT_MS);

  afterAll(async () => {
    for (const a of anvils) await a.stop();
  });

  const entry = (name: string) => {
    const e = first?.contracts.find((c) => c.name === name) ?? first?.libraries.find((c) => c.name === name);
    if (!e) throw new Error(`no entry for ${name}`);
    return e;
  };

  test("version 0.2.0 from LatticeVersion.sol; every facet, the registry, the factory and the stateless inits", () => {
    expect(first?.version).toBe("0.2.0");
    // Lattice pins no evm_version, so this is Foundry's default for solc 0.8.36: a change moves every address.
    expect(first?.compiler.evmVersion).toBe("osaka");
    expect(first?.compiler.version).toStartWith("0.8.36+commit.");
    expect(proxy?.compiler).toEqual(first?.compiler as ReleaseData["compiler"]);
    expect(first?.contracts).toHaveLength(targets.length - 1);
    expect(first?.skipped.map((s) => s.name)).toEqual(["AccountInit"]);
    expect(first?.skipped[0]?.reason).toContain("so it's deployed per use");
  });

  test("every predicted address holds the deployed code on Anvil, with the recorded codehash", async () => {
    const anvil = anvils[0] as AnvilHandle;
    for (const e of [...(first?.libraries ?? []), ...(first?.contracts ?? [])]) {
      expect({ name: e.name, salt: e.salt }).toEqual({ name: e.name, salt: sharedSalt(e.name, e.version) });
      expect(e.initCodeHash).toBe(keccak256(e.creationCode));
      expect({ name: e.name, address: e.address }).toEqual({ name: e.name, address: arachnidAddress(e.salt, e.initCodeHash) });
      expect({ name: e.name, codehash: keccak256(await getCode(anvil, e.address)) }).toEqual({ name: e.name, codehash: e.codehash });
    }
  });

  test("deterministic: a second chain with another chain id gives identical data", () => {
    expect(second).toEqual(first as ReleaseData);
  });

  test("the registry is owned by the D6 placeholder; the factory is built on its address with no ENS", async () => {
    const anvil = anvils[0] as AnvilHandle;
    const registry = entry("LatticeRegistry");
    const factory = entry("LatticeFactory");
    expect(first?.registryOwner).toBe(REGISTRY_OWNER_PLACEHOLDER);
    expect(registry.salt).toBe(keccak256(stringToHex("lattice.LatticeRegistry")));
    expect(factory.salt).toBe(keccak256(stringToHex("lattice.LatticeFactory")));
    const owner = await ethCall(anvil, registry.address, encodeFunctionData({ abi: parseAbi(["function owner() view returns (address)"]), functionName: "owner" }));
    if (!owner.ok) throw new Error(owner.error);
    expect(getAddress(slice(owner.value, 12, 32))).toBe(REGISTRY_OWNER_PLACEHOLDER);
    expect(factory.constructorArgs).toBe(
      encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "address" }], [registry.address, zeroAddress, zeroAddress]),
    );
    const onChain = await ethCall(anvil, factory.address, encodeFunctionData({ abi: parseAbi(["function registry() view returns (address)"]), functionName: "registry" }));
    if (!onChain.ok) throw new Error(onChain.error);
    expect(getAddress(slice(onChain.value, 12, 32))).toBe(registry.address);
  });

  test("PoseidonT3 is released first; only Semaphore and ShieldedPool link it, and they're flagged provisional", () => {
    const lib = entry("PoseidonT3");
    expect(first?.libraries.map((l) => l.name)).toEqual(["PoseidonT3"]);
    expect(lib.salt).toBe(keccak256(stringToHex("lattice.PoseidonT3.0.2.0")));
    const linking = first?.contracts.filter((c) => c.dependsOn !== undefined).map((c) => c.name);
    expect(linking).toEqual(["Semaphore", "ShieldedPool"]);
    for (const name of ["Semaphore", "ShieldedPool"]) {
      const e = entry(name);
      expect(Object.values(e.links ?? {})).toEqual([lib.address]);
      expect(e.provisional).toContain("PoseidonT3");
    }
    expect(first?.contracts.filter((c) => c.provisional !== undefined).map((c) => c.name)).toEqual(["Semaphore", "ShieldedPool"]);
  });

  test("the proxy's init-code hash is the one the deployed factory uses", async () => {
    if (!proxy) throw new Error("no proxy");
    expect(proxy.initCodeHash).toBe(keccak256(proxy.creationCode));
    const res = await checkProxyInitCodeHash(anvils[0] as AnvilHandle, entry("LatticeFactory").address, proxy.initCodeHash);
    expect(res.ok).toBe(true);
    const wrong = await checkProxyInitCodeHash(anvils[0] as AnvilHandle, entry("LatticeFactory").address, keccak256("0x00"));
    expect(wrong.ok).toBe(false);
  });

  test("the proxy's standard JSON holds exactly its metadata's sources and is deterministic", async () => {
    if (!proxy) throw new Error("no proxy");
    const artifact = (await Bun.file(join(LATTICE, "out", "Lattice.sol", "Lattice.json")).json()) as { rawMetadata: string };
    const metadata = JSON.parse(artifact.rawMetadata) as { sources: Record<string, unknown> };
    expect(Object.keys(proxy.standardJson.sources)).toEqual(Object.keys(metadata.sources));
    expect(await proxyRelease(LATTICE)).toEqual({ ok: true, value: proxy });
  });

  const solc = findSolc();
  test.skipIf(solc === undefined)("solc 0.8.36 recompiles the standard JSON to the proxy's creation code", async () => {
    if (!proxy || !solc) throw new Error("no proxy");
    const proc = Bun.spawn([solc, "--standard-json"], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    proc.stdin.write(JSON.stringify(proxy.standardJson));
    await proc.stdin.end();
    const [out] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    const compiled = JSON.parse(out) as {
      errors?: { severity: string; formattedMessage: string }[];
      contracts: Record<string, Record<string, { evm: { bytecode: { object: string } } }>>;
    };
    expect((compiled.errors ?? []).filter((e) => e.severity === "error")).toEqual([]);
    const object = compiled.contracts["src/Lattice.sol"]?.Lattice?.evm.bytecode.object;
    expect(`0x${object}` as Hex).toBe(proxy.creationCode);
  }, 120_000);

  test("the report lists salt, address and codehash for every contract", () => {
    if (!first) throw new Error("no data");
    const text = releaseReport(first, proxy);
    for (const e of [...first.libraries, ...first.contracts]) expect(text).toContain(`${e.salt}  ${e.address}  ${e.codehash}`);
    expect(text).toContain(`init-code hash ${proxy?.initCodeHash}`);
  });
});
