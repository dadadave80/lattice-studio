/**
 * Release data for shared contracts and the `Lattice` proxy (spec L101, L149-L155): the half that needs a
 * Lattice checkout built with `FOUNDRY_PROFILE=ci` and a local Anvil. `addressing.ts` holds the rules and the
 * pure arithmetic; read its header first.
 *
 * `releaseData(latticeDir, anvil, names)` takes any list of contracts (CG8 passes the facets, CG4's stateless
 * inits, LatticeRegistry and LatticeFactory), and for each: the salt, version, creation code, init-code hash,
 * address through Arachnid's proxy and runtime codehash. The codehash is `keccak256(eth_getCode)` after
 * deploying through Arachnid's proxy on Anvil, never the artifact's runtime object (the factory's immutables
 * and a library's self-address live only in deployed code). Every deployment is checked against its prediction:
 * Arachnid's proxy must name the predicted address when simulated, and code must be there afterwards.
 *
 * `proxyRelease(latticeDir)` gives the proxy's creation code, init-code hash (the factory's
 * `proxyInitCodeHash`) and standard JSON input for Sourcify, pruned from the build info to the sources the
 * proxy's metadata lists. Build clean first (`buildLattice(dir, { clean: true })`): incremental builds split
 * build info across files, and the proxy's sources must all be in one.
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  ARACHNID_PROXY,
  ARACHNID_PROXY_CODEHASH,
  type Address,
  err,
  FACTORY_PREDICT_SELECTOR,
  factoryPredict,
  type Hex,
  isAddress,
  ok,
  type Result,
  sameAddress,
} from "@lattice-studio/core";
import { concat, encodeFunctionData, getAddress, keccak256, parseAbi, size, slice, stringToHex, zeroAddress } from "viem";
import {
  constructorInputs,
  describeInputs,
  FACTORY,
  formatReleaseReport,
  LATTICE_VERSION_PATH,
  libraryName,
  linkedLibraries,
  parseLatticeVersion,
  predictShared,
  pruneStandardJson,
  REGISTRY,
  REGISTRY_OWNER_PLACEHOLDER,
  releaseConstructorArgs,
  type SharedAddressing,
  type StandardJsonInput,
  withConstructorArgs,
} from "./addressing";
import { type AnvilHandle, deployViaArachnid, ethCall, getCode } from "./anvil";
import { type Artifact, type ArtifactRef, findArtifact, linkBytecode } from "./artifacts";
import { entryRef, readInventory } from "./inventory";

/** Where the registry, the factory and the proxy live in a Lattice checkout. */
export const CORE_REFS: Readonly<Record<string, ArtifactRef>> = {
  [REGISTRY]: { file: "LatticeRegistry.sol", contract: REGISTRY, sourcePath: "src/LatticeRegistry.sol" },
  [FACTORY]: { file: "LatticeFactory.sol", contract: FACTORY, sourcePath: "src/LatticeFactory.sol" },
};
export const PROXY_REF: ArtifactRef = { file: "Lattice.sol", contract: "Lattice", sourcePath: "src/Lattice.sol" };

/** A contract to release: its name, or its name and exactly where its artifact is. */
export type ReleaseTarget = string | { name: string; ref: ArtifactRef };

/** One shared contract's release data. CG7 writes `creationCode` to a file; `toSharedContract` makes the catalog entry. */
export type ReleaseEntry = SharedAddressing & {
  /** Source path from the artifact's metadata: "src/LatticeRegistry.sol". */
  source: string;
  /** keccak256 of the runtime code on Anvil after deploying through Arachnid's proxy. */
  codehash: Hex;
  /** The ABI-encoded constructor arguments at the end of `creationCode` (the registry and the factory). */
  constructorArgs?: Hex;
  /** Linked libraries, `"<file>:<Lib>"` → the address filled in. */
  links?: Record<string, Address>;
  /** Shared contracts that must have code before this one is used: the libraries it links, by name. */
  dependsOn?: string[];
  /** A linked library Studio releases because Lattice pins none (PoseidonT3). */
  library?: true;
  /** Why this address is Studio's choice rather than Lattice's, for the UI and the report. */
  provisional?: string;
};

/** Release data for a list of contracts. */
export type ReleaseData = {
  version: string;
  deployer: { address: Address; codehash: Hex };
  /** The registry's initial owner, part of its init code (HANDOFF D6 placeholder unless given). */
  registryOwner: Address;
  /** In the order asked, less the skipped ones. */
  contracts: ReleaseEntry[];
  /** Linked libraries, in the order first linked; each is deployed before anything that links it. */
  libraries: ReleaseEntry[];
  /** Contracts with constructor arguments: deployed per use, so no release data (spec L190). */
  skipped: { name: string; reason: string }[];
};

