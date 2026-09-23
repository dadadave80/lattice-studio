// The pure half of the shared-contract golden test: parse what the harness logged, derive what the catalog
// predicts, work out which deployer DeployRelease used, and compare. No files, no forge: run.ts does that.

import {
  ARACHNID_PROXY,
  type Address,
  type Catalog,
  CREATEX,
  type Hex,
  type Result,
  type SharedContract,
  arachnidAddress,
  err,
  ok,
  sameAddress,
} from "@lattice-studio/core";
import { getAddress, getContractAddress, isAddress, keccak256 } from "viem";

/** Printed, and the suite passes, while DeployRelease still deploys through CreateX raw salts. */
export const SKIP_REASON = "Lattice A1 (release through Arachnid's proxy) isn't at the pin";

/** The registry and the factory; every other shared contract is a FacetInventory facet. */
export const REGISTRY = "LatticeRegistry";
export const FACTORY = "LatticeFactory";

const TAG = "STUDIO_RELEASE";
const HASH32 = /^0x[0-9a-fA-F]{64}$/;
const CODE = /^0x(?:[0-9a-fA-F]{2})+$/;
/** Runtime code at an address, which may be empty. */
const RUNTIME = /^0x(?:[0-9a-fA-F]{2})*$/;

/** One contract the harness saw `release()` return. */
export type ReleasedContract = { name: string; address: Address; codehash: Hex };

/** Everything the harness logged: the release version, the owner it passed and what came back. */
export type ReleaseReport = {
  version: string;
  owner: Address;
  /** Runtime codehash at Arachnid's proxy address on the test chain. */
  deployerCodehash: Hex;
  /** Whether DeployRelease refused to run without CreateX's code, so the harness etched Lattice's MockCreateX. */
  createx: "mock-createx" | "no-createx";
  /** Registry, factory, then the facets in FacetInventory order. */
  contracts: ReleasedContract[];
  /** The creation code DeployRelease took from `vm.getCode`, for the facets run.ts asked about. */
  creationCodes: Record<string, Hex>;
  /** Each unpinned library run.ts asked about: the address forge linked and the runtime code there. */
  libraries: Record<string, { address: Address; runtimeCode: Hex }>;
};

/**
 * Reads the harness's `STUDIO_RELEASE` lines and ignores everything else `release()` prints. Exactly one header
 * first, then one `contract` line per name and at most one `code` line per name; anything malformed is an error
 * naming the line (shortened, since a code line holds a whole contract).
 */
export function parseReleaseLogs(lines: readonly string[]): Result<ReleaseReport, string> {
  let header: Omit<ReleaseReport, "contracts" | "creationCodes" | "libraries"> | undefined;
  const contracts: ReleasedContract[] = [];
  const creationCodes: Record<string, Hex> = {};
  const libraries: ReleaseReport["libraries"] = {};
  const seen = new Set<string>();
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] !== TAG) continue;
    const kind = parts[1];
    const shown = line.length > 240 ? `${line.slice(0, 237)}...` : line;
    if (kind === "header") {
      const [, , version, owner, codehash, createx] = parts;
      if (
        parts.length !== 6 ||
        !version ||
        !owner ||
        !isAddress(owner) ||
        !codehash ||
        !HASH32.test(codehash) ||
        (createx !== "mock-createx" && createx !== "no-createx")
      ) {
        return err(`malformed header line "${shown}".`);
      }
      if (header) return err("the harness logged two headers.");
      header = { version, owner: getAddress(owner), deployerCodehash: codehash.toLowerCase() as Hex, createx };
      continue;
    }
    if (kind === "contract") {
      const [, , name, address, codehash] = parts;
      if (parts.length !== 5 || !name || !address || !isAddress(address) || !codehash || !HASH32.test(codehash)) {
        return err(`malformed contract line "${shown}".`);
      }
      if (!header) return err(`a contract line came before the header: "${shown}".`);
      if (seen.has(name)) return err(`the harness reported ${name} twice.`);
      seen.add(name);
      contracts.push({ name, address: getAddress(address), codehash: codehash.toLowerCase() as Hex });
      continue;
    }
    if (kind === "code") {
      const [, , name, code] = parts;
      if (parts.length !== 4 || !name || !code || !CODE.test(code)) return err(`malformed code line "${shown}".`);
      if (!header) return err(`a code line came before the header: "${shown}".`);
      if (creationCodes[name] !== undefined) return err(`the harness logged ${name}'s creation code twice.`);
      creationCodes[name] = code.toLowerCase() as Hex;
      continue;
    }
    if (kind === "library") {
      const [, , name, address, code] = parts;
      if (parts.length !== 5 || !name || !address || !isAddress(address) || !code || !RUNTIME.test(code)) {
        return err(`malformed library line "${shown}".`);
      }
      if (!header) return err(`a library line came before the header: "${shown}".`);
      if (libraries[name] !== undefined) return err(`the harness reported ${name} twice.`);
      libraries[name] = { address: getAddress(address), runtimeCode: code.toLowerCase() as Hex };
      continue;
    }
    return err(`unknown line "${shown}".`);
  }
  if (!header) return err("the harness logged no header.");
  if (contracts.length === 0) return err("the harness reported no contracts.");
  return ok({ ...header, contracts, creationCodes, libraries });
}

