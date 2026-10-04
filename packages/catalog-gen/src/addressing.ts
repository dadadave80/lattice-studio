/**
 * Release addressing for shared contracts (spec L101, L149-L155, decision 6, R21): the pure half. Given a
 * contract's creation code (libraries linked, constructor arguments appended), its salt, init-code hash and
 * address through Arachnid's deterministic deployment proxy follow from core's `sharedSalt` and
 * `arachnidAddress`. `release.ts` does the half that needs a Lattice build and an Anvil.
 *
 * Rules at the pin (Lattice 6c8db45, `VERSION` "0.2.0"; every address here is provisional until the 0.4.0
 * re-pin, HANDOFF D2):
 * - Version: `LatticeVersion.VERSION`, read from `src/LatticeVersion.sol`, never hardcoded.
 * - Salts: `sharedSalt(name, version)`, `keccak256("lattice.<Name>.<version>")`; LatticeRegistry and
 *   LatticeFactory are versionless (`DeployRelease.s.sol` L99-L103).
 * - Constructor arguments, as the canonical build passes them (`DeployRelease.s.sol` L161-L171):
 *   `LatticeRegistry(initialOwner)` with the placeholder owner below, and `LatticeFactory(registry, 0, 0)`,
 *   the registry's predicted address and no ENS reverse registrar. Any other contract whose ABI has constructor
 *   inputs is per-deployment and gets no release data.
 * - Linked libraries (PoseidonT3, which Semaphore and ShieldedPool link through lean-imt): Lattice pins no
 *   library address, so Studio releases each library as a shared contract of its own, through Arachnid's proxy
 *   at `sharedSalt("<Lib>", version)`, `keccak256("lattice.PoseidonT3.0.2.0")` at the pin, and links that
 *   address. Every contract that links one is flagged provisional: its address is Studio's choice until
 *   Lattice pins the library (ledger "For Lattice" #5).
 */
import {
  ARACHNID_PROXY,
  type AbiItem,
  type Address,
  arachnidAddress,
  canonicalJson,
  err,
  type Hex,
  ok,
  type Result,
  type ShardRef,
  type SharedContract,
  sharedSalt,
} from "@lattice-studio/core";
import { type AbiParameter, encodeAbiParameters, keccak256, toHex, zeroAddress } from "viem";
import type { LinkReferences, SolcMetadata } from "./artifacts";

/**
 * The registry's initial owner while the real one is undecided (HANDOFF D6; Lattice A7 decides it). Clearly
 * fake and non-zero (the constructor rejects zero), recorded with the release data so the catalog shows it.
 * It's part of the registry's init code, so the registry's and the factory's addresses depend on it.
 */
export const REGISTRY_OWNER_PLACEHOLDER: Address = "0x000000000000000000000000000000000000dEaD";

/** Where the library-wide version lives in a Lattice checkout. */
export const LATTICE_VERSION_PATH = "src/LatticeVersion.sol";

/** The two shared contracts whose constructor arguments the release fixes. */
export const REGISTRY = "LatticeRegistry";
export const FACTORY = "LatticeFactory";

const VERSION_CONSTANT = /string\s+internal\s+constant\s+VERSION\s*=\s*"([^"]*)"\s*;/g;
const SEMVER = /^\d+\.\d+\.\d+$/;

/**
 * Reads `VERSION` from `LatticeVersion.sol`'s source. Exactly one declaration, a plain `MAJOR.MINOR.PATCH`
 * (what `DeployRelease.packVersion` accepts), or an error saying what was found.
 */
export function parseLatticeVersion(source: string): Result<string, string> {
  const found = [...source.matchAll(VERSION_CONSTANT)].map((m) => m[1] ?? "");
  if (found.length !== 1) {
    return err(`${LATTICE_VERSION_PATH}: expected one VERSION constant, found ${found.length}.`);
  }
  const version = found[0] ?? "";
  if (!SEMVER.test(version)) return err(`${LATTICE_VERSION_PATH}: VERSION "${version}" isn't MAJOR.MINOR.PATCH.`);
  return ok(version);
}