export type ReleaseOptions = {
  /** Defaults to `LatticeVersion.VERSION` in the checkout. */
  version?: string;
  /** Defaults to `REGISTRY_OWNER_PLACEHOLDER`. */
  registryOwner?: Address;
};

/** Reads `VERSION` from the checkout's `src/LatticeVersion.sol`. */
export async function readLatticeVersion(latticeDir: string): Promise<Result<string, string>> {
  const file = Bun.file(join(latticeDir, LATTICE_VERSION_PATH));
  if (!(await file.exists())) return err(`${join(latticeDir, LATTICE_VERSION_PATH)} doesn't exist.`);
  return parseLatticeVersion(await file.text());
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Deploys `a` through Arachnid's proxy unless its address already holds code, then returns the runtime
 * codehash. A fresh deployment is checked twice: simulated first, the proxy must return the predicted address;
 * afterwards, code must be at it.
 */
async function deployChecked(anvil: AnvilHandle, a: SharedAddressing): Promise<Result<Hex, string>> {
  try {
    if ((await getCode(anvil, a.address)) === "0x") {
      const simulated = await ethCall(anvil, ARACHNID_PROXY, concat([a.salt, a.creationCode]));
      if (!simulated.ok) return err(`${a.name}: Arachnid's proxy reverts creating it: ${simulated.error}`);
      if (size(simulated.value) !== 20) {
        return err(`${a.name}: Arachnid's proxy returned ${simulated.value}, not an address.`);
      }
      if (!sameAddress(simulated.value, a.address)) {
        return err(`${a.name}: Arachnid's proxy creates it at ${getAddress(simulated.value)}, not at ${a.address}.`);
      }
      const deployed = await deployViaArachnid(anvil, a.creationCode, a.salt);
      if (!deployed.ok) return err(`${a.name}: ${deployed.error}`);
      if (!sameAddress(deployed.value, a.address)) {
        return err(`${a.name}: deployed at ${deployed.value}, predicted ${a.address}.`);
      }
    }
    const code = await getCode(anvil, a.address);
    if (code === "0x") return err(`${a.name}: no code at ${a.address} after deploying.`);
    return ok(keccak256(code));
  } catch (e) {
    return err(`${a.name}: ${message(e)}`);
  }
}

/** Resolves names to artifact references: the registry and factory, then the facet inventory, then `<Name>.sol`. */
async function resolveTargets(
  latticeDir: string,
  targets: readonly ReleaseTarget[],
): Promise<Result<{ name: string; ref: ArtifactRef }[], string>> {
  let inventory: Map<string, ArtifactRef> | undefined;
  const out: { name: string; ref: ArtifactRef }[] = [];
  const seen = new Set<string>();
  for (const target of targets) {
    const name = typeof target === "string" ? target : target.name;
    if (seen.has(name)) return err(`${name} is listed twice.`);
    seen.add(name);
    if (typeof target !== "string") {
      out.push(target);
      continue;
    }
    const core = CORE_REFS[name];
    if (core) {
      out.push({ name, ref: core });
      continue;
    }
    if (inventory === undefined) {
      const entries = await readInventory(latticeDir);
      inventory = new Map(entries.ok ? entries.value.map((e) => [e.name, entryRef(e)]) : []);
    }
    out.push({ name, ref: inventory.get(name) ?? { file: `${name}.sol`, contract: name } });
  }
  return ok(out);
}

/**
 * Salt, version, creation code, init-code hash, address through Arachnid's proxy and runtime codehash for each
 * contract, deployed on `anvil` and checked against the prediction. The registry and the factory get the
 * release's constructor arguments (the factory is built with the registry's predicted address, so asking for
 * the factory addresses the registry too); linked libraries are released first, as shared contracts of their
 * own. A contract whose constructor takes arguments is skipped with the reason.
 */
export async function releaseData(
  latticeDir: string,
  anvil: AnvilHandle,
  targets: readonly ReleaseTarget[],
  options: ReleaseOptions = {},
): Promise<Result<ReleaseData, string>> {
  let version = options.version;
  if (version === undefined) {
    const read = await readLatticeVersion(latticeDir);
    if (!read.ok) return read;
    version = read.value;
  }
  const registryOwner = options.registryOwner ?? REGISTRY_OWNER_PLACEHOLDER;
  if (!isAddress(registryOwner) || sameAddress(registryOwner, zeroAddress)) {
    return err(`registry owner ${registryOwner} must be a non-zero address.`);
  }

  let deployerCode: Hex;
  try {
    deployerCode = await getCode(anvil, ARACHNID_PROXY);
  } catch (e) {
    return err(`can't read Arachnid's proxy on ${anvil.url}: ${message(e)}`);
  }
  if (deployerCode === "0x") return err(`Arachnid's deployment proxy isn't at ${ARACHNID_PROXY} on this chain.`);
  const deployerCodehash = keccak256(deployerCode);
  if (deployerCodehash !== ARACHNID_PROXY_CODEHASH) {
    return err(`the code at ${ARACHNID_PROXY} has codehash ${deployerCodehash}, not Arachnid's proxy's.`);
  }

  const resolved = await resolveTargets(latticeDir, targets);
  if (!resolved.ok) return resolved;
  const outDir = join(latticeDir, "out");
  const artifacts = new Map<string, Artifact>();
  const load = async (name: string, ref: ArtifactRef): Promise<Result<Artifact, string>> => {
    const known = artifacts.get(name);
    if (known) return ok(known);
    const found = await findArtifact(outDir, ref);
    if (!found.ok) return err(`${name}: ${found.error}`);
    artifacts.set(name, found.value);
    return found;
  };
  for (const { name, ref } of resolved.value) {
    const a = await load(name, ref);
    if (!a.ok) return a;
  }
  const names = resolved.value.map((t) => t.name);

  const libraries = new Map<string, ReleaseEntry>();
  const libraryNames = new Map<string, string>();
  const release = async (name: string, artifact: Artifact, args: Hex | undefined): Promise<Result<ReleaseEntry, string>> => {
    const keys = linkedLibraries(artifact.bytecode.linkReferences);
    const links: Record<string, Address> = {};
    for (const key of keys) {
      const lib = await releaseLibrary(key);
      if (!lib.ok) return err(`${name}: ${lib.error}`);
      links[key] = lib.value.address;
    }
    const linked = linkBytecode(artifact.bytecode.object, artifact.bytecode.linkReferences, links);
    if (!linked.ok) return err(`${name}: ${linked.error}`);
    const addressing = predictShared(name, version, withConstructorArgs(linked.value, args));
    const codehash = await deployChecked(anvil, addressing);
    if (!codehash.ok) return codehash;
    const entry: ReleaseEntry = { ...addressing, source: artifact.sourcePath, codehash: codehash.value };
    if (args !== undefined) entry.constructorArgs = args;
    if (keys.length > 0) {
      const libs = keys.map(libraryName);
      entry.links = links;
      entry.dependsOn = libs;
      entry.provisional =
        `Links ${libs.join(", ")}, which Lattice doesn't pin yet: Studio links its own release of it, ` +
        `so this address may change when Lattice pins one.`;
    }
    return ok(entry);
  };
  const releaseLibrary = async (key: string): Promise<Result<ReleaseEntry, string>> => {
    const done = libraries.get(key);
    if (done) return ok(done);
    const lib = libraryName(key);
    const other = libraryNames.get(lib);
    if (other !== undefined && other !== key) return err(`two linked libraries are named ${lib}: ${other} and ${key}.`);
    libraryNames.set(lib, key);
    const file = key.slice(0, key.lastIndexOf(":"));
    const artifact = await findArtifact(outDir, { file: file.slice(file.lastIndexOf("/") + 1), contract: lib, sourcePath: file });
    if (!artifact.ok) return err(`linked library ${key}: ${artifact.error}`);
    if (constructorInputs(artifact.value.abi).length > 0) return err(`linked library ${key} takes constructor arguments.`);
    const entry = await release(lib, artifact.value, undefined);
    if (!entry.ok) return entry;
    const libEntry: ReleaseEntry = {
      ...entry.value,
      library: true,
      provisional:
        `Lattice doesn't release ${lib}: Studio deploys it through Arachnid's proxy with salt ` +
        `keccak256("lattice.${lib}.${version}") and links that address.`,
    };
    libraries.set(key, libEntry);
    return ok(libEntry);
  };

  const done = new Map<string, ReleaseEntry>();
  const skipped: { name: string; reason: string }[] = [];
  // The registry comes first whenever the factory is asked for: the factory's init code holds its address.
  let registry: Address | undefined;
  if (names.includes(REGISTRY) || names.includes(FACTORY)) {
    const artifact = await load(REGISTRY, CORE_REFS[REGISTRY] as ArtifactRef);
    if (!artifact.ok) return artifact;
    const args = releaseConstructorArgs(REGISTRY, artifact.value.abi, { registryOwner });
    if (!args.ok) return args;
    const entry = await release(REGISTRY, artifact.value, args.value);
    if (!entry.ok) return entry;
    registry = entry.value.address;
    done.set(REGISTRY, entry.value);
  }
  const order = [...names].sort((a, b) => rank(a) - rank(b));
  for (const name of order) {
    if (done.has(name)) continue;
    const artifact = artifacts.get(name) as Artifact;
    const context = registry === undefined ? { registryOwner } : { registryOwner, registry };
    const args = releaseConstructorArgs(name, artifact.abi, context);
    if (!args.ok) {
      if (name === REGISTRY || name === FACTORY) return args;
      skipped.push({ name, reason: args.error });
      continue;
    }
    const entry = await release(name, artifact, args.value);
    if (!entry.ok) return entry;
    done.set(name, entry.value);
  }

  return ok({
    version,
    deployer: { address: ARACHNID_PROXY, codehash: deployerCodehash },
    registryOwner: getAddress(registryOwner),
    contracts: names.flatMap((n) => done.get(n) ?? []),
    libraries: [...libraries.values()],
    skipped: names.flatMap((n) => skipped.filter((s) => s.name === n)),
  });
}

/** Deploy order: the registry, the factory, then everything else as asked (a stable sort keeps that order). */
function rank(name: string): number {
  return name === REGISTRY ? 0 : name === FACTORY ? 1 : 2;
}

/** The `Lattice` proxy at this build: what the factory CREATE2-deploys for every diamond. */
export type ProxyRelease = {
  name: "Lattice";
  source: string;
  /** No constructor arguments and no libraries: `type(Lattice).creationCode`. */
  creationCode: Hex;
  /** keccak256 of `creationCode`: the factory's `proxyInitCodeHash`. */
  initCodeHash: Hex;
  /** Standard JSON input for Sourcify, pruned to the sources the proxy's metadata lists. */
  standardJson: StandardJsonInput;
  /** The build-info file it came from, relative to the checkout. */
  buildInfo: string;
};

type BuildInfoFile = {
  input?: { language: string; sources: Record<string, { content?: string }>; settings: Record<string, unknown> };
  output?: { contracts?: Record<string, Record<string, { evm?: { bytecode?: { object?: string } } }>> };
};

/**
 * The proxy's creation code, init-code hash and standard JSON. The standard JSON comes from the one build-info
 * file whose output holds this very artifact's creation code, pruned to the sources the metadata lists, each
 * checked against the metadata's hash. None or several such files: build clean and run again.
 */
export async function proxyRelease(latticeDir: string): Promise<Result<ProxyRelease, string>> {
  const outDir = join(latticeDir, "out");
  const found = await findArtifact(outDir, PROXY_REF);
  if (!found.ok) return err(`Lattice: ${found.error}`);
  const artifact = found.value;
  if (constructorInputs(artifact.abi).length > 0) {
    return err(`Lattice takes constructor arguments ${describeInputs(constructorInputs(artifact.abi))}; the factory passes none.`);
  }
  const creation = linkBytecode(artifact.bytecode.object, artifact.bytecode.linkReferences, {});
  if (!creation.ok || linkedLibraries(artifact.bytecode.linkReferences).length > 0) {
    return err("Lattice links libraries; the factory deploys it as `type(Lattice).creationCode` with none.");
  }
  const creationCode = creation.value;

  const infoDir = join(outDir, "build-info");
  let files: string[];
  try {
    files = (await readdir(infoDir)).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return err(`${infoDir} doesn't exist. Build with FOUNDRY_PROFILE=ci forge build (the ci profile writes build info).`);
  }
  const matches: { file: string; standardJson: StandardJsonInput }[] = [];
  const problems: string[] = [];
  for (const file of files) {
    let info: BuildInfoFile;
    try {
      info = (await Bun.file(join(infoDir, file)).json()) as BuildInfoFile;
    } catch {
      problems.push(`${file} isn't JSON.`);
      continue;
    }
    const compiled = info.output?.contracts?.[artifact.sourcePath]?.[artifact.contract]?.evm?.bytecode?.object;
    if (compiled === undefined || info.input === undefined) continue;
    if (`0x${compiled.replace(/^0x/, "")}`.toLowerCase() !== creationCode) {
      problems.push(`${file} compiled a different Lattice than out/ holds.`);
      continue;
    }
    const pruned = pruneStandardJson(info.input, artifact.metadata);
    if (!pruned.ok) {
      problems.push(`${file}: ${pruned.error}`);
      continue;
    }
    matches.push({ file, standardJson: pruned.value });
  }
  const clean = "Build clean: forge clean, then FOUNDRY_PROFILE=ci forge build.";
  if (matches.length > 1) {
    return err(`${matches.length} build-info files compiled Lattice (${matches.map((m) => m.file).join(", ")}). ${clean}`);
  }
  const match = matches[0];
  if (match === undefined) {
    const why = problems.length > 0 ? ` ${problems.join(" ")}` : "";
    return err(`no build-info file in ${infoDir} compiled this Lattice.${why} ${clean}`);
  }
  return ok({
    name: "Lattice",
    source: artifact.sourcePath,
    creationCode,
    initCodeHash: keccak256(creationCode),
    standardJson: match.standardJson,
    buildInfo: join("out", "build-info", match.file),
  });
}

const PREDICT_ABI = parseAbi(["function predict(address deployer, bytes32 salt) view returns (address)"]);

/**
 * Confirms a deployed LatticeFactory CREATE2-deploys the proxy whose init-code hash is `proxyInitCodeHash`.
 * Its `_diamondInitCodeHash` is private, so this compares `predict(deployer, salt)` on the factory with core's
 * `factoryPredict` for a fixed probe.
 */
export async function checkProxyInitCodeHash(
  anvil: AnvilHandle,
  factory: Address,
  proxyInitCodeHash: Hex,
): Promise<Result<Address, string>> {
  const from = REGISTRY_OWNER_PLACEHOLDER;
  const salt = keccak256(stringToHex("lattice-studio.catalog-gen.proxy-probe"));
  const data = encodeFunctionData({ abi: PREDICT_ABI, functionName: "predict", args: [from, salt] });
  if (slice(data, 0, 4) !== FACTORY_PREDICT_SELECTOR) return err("predict(address,bytes32) isn't 0x64fb6f5e.");
  const live = await ethCall(anvil, factory, data);
  if (!live.ok) return err(`LatticeFactory.predict reverted: ${live.error}`);
  if (size(live.value) !== 32) return err(`LatticeFactory.predict returned ${live.value}, not an address.`);
  const onChain = getAddress(slice(live.value, 12, 32));
  const offline = factoryPredict({ factory, proxyInitCodeHash, from, salt });
  if (onChain !== offline) {
    return err(
      `LatticeFactory at ${factory} predicts ${onChain}; the proxy's init-code hash ${proxyInitCodeHash} gives ${offline}.`,
    );
  }
  return ok(onChain);
}

/** The release report for `releaseData`'s result (libraries first, as they deploy first) and the proxy. */
export function releaseReport(data: ReleaseData, proxy?: ProxyRelease): string {
  const row = (e: ReleaseEntry) => ({
    name: e.name,
    salt: e.salt,
    address: e.address,
    codehash: e.codehash,
    ...(e.provisional ? { note: e.library ? "provisional (library)" : `provisional (links ${e.dependsOn?.join(", ")})` } : {}),
  });
  return formatReleaseReport({
    version: data.version,
    registryOwner: data.registryOwner,
    rows: [...data.libraries.map(row), ...data.contracts.map(row)],
    skipped: data.skipped,
    ...(proxy ? { proxy: { initCodeHash: proxy.initCodeHash, sources: Object.keys(proxy.standardJson.sources).length } } : {}),
  });
}

/**
 * Builds a Lattice checkout with the ci profile (build info and storage layouts), after `forge clean` when
 * `clean` is set. Never run it on the main checkout's read-only `lattice/`.
 */
export async function buildLattice(
  latticeDir: string,
  options: { clean?: boolean; forge?: string } = {},
): Promise<Result<void, string>> {
  const forge = options.forge ?? "forge";
  const env = { ...process.env, FOUNDRY_PROFILE: "ci" };
  const steps = options.clean ? [["clean"], ["build"]] : [["build"]];
  for (const step of steps) {
    let proc: ReturnType<typeof Bun.spawn>;
    try {
      proc = Bun.spawn([forge, ...step, "--root", latticeDir], { env, stdout: "ignore", stderr: "pipe" });
    } catch (e) {
      return err(`${forge} ${step.join(" ")} didn't start: ${message(e)}`);
    }
    const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr as ReadableStream).text()]);
    if (code !== 0) return err(`${forge} ${step.join(" ")} failed (exit ${code}): ${stderr.slice(-2000)}`);
  }
  return ok(undefined);
}
