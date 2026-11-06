import { normalizeRecipe } from "../canonical/normalize";
import type { Catalog } from "../model/catalog";
import { isAddress, isHexAnyCase, toChecksum, toLowerHex, type Hex, type Hex4 } from "../model/hex";
import type { UpgradeOrigin } from "../model/project";
import type { FacetInstance, Recipe } from "../model/recipe";
import { err, ok, type Result } from "../model/result";
import { buildUpgradeCuts } from "./cuts";

/** Reconstruct only the observed routing. Original initialization is never inferred or replayed. */
export function reconstructUpgrade(origin: UpgradeOrigin, catalog: Catalog): Result<Recipe, string> {
  if (!Number.isSafeInteger(origin.chainId) || origin.chainId <= 0 || !Number.isSafeInteger(origin.block) || origin.block < 0
    || !isHexAnyCase(origin.blockHash) || origin.blockHash.length !== 66 || (origin.owner !== null && !isAddress(origin.owner))) return err("The upgrade origin needs a valid chain, block, block hash and observed owner.");
  const checked = buildUpgradeCuts({ diamond: origin.address, current: origin.facets, desired: origin.facets, locked: [] });
  if (!checked.ok) return checked;
  const hashes = new Map<string, Hex>();
  for (const [address, hash] of Object.entries(origin.codehashes)) {
    if (!isAddress(address) || !isHexAnyCase(hash) || hash.length !== 66) return err("Every observed instance needs its address and runtime code hash.");
    const previous = hashes.get(address.toLowerCase());
    if (previous !== undefined && previous !== hash.toLowerCase()) return err("The baseline has conflicting runtime code hashes.");
    hashes.set(address.toLowerCase(), toLowerHex(hash));
  }
  if (!hashes.has(origin.address.toLowerCase())) return err("The baseline is missing the diamond's runtime code hash.");
  const facets: string[] = [];
  const facetInstances: Record<string, FacetInstance> = {};
  const owners: Record<Hex4, string> = {};
  const exported = new Set<Hex4>();
  for (const row of [...origin.facets].sort((a, b) => a.facetAddress.toLowerCase() < b.facetAddress.toLowerCase() ? -1 : 1)) {
    const address = toChecksum(row.facetAddress);
    const codehash = hashes.get(address.toLowerCase());
    if (codehash === undefined) return err("The baseline is missing a facet runtime code hash.");
    const selectors = row.functionSelectors.map(toLowerHex);
    const id = `onchain:${address.toLowerCase()}`;
    facets.push(id);
    for (const selector of selectors) owners[selector] = id;
    const known = address.toLowerCase() === origin.address.toLowerCase() ? undefined : catalog.facets.find((facet) => facet.release.codehash.toLowerCase() === codehash);
    if (known === undefined) {
      facetInstances[id] = { kind: address.toLowerCase() === origin.address.toLowerCase() ? "self" : "foreign", address, codehash, selectors };
    } else {
      const knownSelectors = new Set(known.selectors.map((selector) => toLowerHex(selector.hex)));
      for (const selector of knownSelectors) exported.add(selector);
      facetInstances[id] = { kind: "known", address, codehash, catalogFacet: known.name, extraSelectors: selectors.filter((selector) => !knownSelectors.has(selector)) };
    }
  }
  return ok(normalizeRecipe({ schemaVersion: 1, catalog: { tag: catalog.lattice.tag, hash: catalog.hash },
    facets, owners, exclude: [...exported].filter((selector) => owners[selector] === undefined), init: { kind: "none" }, mode: "upgrade", facetInstances,
  }, catalog));
}
