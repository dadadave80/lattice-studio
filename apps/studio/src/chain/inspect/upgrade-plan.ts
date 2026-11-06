import {
  err, isAddress, ok, reconstructUpgrade, type Address, type Catalog, type Project, type Recipe, type Result, type UpgradeOrigin,
} from "@lattice-studio/core";
import { keccak256 } from "viem";
import type { ChainInfo } from "@/contracts/chain";
import type { DiamondSnapshot, SnapshotReadError } from "./snapshot";
import type { InspectionTarget } from "./engine";

export type UpgradePlanPorts = {
  chains: readonly Pick<ChainInfo, "id" | "testnet">[];
  current(): Project;
  inspect(target: InspectionTarget, signal: AbortSignal): Promise<Result<DiamondSnapshot, SnapshotReadError>>;
  /** Already integrity-checked bundled catalogs, default first. Inspection never changes the current pin. */
  catalogs(): Promise<Result<readonly Catalog[], string>>;
  layout(recipe: Recipe, catalog: Catalog, origin: UpgradeOrigin, current: Project): Project["layout"];
  create(recipe: Recipe, name: string, options: { upgrade: UpgradeOrigin; layout: Project["layout"] }): Promise<Result<Project, string>>;
  activate(project: Project, catalog: Catalog): void;
};

/** Most actual instances identified; the default-first order breaks ties, including all-foreign diamonds. */
export function selectUpgradeCatalog(snapshot: DiamondSnapshot, diamond: Address, catalogs: readonly Catalog[]): Catalog | null {
  let best: Catalog | null = null;
  let score = -1;
  for (const catalog of catalogs) {
    const hashes = new Set(catalog.facets.map((facet) => facet.release.codehash.toLowerCase()));
    const matches = (snapshot.facets ?? []).filter((row) => row.facetAddress.toLowerCase() !== diamond.toLowerCase()
      && hashes.has(snapshot.codehashes[row.facetAddress.toLowerCase()]?.toLowerCase() ?? "")).length;
    if (matches > score) { best = catalog; score = matches; }
  }
  return best;
}

/** Creates a separate, atomically saved project; every mutable workspace side effect follows its successful save. */
export async function createUpgradePlan(target: InspectionTarget, ports: UpgradePlanPorts, signal?: AbortSignal): Promise<Result<Project, string>> {
  if (!Number.isSafeInteger(target.chainId) || !isAddress(target.address) || !ports.chains.some((chain) => chain.id === target.chainId && chain.testnet)) {
    return err("Choose a supported testnet and valid diamond address.");
  }
  const before = ports.current();
  const aborted = () => signal?.aborted || ports.current() !== before;
  if (aborted()) return err("Creating the upgrade plan was canceled.");
  try {
    const [read, catalogs] = await Promise.all([ports.inspect(target, signal ?? new AbortController().signal), ports.catalogs()]);
    if (aborted()) return err("The current project changed. Open the diamond as a plan again.");
    if (!read.ok) return err(read.error.reason);
    if (!catalogs.ok) return catalogs;
    const snapshot = read.value;
    if (snapshot.code === "0x" || snapshot.facets === null) return err("Inspect a deployed diamond with a readable loupe before editing it as a plan.");
    const catalog = selectUpgradeCatalog(snapshot, target.address, catalogs.value);
    if (catalog === null) return err("No verified catalog is available to create the upgrade plan.");
    const origin: UpgradeOrigin = {
      chainId: target.chainId, address: target.address, block: snapshot.block, blockHash: snapshot.blockHash,
      facets: structuredClone(snapshot.facets), codehashes: { ...snapshot.codehashes, [target.address.toLowerCase()]: keccak256(snapshot.code) }, owner: snapshot.owner,
    };
    const reconstructed = reconstructUpgrade(origin, catalog);
    if (!reconstructed.ok) return reconstructed;
    const name = `Upgrade ${target.address.slice(0, 8)}…${target.address.slice(-4)}`;
    const layout = ports.layout(reconstructed.value, catalog, origin, before);
    if (aborted()) return err("The current project changed. Open the diamond as a plan again.");
    const created = await ports.create(reconstructed.value, name, { upgrade: origin, layout });
    if (!created.ok) return created;
    try { ports.activate(created.value, catalog); }
    catch { return err("The upgrade plan was saved, but its workspace couldn't be opened. Open it from Projects."); }
    return ok(created.value);
  } catch { return err("The upgrade plan couldn't be prepared or saved. Check the connection and browser storage, then retry."); }
}