/** A contract whose catalog address links libraries Lattice doesn't pin yet. */
export type KnownGap = {
  /** The unpinned libraries: the addresses and codehashes of Studio's own releases, which the catalog links. */
  libraries: { name: string; address: Address; codehash: Hex }[];
  /** The catalog's creation code (`code/<Name>.creation.hex`), when run.ts loaded it. */
  creationCode?: Hex;
};

/** A shared contract as the catalog predicts it. */
export type ExpectedContract = {
  name: string;
  version: string;
  salt: Hex;
  initCodeHash: Hex;
  address: Address;
  codehash: Hex;
  /**
   * Set when the address depends on a library Lattice doesn't pin (PoseidonT3 at the pin, ledger "For Lattice"
   * #5). A divergence is a known Lattice gap, not a Studio bug, only when `checkKnownGap` accepts it.
   */
  knownGap?: KnownGap;
};

/** What the catalog says DeployRelease should produce. */
export type ExpectedRelease = {
  registryOwner: Address;
  deployer: { address: Address; codehash: Hex };
  /** Registry, factory, then the facets in catalog order. */
  contracts: ExpectedContract[];
};

/** The fields of a catalog `SharedContract` this suite reads. */
export type SharedRelease = Pick<
  SharedContract,
  "salt" | "version" | "address" | "codehash" | "initCodeHash" | "dependsOn" | "provisional"
>;

/** The catalog fields this suite reads; a whole `Catalog` fits. */
export type CatalogRelease = {
  deployer: Catalog["deployer"];
  registry: SharedRelease;
  factory: SharedRelease;
  facets: { name: string; release: SharedRelease }[];
  libraries?: { name: string; release: SharedRelease }[];
  registryOwner?: Address;
};

/** The HANDOFF D6 placeholder owner CG2 uses when the catalog records none. */
export const DEFAULT_REGISTRY_OWNER: Address = "0x000000000000000000000000000000000000dEaD";

/**
 * The registry, the factory and every facet from the catalog, with known gaps marked: a contract whose
 * `dependsOn` names only libraries the catalog releases provisionally. `creationCodes` holds the catalog's
 * creation code of those contracts, by name (run.ts reads it from the catalog's code files).
 */
export function expectedFromCatalog(
  catalog: CatalogRelease,
  creationCodes: ReadonlyMap<string, Hex> = new Map(),
): ExpectedRelease {
  const provisional = new Map(
    (catalog.libraries ?? [])
      .filter((l) => l.release.provisional !== undefined)
      .map((l) => [l.name, { name: l.name, address: l.release.address, codehash: l.release.codehash }]),
  );
  const entry = (name: string, c: SharedRelease): ExpectedContract => {
    const e: ExpectedContract = {
      name,
      version: c.version,
      salt: c.salt,
      initCodeHash: c.initCodeHash,
      address: c.address,
      codehash: c.codehash,
    };
    const deps = c.dependsOn ?? [];
    if (deps.length > 0 && deps.every((d) => provisional.has(d))) {
      const gap: KnownGap = { libraries: deps.flatMap((d) => provisional.get(d) ?? []) };
      const code = creationCodes.get(name);
      if (code !== undefined) gap.creationCode = code.toLowerCase() as Hex;
      e.knownGap = gap;
    }
    return e;
  };
  return {
    registryOwner: catalog.registryOwner ?? DEFAULT_REGISTRY_OWNER,
    deployer: catalog.deployer,
    contracts: [
      entry(REGISTRY, catalog.registry),
      entry(FACTORY, catalog.factory),
      ...catalog.facets.map((f) => entry(f.name, f.release)),
    ],
  };
}

