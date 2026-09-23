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
};

/**
 * Reads the harness's `STUDIO_RELEASE` lines and ignores everything else `release()` prints. Exactly one header
 * first, then one `contract` line per name and at most one `code` line per name; anything malformed is an error
 * naming the line (shortened, since a code line holds a whole contract).
 */
export function parseReleaseLogs(lines: readonly string[]): Result<ReleaseReport, string> {
  let header: Omit<ReleaseReport, "contracts" | "creationCodes"> | undefined;
  const contracts: ReleasedContract[] = [];
  const creationCodes: Record<string, Hex> = {};
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
    return err(`unknown line "${shown}".`);
  }
  if (!header) return err("the harness logged no header.");
  if (contracts.length === 0) return err("the harness reported no contracts.");
  return ok({ ...header, contracts, creationCodes });
}

/** A contract whose catalog address links libraries Lattice doesn't pin yet. */
export type KnownGap = {
  /** The unpinned libraries and the addresses the catalog links for them (Studio's own releases). */
  libraries: { name: string; address: Address }[];
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
    (catalog.libraries ?? []).filter((l) => l.release.provisional !== undefined).map((l) => [l.name, l.release.address]),
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
      const gap: KnownGap = { libraries: deps.map((d) => ({ name: d, address: provisional.get(d) as Address })) };
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
 * Accepts a known-gap divergence only when it's explained by the unpinned libraries alone:
 * - the catalog's creation code hashes to its init-code hash;
 * - forge's creation code (what DeployRelease deployed) has the same length and differs from the catalog's only
 *   inside the 20-byte windows where the catalog's code holds a library's catalog address;
 * - every such window of one library holds the same address in forge's code;
 * - DeployRelease put the contract where forge's creation code lands under `model`.
 * Returns why otherwise.
 */
export function checkKnownGap(
  want: ExpectedContract & { knownGap: KnownGap },
  forgeCode: Hex | undefined,
  deployedAt: Address,
  model: DeployerModel,
): Result<string, string> {
  const catalogCode = want.knownGap.creationCode;
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
    const needle = lib.address.slice(2).toLowerCase();
    const forgeAddresses = new Set<string>();
    for (let at = a.indexOf(needle); at >= 0; at = a.indexOf(needle, at + 1)) {
      if (at % 2 !== 0) continue;
      masked.fill(1, at / 2, at / 2 + 20);
      forgeAddresses.add(b.slice(at, at + 40));
    }
    if (forgeAddresses.size === 0) return err(`the catalog's creation code doesn't link ${lib.name} at ${lib.address}`);
    if (forgeAddresses.size > 1) return err(`forge's creation code links ${lib.name} at ${forgeAddresses.size} different addresses`);
    linked.push(`${lib.name} at ${getAddress(`0x${[...forgeAddresses][0]}`)} instead of ${lib.address}`);
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
    `forge links ${linked.join(", ")}, which Lattice doesn't pin yet; the creation code is otherwise the catalog's`,
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
    const gap = checkKnownGap({ ...want, knownGap: want.knownGap }, report.creationCodes[want.name], got.address, model);
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