/** The constructor's inputs from an ABI; none when the ABI has no constructor. */
export function constructorInputs(abi: readonly AbiItem[]): readonly AbiParameter[] {
  const ctor = abi.find((item) => item.type === "constructor");
  return ctor?.type === "constructor" ? ctor.inputs : [];
}

/** Renders constructor inputs as `(address initialOwner, uint256 x)` for messages. */
export function describeInputs(inputs: readonly AbiParameter[]): string {
  return `(${inputs.map((i) => (i.name ? `${i.type} ${i.name}` : i.type)).join(", ")})`;
}

/**
 * The ABI-encoded constructor arguments the release passes, by contract name: the registry's owner and the
 * factory's `(registry, 0, 0)`. `ok(undefined)` for a contract without constructor inputs; an error for any
 * other contract that has them (deployed per use, spec L190) or for arguments that don't fit the ABI.
 */
export function releaseConstructorArgs(
  name: string,
  abi: readonly AbiItem[],
  context: { registryOwner: Address; registry?: Address },
): Result<Hex | undefined, string> {
  const inputs = constructorInputs(abi);
  let args: readonly unknown[];
  if (name === REGISTRY) args = [context.registryOwner];
  else if (name === FACTORY) {
    if (context.registry === undefined) return err(`${FACTORY} needs the registry's address.`);
    args = [context.registry, zeroAddress, zeroAddress];
  } else if (inputs.length === 0) return ok(undefined);
  else return err(`${name} takes constructor arguments ${describeInputs(inputs)}, so it's deployed per use.`);

  if (inputs.length !== args.length) {
    return err(`${name}'s constructor takes ${describeInputs(inputs)}, not the ${args.length} arguments the release passes.`);
  }
  try {
    return ok(encodeAbiParameters(inputs, args));
  } catch (e) {
    return err(`${name}: constructor arguments don't encode: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Appends ABI-encoded constructor arguments to linked creation code. */
export function withConstructorArgs(creationCode: Hex, args: Hex | undefined): Hex {
  return args === undefined ? creationCode : (`${creationCode}${args.slice(2)}`.toLowerCase() as Hex);
}

/** `"<file>:<Lib>"` for every library a piece of code links, in the order the link references list them. */
export function linkedLibraries(refs: LinkReferences): string[] {
  const keys: string[] = [];
  for (const [file, libs] of Object.entries(refs)) for (const lib of Object.keys(libs)) keys.push(`${file}:${lib}`);
  return keys;
}

/** The library name in a `"<file>:<Lib>"` key. */
export function libraryName(key: string): string {
  return key.slice(key.lastIndexOf(":") + 1);
}

/** What a shared contract's address commits to, before anything is deployed. */
export type SharedAddressing = {
  name: string;
  /** Passed unhashed to Arachnid's proxy. */
  salt: Hex;
  version: string;
  /** keccak256 of `creationCode`. */
  initCodeHash: Hex;
  /** CREATE2(Arachnid's proxy, salt, initCodeHash), checksummed. */
  address: Address;
  /** Linked, with constructor arguments appended: what Arachnid's proxy receives after the salt. */
  creationCode: Hex;
};

/** Salt, init-code hash and address of a shared contract through Arachnid's proxy. */
export function predictShared(name: string, version: string, creationCode: Hex): SharedAddressing {
  const salt = sharedSalt(name, version);
  const initCodeHash = keccak256(creationCode);
  return { name, salt, version, initCodeHash, address: arachnidAddress(salt, initCodeHash), creationCode };
}

/** What `toSharedContract` reads from a release entry: the addressing, the codehash and the optional flags. */
export type SharedContractSource = Pick<SharedAddressing, "salt" | "version" | "address" | "initCodeHash"> & {
  codehash: Hex;
  /** Shared contracts (linked libraries) that must be on the chain first. */
  dependsOn?: string[];
  /** Why the address isn't final yet. */
  provisional?: string;
};

/**
 * The catalog's `SharedContract` for an addressed, deployed contract, once CG7 has written its creation code
 * to a file and made the `ShardRef`. `dependsOn` and `provisional` are carried through when present.
 */
export function toSharedContract(entry: SharedContractSource, creationCode: ShardRef): SharedContract {
  const shared: SharedContract = {
    salt: entry.salt,
    version: entry.version,
    address: entry.address,
    codehash: entry.codehash,
    initCodeHash: entry.initCodeHash,
    creationCode,
  };
  if (entry.dependsOn !== undefined && entry.dependsOn.length > 0) shared.dependsOn = [...entry.dependsOn];
  if (entry.provisional !== undefined) shared.provisional = entry.provisional;
  return shared;
}

/** One `Catalog.libraries` item for a released library (PoseidonT3): its name and its `SharedContract`. */
export function toLibraryItem(
  entry: SharedContractSource & { name: string },
  creationCode: ShardRef,
): { name: string; release: SharedContract } {
  return { name: entry.name, release: toSharedContract(entry, creationCode) };
}

/**
 * The compiler a contract was built with, as its metadata records it: "0.8.36+commit.…" and the EVM version.
 * Sourcify needs both beside the standard JSON. Lattice pins no `evm_version`, so the EVM version is Foundry's
 * default for the solc in use, and a change there moves every address.
 */
export type Compiler = { version: string; evmVersion: string };

/** The compiler from solc metadata; an error when the metadata doesn't name the EVM version. */
export function compilerOf(metadata: SolcMetadata, name: string): Result<Compiler, string> {
  const evmVersion = metadata.settings.evmVersion;
  if (evmVersion === undefined || evmVersion === "") return err(`${name}: its metadata names no evmVersion.`);
  return ok({ version: metadata.compiler.version, evmVersion });
}

/** Solidity standard JSON input (the fields Sourcify reads). */
export type StandardJsonInput = {
  language: string;
  sources: Record<string, { content: string }>;
  settings: Record<string, unknown>;
};

/** The part of a Foundry build-info file the proxy's standard JSON comes from. */
export type BuildInfoInput = {
  language: string;
  sources: Record<string, { content?: string }>;
  settings: Record<string, unknown>;
};

/**
 * The standard JSON input for one contract, pruned from a build's input to the sources its metadata lists
 * (the ones its metadata hash covers, so recompiling reproduces the bytecode). Every source must be present
 * with the content the metadata hashed; settings are the build's own, and must agree with the metadata on the
 * settings that change bytecode. `outputSelection` is replaced by `STANDARD_OUTPUT_SELECTION` and settings keys
 * are sorted, so the same compile read from two build-info files gives byte-identical output.
 */
export function pruneStandardJson(input: BuildInfoInput, metadata: SolcMetadata): Result<StandardJsonInput, string> {
  if (input.language !== metadata.language) {
    return err(`build info compiles ${input.language}, the metadata says ${metadata.language}.`);
  }
  const sources: Record<string, { content: string }> = {};
  for (const [path, { keccak256: expected }] of Object.entries(metadata.sources)) {
    const content = input.sources[path]?.content;
    if (content === undefined) return err(`build info lacks ${path}.`);
    if (keccak256(toHex(content)) !== expected.toLowerCase()) {
      return err(`build info holds a different ${path} than the metadata hashed.`);
    }
    sources[path] = { content };
  }
  const s = input.settings;
  const m = metadata.settings;
  const mismatch = (label: string, a: unknown, b: unknown): string | undefined =>
    JSON.stringify(a) === JSON.stringify(b) ? undefined : `${label}: build info ${JSON.stringify(a)}, metadata ${JSON.stringify(b)}`;
  const optimizer = (s.optimizer ?? {}) as { enabled?: boolean; runs?: number };
  const buildMeta = (s.metadata ?? {}) as { bytecodeHash?: string };
  const problems = [
    mismatch("evmVersion", s.evmVersion, m.evmVersion),
    mismatch("optimizer.enabled", optimizer.enabled ?? false, m.optimizer?.enabled ?? false),
    mismatch("optimizer.runs", optimizer.runs, m.optimizer?.runs),
    mismatch("viaIR", s.viaIR ?? false, m.viaIR ?? false),
    mismatch("metadata.bytecodeHash", buildMeta.bytecodeHash ?? "ipfs", m.metadata?.bytecodeHash ?? "ipfs"),
    mismatch("libraries", s.libraries ?? {}, m.libraries ?? {}),
  ].filter((p): p is string => p !== undefined);
  if (problems.length > 0) return err(`build settings differ from the metadata: ${problems.join("; ")}.`);
  // outputSelection only picks what solc reports, never the bytecode; builds differ in it, so it's normalized.
  // Keys are sorted, so two builds with the same settings give byte-identical standard JSON.
  const settings = JSON.parse(canonicalJson({ ...s, outputSelection: STANDARD_OUTPUT_SELECTION })) as Record<string, unknown>;
  return ok({ language: input.language, sources, settings });
}

/** The outputSelection every pruned standard JSON carries: enough for Sourcify and for a bytecode check. */
export const STANDARD_OUTPUT_SELECTION = {
  "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object", "metadata"] },
} as const;

/**
 * What differs between two standard JSON inputs, for an error message: the language, source paths or contents,
 * and settings keys. Empty when they're byte-identical as canonical JSON.
 */
export function standardJsonDifferences(a: StandardJsonInput, b: StandardJsonInput): string[] {
  const out: string[] = [];
  if (a.language !== b.language) out.push("language");
  const paths = [...new Set([...Object.keys(a.sources), ...Object.keys(b.sources)])].sort();
  for (const p of paths) {
    if (a.sources[p]?.content !== b.sources[p]?.content) out.push(`sources.${p}`);
  }
  if (out.length === 0 && canonicalJson(Object.keys(a.sources)) !== canonicalJson(Object.keys(b.sources))) {
    out.push("source order");
  }
  const keys = [...new Set([...Object.keys(a.settings), ...Object.keys(b.settings)])].sort();
  for (const k of keys) {
    if (canonicalJson(a.settings[k] ?? null) !== canonicalJson(b.settings[k] ?? null)) out.push(`settings.${k}`);
  }
  return out;
}

/** One row of the release report. */
export type ReportRow = { name: string; salt: Hex; address: Address; codehash: Hex; note?: string };

/**
 * The release report: one line per contract with its salt, address and runtime codehash, then the proxy's
 * init-code hash. Plain text, column-aligned, deterministic.
 */
export function formatReleaseReport(args: {
  version: string;
  registryOwner: Address;
  rows: ReportRow[];
  skipped?: { name: string; reason: string }[];
  proxy?: { initCodeHash: Hex; sources: number };
}): string {
  const width = Math.max(4, ...args.rows.map((r) => r.name.length));
  const lines = [
    `Release ${args.version} through Arachnid's proxy ${ARACHNID_PROXY} · registry owner ${args.registryOwner}`,
    `${"name".padEnd(width)}  ${"salt".padEnd(66)}  ${"address".padEnd(42)}  codehash`,
    ...args.rows.map(
      (r) => `${r.name.padEnd(width)}  ${r.salt}  ${r.address}  ${r.codehash}${r.note ? `  ${r.note}` : ""}`,
    ),
  ];
  for (const s of args.skipped ?? []) lines.push(`skipped ${s.name}: ${s.reason}`);
  if (args.proxy) {
    lines.push(`Lattice proxy · init-code hash ${args.proxy.initCodeHash} · standard JSON with ${args.proxy.sources} sources`);
  }
  return `${lines.join("\n")}\n`;
}
