import type { Catalog, Facet } from "../model/catalog";
import { isAddress, isHexAnyCase, toChecksum, toLowerHex, type Address, type Hex, type Hex4 } from "../model/hex";
import type { Recipe } from "../model/recipe";
import { err, ok, type Result } from "../model/result";

/** Raw routing has no inferred ABI, namespace, initializer or authority metadata. */
export type UpgradeRawFacet = {
  id: string;
  kind: "foreign" | "self" | "extra";
  address: Address;
  codehash: Hex;
  selectors: Hex4[];
};

export type UpgradeResolution = { catalog: Catalog; raw: UpgradeRawFacet[] };

/**
 * A local view of verified known instances. Only a matching pinned runtime hash earns catalog metadata;
 * its release address is replaced by the actual instance. Raw rows stay separate. The bundled catalog
 * and every object it contains remain untouched. Alias dependencies/seams retain all placed instances.
 */
export function projectUpgradeCatalog(recipe: Recipe, catalog: Catalog): Result<UpgradeResolution, string> {
  if (recipe.mode !== "upgrade") return err("The recipe isn't an upgrade plan.");
  if (recipe.catalog.hash.toLowerCase() !== catalog.hash.toLowerCase()) return err("The upgrade plan needs its pinned catalog.");
  const originals = catalog.facets.filter((facet) => !facet.name.startsWith("onchain:"));
  const aliases: Facet[] = [];
  const raw: UpgradeRawFacet[] = [];
  const names = new Map<string, string[]>();
  for (const [id, instance] of Object.entries(recipe.facetInstances ?? {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    if (!isAddress(instance.address) || id !== `onchain:${instance.address.toLowerCase()}` || !recipe.facets.includes(id)
      || !isHexAnyCase(instance.codehash) || instance.codehash.length !== 66) return err("The upgrade recipe has invalid facet descriptors.");
    if (/^0x0{40}$/.test(instance.address.toLowerCase())) return err("An on-chain facet must have a nonzero address.");
    const address = toChecksum(instance.address);
    const codehash = toLowerHex(instance.codehash);
    if (instance.kind !== "known") {
      if (instance.selectors.length === 0) return err("A raw facet must contain selectors; remove its whole instance instead.");
      raw.push({ id, kind: instance.kind, address, codehash, selectors: instance.selectors.map(toLowerHex) });
      continue;
    }
    const known = originals.find((facet) => facet.name === instance.catalogFacet);
    if (known === undefined || known.release.codehash.toLowerCase() !== codehash) return err("A known facet instance doesn't match its pinned catalog runtime hash.");
    if (instance.extraSelectors.some((selector) => known.selectors.some((entry) => entry.hex.toLowerCase() === selector.toLowerCase()))) {
      return err("Raw extra selectors must be outside the known facet's catalog exports.");
    }
    const init = known.init ?? catalog.inits.find((spec) => spec.name === `${known.name}Init`)?.name;
    aliases.push({ ...known, name: id, ...(init === undefined ? {} : { init }), release: { ...known.release, address, codehash } });
    names.set(known.name, [...(names.get(known.name) ?? []), id]);
    if (instance.extraSelectors.length > 0) raw.push({ id, kind: "extra", address, codehash, selectors: instance.extraSelectors.map(toLowerHex) });
  }
  const placed = new Set(recipe.facets);
  for (const facet of originals.filter((facet) => placed.has(facet.name))) {
    if (Object.values(recipe.facetInstances ?? {}).some((instance) => instance.address.toLowerCase() === facet.release.address.toLowerCase())) {
      return err("An actual facet address cannot also be placed as a separate catalog release.");
    }
  }
  const equivalents = (name: string): string[] => [name, ...(names.get(name) ?? [])];
  const facets = [...originals, ...aliases].map((facet) => ({
    ...facet,
    requires: facet.requires.map((requirement) => ({ ...requirement, anyOf: [...new Set(requirement.anyOf.flatMap(equivalents))] })),
  }));
  const seams = catalog.seams.map((seam) => ({
    ...seam,
    when: seam.when.map((name) => equivalents(name).find((candidate) => placed.has(candidate)) ?? name),
    anyOf: [...new Set(seam.anyOf.flatMap(equivalents))],
  }));
  return ok({ catalog: { ...catalog, facets, seams }, raw });
}
