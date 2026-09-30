import { LOUPE_SELECTORS, SUPPORTS_INTERFACE_SELECTOR } from "../checks/core";
import { planInit } from "../init/plan";
import type { CoreStatusFn, IsCoreFacetFn } from "../model/api";
import type { Catalog } from "../model/catalog";
import { CORE_FACETS } from "../model/diamond";
import type { Hex4 } from "../model/hex";
import type { Recipe } from "../model/recipe";

export const isCoreFacet: IsCoreFacetFn = (name) => (CORE_FACETS as readonly string[]).includes(name);

/** The ids DiamondIntrospectionInit registers: IERC165 and IDiamondLoupe always, IDiamondCut with an upgrade mechanism. */
const INTERFACES: readonly { id: Hex4; name: string; upgradeable?: true }[] = [
  { id: "0x01ffc9a7", name: "IERC165" },
  { id: "0x48e2b093", name: "IDiamondLoupe" },
  { id: "0x1f931c1c", name: "IDiamondCut", upgradeable: true },
];

function cutFacets(recipe: Recipe, catalog: Catalog): string[] {
  return recipe.facets.filter((name) => catalog.facets.find((facet) => facet.name === name)?.family === "upgrade");
}

/** Steps always register (a step does, or the automatic step); a bundle only when its spec says so. */
function registersInterfaces(recipe: Recipe, catalog: Catalog): boolean {
  const init = recipe.init;
  if (init.kind === "none") return false;
  if (init.kind === "steps") return true;
  return catalog.inits.find((spec) => spec.name === init.spec)?.registersInterfaces === true;
}

export const coreStatus: CoreStatusFn = (recipe, catalog, analysis) => {
  const routes = (hex: Hex4) => analysis.routing[hex]?.owner !== undefined;
  const cut = cutFacets(recipe, catalog);
  const loupe = LOUPE_SELECTORS.map((selector) => selector.hex);
  const upgradeable = cut.length > 0;
  return {
    fallback: { ...analysis.stats },
    loupe: { selectors: loupe, covered: loupe.filter(routes) },
    erc165: {
      covered: routes(SUPPORTS_INTERFACE_SELECTOR),
      interfaceIds: registersInterfaces(recipe, catalog)
        ? INTERFACES.filter((entry) => !entry.upgradeable || upgradeable).map(({ id, name }) => ({ id, name }))
        : [],
    },
    cut: { facet: cut[0] ?? null, conflict: cut.length > 1, immutable: recipe.immutable === true },
    init: planInit(recipe, catalog).steps.map((step) => step.spec),
    plan: {
      fixed: analysis.plan.filter((entry) => isCoreFacet(entry.facet)),
      rest: analysis.plan.filter((entry) => !isCoreFacet(entry.facet)),
    },
  };
};