/** The contracts run.ts must ask the harness for creation code: the known-gap ones. */
export function knownGapNames(expected: ExpectedRelease): string[] {
  return expected.contracts.filter((c) => c.knownGap !== undefined).map((c) => c.name);
}

/**
 * What run.ts passes the harness in STUDIO_RELEASE_LIBRARIES: for each unpinned library, `<Lib>:<Contract>:<offset>`,
 * the first place a known-gap contract's catalog code links it, where the harness reads forge's linked address.
 * A library no loaded catalog code links is left out, and `checkKnownGap` says so.
 */
export function libraryProbes(expected: ExpectedRelease): string[] {
  const probes = new Map<string, string>();
  for (const c of expected.contracts) {
    const code = c.knownGap?.creationCode;
    if (!c.knownGap || code === undefined) continue;
    for (const lib of c.knownGap.libraries) {
      const [first] = libraryWindows(code, lib.address);
      if (first !== undefined && !probes.has(lib.name)) probes.set(lib.name, `${lib.name}:${c.name}:${first}`);
    }
  }
  return [...probes.values()];
}

/** How DeployRelease put its contracts on chain. */
export type DeployerModel = "arachnid" | "createx-raw";

/**
 * Where CreateX's `deployCreate2` puts a raw protocol salt (neither the caller's address nor zero in its first
 * 20 bytes): CREATE2 from CreateX with `keccak256(abi.encode(salt))`, which for one bytes32 is `keccak256(salt)`
 * (`CreateXDeployer.predictRaw` at the pin).
 */
export function createxRawAddress(salt: Hex, initCodeHash: Hex): Address {
  return getContractAddress({ opcode: "CREATE2", from: CREATEX, salt: keccak256(salt), bytecodeHash: initCodeHash });
}

/** Where a contract lands under `model`. */
export function addressUnder(model: DeployerModel, salt: Hex, initCodeHash: Hex): Address {
  return model === "arachnid" ? arachnidAddress(salt, initCodeHash) : createxRawAddress(salt, initCodeHash);
}

/**
 * Which deployer the release used, read from where the registry landed. The registry anchors it: its init code
 * links no library and holds only the owner, which the harness passes as the catalog's.
 */
export function detectDeployer(registry: Pick<ExpectedContract, "salt" | "initCodeHash">, deployed: Address): DeployerModel | "unknown" {
  if (sameAddress(deployed, arachnidAddress(registry.salt, registry.initCodeHash))) return "arachnid";
  if (sameAddress(deployed, createxRawAddress(registry.salt, registry.initCodeHash))) return "createx-raw";
  return "unknown";
}

/**
 * Byte offsets where `code` holds `address` as a PUSH20 operand (0x73 then the 20 bytes): where a contract's
 * code calls a linked library.
 */
export function libraryWindows(code: Hex, address: Address): number[] {
  const hex = code.slice(2).toLowerCase();
  const needle = `73${address.slice(2).toLowerCase()}`;
  const out: number[] = [];
  for (let at = hex.indexOf(needle); at >= 0; at = hex.indexOf(needle, at + 1)) {
    if (at % 2 === 0) out.push(at / 2 + 1);
  }
  return out;
}

/**
 * The codehash a library's runtime code would have at `at`. A deployed Solidity library starts with
 * `PUSH20 <its own address>` (its call guard), so its codehash depends on where it lives; this swaps `own` in
 * that guard for `at`. An error when the code doesn't start with that guard.
 */
export function libraryCodehashAt(runtime: Hex, own: Address, at: Address): Result<Hex, string> {
  const hex = runtime.slice(2).toLowerCase();
  if (!hex.startsWith(`73${own.slice(2).toLowerCase()}`)) {
    return err(hex === "" ? "there's no code there" : "its code doesn't start with a library's PUSH20 of its own address");
  }
  return ok(keccak256(`0x73${at.slice(2).toLowerCase()}${hex.slice(42)}`));
}

/**
 * Accepts a known-gap divergence only when it's explained by the unpinned libraries alone:
 * - the catalog's creation code hashes to its init-code hash;
 * - for each library, the harness reports the address forge linked and the runtime code there, which is the
 *   catalog's library: moved to the catalog's address, it has the catalog's codehash. That address isn't the
 *   catalog's own (then the library explains nothing);
 * - forge's creation code (what DeployRelease deployed) has the same length and differs from the catalog's only
 *   inside the PUSH20 windows where the catalog's code holds a library's catalog address, and each of those
 *   windows holds that library's forge address;
 * - DeployRelease put the contract where forge's creation code lands under `model`.
 * Returns why otherwise.
 */
