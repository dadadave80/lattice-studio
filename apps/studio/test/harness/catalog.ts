/**
 * The fixture catalog for component tests (`fixtures/catalog/fixture/index.json`, written by K3), bundled
 * into the test through Vite so it loads synchronously in the browser. Until K3 lands, a small stand-in
 * tagged "fixture" built with core's test builders takes its place.
 */
import type { Catalog } from "@lattice-studio/core";
import { validateCatalog } from "@lattice-studio/core";
import { makeCatalog, makeFacet } from "@lattice-studio/core/testing";

const indexes: Record<string, unknown> = import.meta.glob("../../../../fixtures/catalog/*/index.json", {
  eager: true,
  import: "default",
});

/** A stand-in with two facets, used only while the fixture catalog doesn't exist. */
function standIn(id: string): Catalog {
  return makeCatalog({
    lattice: { tag: id, commit: "0".repeat(40) },
    facets: [
      makeFacet({ name: "DiamondLoupeFacet", area: "diamond", selectors: ["facets()", "facetAddresses()"] }),
      makeFacet({ name: "ERC20", area: "tokens", selectors: ["transfer(address,uint256)", "balanceOf(address)"] }),
    ],
  });
}

const cache = new Map<string, Catalog>();

/** True once K3's fixture catalog `id` exists. */
export function hasFixtureCatalog(id = "fixture"): boolean {
  return Object.keys(indexes).some((path) => path.endsWith(`/catalog/${id}/index.json`));
}

/** The fixture catalog `id` ("fixture" or "fixture-next"), validated; the stand-in while it doesn't exist. */
export function fixtureCatalog(id = "fixture"): Catalog {
  const cached = cache.get(id);
  if (cached) return cached;
  const entry = Object.entries(indexes).find(([path]) => path.endsWith(`/catalog/${id}/index.json`));
  let catalog: Catalog;
  if (entry) {
    const parsed = validateCatalog(entry[1]);
    if (!parsed.ok) {
      const issues = parsed.error.map((i) => `${i.path || "(root)"} ${i.message}`).join("; ");
      throw new Error(`fixtures/catalog/${id}/index.json doesn't validate: ${issues}`);
    }
    catalog = parsed.value;
  } else {
    catalog = standIn(id);
  }
  cache.set(id, catalog);
  return catalog;
}
