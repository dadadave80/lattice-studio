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

/** One contract the harness saw `release()` return. */
export type ReleasedContract = { name: string; address: Address; codehash: Hex };

/** Everything the harness logged: the release version, the owner it passed and what came back. */
export type ReleaseReport = {
  version: string;
  owner: Address;
  /** Runtime codehash at Arachnid's proxy address on the test chain. */
  deployerCodehash: Hex;
  /** Registry, factory, then the facets in FacetInventory order. */
  contracts: ReleasedContract[];
};

/**
 * Reads the harness's `STUDIO_RELEASE` lines and ignores everything else `release()` prints. Exactly one header
 * first, then one `contract` line per name; anything malformed is an error naming the line.
 */
export function parseReleaseLogs(lines: readonly string[]): Result<ReleaseReport, string> {
  let header: Omit<ReleaseReport, "contracts"> | undefined;
  const contracts: ReleasedContract[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] !== TAG) continue;
    const kind = parts[1];
    if (kind === "header") {
      const [, , version, owner, codehash] = parts;
      if (parts.length !== 5 || !version || !owner || !isAddress(owner) || !codehash || !HASH32.test(codehash)) {
        return err(`malformed header line "${line}".`);
      }
      if (header) return err("the harness logged two headers.");
      header = { version, owner: getAddress(owner), deployerCodehash: codehash.toLowerCase() as Hex };
      continue;
    }
    if (kind === "contract") {
      const [, , name, address, codehash] = parts;
      if (parts.length !== 5 || !name || !address || !isAddress(address) || !codehash || !HASH32.test(codehash)) {
        return err(`malformed contract line "${line}".`);
      }
      if (!header) return err(`a contract line came before the header: "${line}".`);
      if (seen.has(name)) return err(`the harness reported ${name} twice.`);
      seen.add(name);
      contracts.push({ name, address: getAddress(address), codehash: codehash.toLowerCase() as Hex });
      continue;
    }
    return err(`unknown line "${line}".`);
  }
  if (!header) return err("the harness logged no header.");
  if (contracts.length === 0) return err("the harness reported no contracts.");
  return ok({ ...header, contracts });
}

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
   * #5): a divergence is a known Lattice gap, not a Studio bug, and doesn't fail the suite. Says why.
   */
  knownGap?: string;
};

/** What the catalog says DeployRelease should produce. */
export type ExpectedRelease = {
  registryOwner: Address;
  deployer: { address: Address; codehash: Hex };
  /** Registry, factory, then the facets in catalog order. */
  contracts: ExpectedContract[];
};

/** The fields of a catalog `SharedContract` this suite reads. */
export type SharedRelease = Pick<SharedContract, "salt" | "version" | "address" | "codehash" | "initCodeHash" | "dependsOn" | "provisional">;

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

/** The registry, the factory and every facet from the catalog, with known gaps marked. */
export function expectedFromCatalog(catalog: CatalogRelease): ExpectedRelease {
  const provisionalLibraries = new Set(
    (catalog.libraries ?? []).filter((l) => l.release.provisional !== undefined).map((l) => l.name),
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
    if (deps.length > 0 && deps.every((d) => provisionalLibraries.has(d))) {
      e.knownGap = `links ${deps.join(", ")}, which Lattice doesn't pin yet, so the catalog links Studio's own release of it`;
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
 * registry's address, which differs between the two deployers. Every runtime codehash must match too.
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
    ];
    if (diff.length === 0) rows.push({ name: want.name, status: "match", detail: got.address });
    else if (want.knownGap !== undefined) rows.push({ name: want.name, status: "known-gap", detail: `${diff.join(", ")}; ${want.knownGap}` });
    else rows.push({ name: want.name, status: "mismatch", detail: diff.join(", ") });
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