export function checkKnownGap(
  want: ExpectedContract & { knownGap: KnownGap },
  report: Pick<ReleaseReport, "creationCodes" | "libraries">,
  deployedAt: Address,
  model: DeployerModel,
): Result<string, string> {
  const catalogCode = want.knownGap.creationCode;
  const forgeCode = report.creationCodes[want.name];
  if (catalogCode === undefined) return err("the catalog's creation code wasn't loaded, so the gap can't be checked");
  if (forgeCode === undefined) return err("the harness didn't log forge's creation code, so the gap can't be checked");
  if (keccak256(catalogCode) !== want.initCodeHash.toLowerCase()) {
    return err(`the catalog's creation code hashes to ${keccak256(catalogCode)}, not its init-code hash ${want.initCodeHash}`);
  }
  const a = catalogCode.slice(2).toLowerCase();
  const b = forgeCode.slice(2).toLowerCase();
  if (a.length !== b.length) return err(`forge's creation code is ${b.length / 2} bytes, the catalog's ${a.length / 2}`);

  const masked = new Uint8Array(a.length / 2);
  const linked: string[] = [];
  for (const lib of want.knownGap.libraries) {
    const windows = libraryWindows(catalogCode, lib.address);
    if (windows.length === 0) return err(`the catalog's creation code doesn't link ${lib.name} at ${lib.address}`);
    const forgeLib = report.libraries[lib.name];
    if (forgeLib === undefined) return err(`the harness didn't report which ${lib.name} forge linked`);
    if (sameAddress(forgeLib.address, lib.address)) {
      return err(`forge links the catalog's own ${lib.name} address ${lib.address}, so the library doesn't explain the difference`);
    }
    const moved = libraryCodehashAt(forgeLib.runtimeCode, forgeLib.address, lib.address);
    if (!moved.ok) return err(`forge's ${lib.name} at ${forgeLib.address} isn't a library: ${moved.error}`);
    if (moved.value !== lib.codehash.toLowerCase()) {
      return err(
        `forge's ${lib.name} at ${forgeLib.address} isn't the catalog's: at ${lib.address} it would have codehash ${moved.value}, not ${lib.codehash}`,
      );
    }
    const forgeAt = forgeLib.address.slice(2).toLowerCase();
    for (const w of windows) {
      if (b.slice(w * 2 - 2, w * 2 + 40) !== `73${forgeAt}`) {
        return err(`forge's creation code doesn't link ${lib.name} at ${forgeLib.address} at byte ${w}`);
      }
      masked.fill(1, w, w + 20);
    }
    linked.push(`${lib.name} at ${forgeLib.address} instead of ${lib.address}`);
  }
  for (let i = 0; i < a.length; i += 2) {
    if (masked[i / 2] === 1) continue;
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1]) {
      return err(`forge's creation code differs from the catalog's at byte ${i / 2}, outside the linked library addresses`);
    }
  }
  const expectedAt = addressUnder(model, want.salt, keccak256(forgeCode));
  if (!sameAddress(expectedAt, deployedAt)) {
    return err(`DeployRelease put it at ${deployedAt}, not where forge's creation code lands (${expectedAt})`);
  }
  return ok(
    `forge links ${linked.join(", ")}, which Lattice doesn't pin yet; the library and the creation code are otherwise the catalog's`,
  );
}

export type RowStatus = "match" | "known-gap" | "mismatch" | "missing" | "extra" | "not-compared";

/** One shared contract's outcome; `detail` says what differs as `expected → DeployRelease`, or where it is. */
export type Row = { name: string; status: RowStatus; detail: string };

export type Comparison = {
  model: DeployerModel;
  /** Problems with the run as a whole: version, owner, the deployer's code, the catalog's own consistency. */
  problems: string[];
  rows: Row[];
};

/**
 * Compares the release with the catalog under `model`. Under "arachnid" (Lattice A1 landed) the catalog's
 * addresses must be exactly where DeployRelease put each contract. Under "createx-raw" (the pin) the catalog's
 * salts and init-code hashes must still give DeployRelease's addresses through CreateX's formula, which proves
 * they're the ones DeployRelease uses; the factory isn't compared there, because its init code holds the
 * registry's address, which differs between the two deployers. Every runtime codehash must match too. A
 * known-gap contract that differs passes only through `checkKnownGap`.
 */
