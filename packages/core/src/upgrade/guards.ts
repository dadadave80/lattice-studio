import type { Catalog } from "../model/catalog";
import type { Hex4 } from "../model/hex";
import type { Project } from "../model/project";

/** Raw selector groups remain locked even after their card was removed from the desired recipe. */
export function upgradeSelectorRefusal(project: Project, catalog: Catalog, selector: Hex4): string | null {
  if (project.recipe.mode !== "upgrade") return null;
  if (project.upgrade === undefined) return "The upgrade plan is missing its pinned origin.";
  const origin = project.upgrade;
  const selected = selector.toLowerCase();
  // Enablement needs only the immutable observed row. Full reconstruction and descriptor validation
  // remain at plan analysis/execution, where every selector and instance must be checked together.
  for (const row of origin.facets) {
    if (!row.functionSelectors.some((value) => value.toLowerCase() === selected)) continue;
    const address = row.facetAddress.toLowerCase();
    if (address === origin.address.toLowerCase()) return "Functions built into the diamond are immutable and cannot be edited.";
    const codehash = Object.entries(origin.codehashes).find(([key]) => key.toLowerCase() === address)?.[1];
    if (codehash === undefined) return "The baseline is missing a facet runtime code hash.";
    const known = catalog.facets.find((facet) => facet.release.codehash.toLowerCase() === codehash.toLowerCase());
    if (!known?.selectors.some((entry) => entry.hex.toLowerCase() === selected)) {
      return "Raw selectors cannot be edited individually. Remove their whole facet instance instead.";
    }
  }
  return null;
}