export function compareRelease(expected: ExpectedRelease, report: ReleaseReport, model: DeployerModel): Comparison {
  const problems: string[] = [];
  const versions = [...new Set(expected.contracts.map((c) => c.version))].sort();
  if (versions.length !== 1 || versions[0] !== report.version) {
    problems.push(`the catalog is for version ${versions.join(", ")}; DeployRelease released ${report.version}.`);
  }
  if (!sameAddress(expected.registryOwner, report.owner)) {
    problems.push(`the catalog's registry owner is ${expected.registryOwner}; the harness passed ${report.owner}.`);
  }
  if (model === "arachnid") {
    if (!sameAddress(expected.deployer.address, ARACHNID_PROXY)) {
      problems.push(`the catalog's deployer is ${expected.deployer.address}, not Arachnid's proxy ${ARACHNID_PROXY}.`);
    }
    if (expected.deployer.codehash.toLowerCase() !== report.deployerCodehash) {
      problems.push(
        `the code at Arachnid's proxy address has codehash ${report.deployerCodehash}; the catalog expects ${expected.deployer.codehash}.`,
      );
    }
  }

  const actual = new Map(report.contracts.map((c) => [c.name, c]));
  const rows: Row[] = [];
  for (const want of expected.contracts) {
    const derived = arachnidAddress(want.salt, want.initCodeHash);
    if (!sameAddress(derived, want.address)) {
      problems.push(`the catalog's ${want.name} address ${want.address} isn't CREATE2 of its salt and init-code hash (${derived}).`);
    }
    const got = actual.get(want.name);
    actual.delete(want.name);
    if (!got) {
      rows.push({ name: want.name, status: "missing", detail: "in the catalog, but DeployRelease didn't release it" });
      continue;
    }
    if (model === "createx-raw" && want.name === FACTORY) {
      rows.push({
        name: want.name,
        status: "not-compared",
        detail: "its init code holds the registry's address, which differs under CreateX",
      });
      continue;
    }
    const address = addressUnder(model, want.salt, want.initCodeHash);
    const sameAt = sameAddress(address, got.address);
    const sameCode = want.codehash.toLowerCase() === got.codehash;
    const diff = [
      ...(sameAt ? [] : [`address ${address} → ${got.address}`]),
      ...(sameCode ? [] : [`codehash ${want.codehash} → ${got.codehash}`]),
    ].join(", ");
    if (diff === "") {
      rows.push({ name: want.name, status: "match", detail: got.address });
      continue;
    }
    if (want.knownGap === undefined) {
      rows.push({ name: want.name, status: "mismatch", detail: diff });
      continue;
    }
    const gap = checkKnownGap({ ...want, knownGap: want.knownGap }, report, got.address, model);
    rows.push(
      gap.ok
        ? { name: want.name, status: "known-gap", detail: `${diff}; ${gap.value}` }
        : { name: want.name, status: "mismatch", detail: `${diff}; not only the unpinned library: ${gap.error}` },
    );
  }
  for (const extra of actual.values()) {
    rows.push({ name: extra.name, status: "extra", detail: `DeployRelease released it at ${extra.address}, but the catalog has no entry` });
  }
  return { model, problems, rows };
}

/** Whether a comparison fails the suite: any run-level problem, mismatch, missing or extra contract. */
export function failed(c: Comparison): boolean {
  return c.problems.length > 0 || c.rows.some((r) => r.status === "mismatch" || r.status === "missing" || r.status === "extra");
}

/** The report lines, in the golden suite's `expected → Lattice now` style. Matches are counted, not listed. */
export function formatComparison(c: Comparison): string[] {
  const count = (s: RowStatus) => c.rows.filter((r) => r.status === s).length;
  const compared = c.rows.filter((r) => r.status !== "not-compared" && r.status !== "extra").length;
  const where =
    c.model === "arachnid"
      ? "are at the catalog's addresses"
      : "are where the catalog's salts and init-code hashes put them through CreateX";
  const lines = [`${count("match")} of ${compared} shared contracts ${where}.`];
  for (const p of c.problems) lines.push(`  ${p}`);
  const label: Record<Exclude<RowStatus, "match">, string> = {
    mismatch: "differs",
    missing: "missing",
    extra: "extra",
    "known-gap": "known Lattice gap",
    "not-compared": "not compared",
  };
  for (const status of ["mismatch", "missing", "extra", "known-gap", "not-compared"] as const) {
    for (const r of c.rows.filter((row) => row.status === status)) lines.push(`  ${r.name}: ${label[status]}: ${r.detail}`);
  }
  return lines;
}
