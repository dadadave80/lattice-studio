/**
 * The core (the pinned diamond): the proxy's fallback, DiamondLoupeFacet and ERC165Facet. `isCoreFacet` and
 * `isCoreOnly` name it; `coreStatus` reads it for the core cell, the Diamond view and the console's `core` verb.
 */
import { LOUPE_SELECTORS, SUPPORTS_INTERFACE_SELECTOR } from "../checks/core";
import { planInit } from "../init/plan";
import { hasUpgradeMechanism } from "../init/plan/specs";
import type { PlanEntry } from "../model/analysis";
import type { CoreStatusFn, IsCoreFacetFn, IsCoreOnlyFn } from "../model/api";
import type { Catalog } from "../model/catalog";
import { CORE_FACETS } from "../model/diamond";
import type { Hex4 } from "../model/hex";
import type { InitStepView } from "../model/init";

export const isCoreFacet: IsCoreFacetFn = (name) => (CORE_FACETS as readonly string[]).includes(name);

export const isCoreOnly: IsCoreOnlyFn = (recipe) => recipe.facets.every(isCoreFacet);

/** The five selectors the core serves: the loupe's four (R2's order) and `supportsInterface`. Never excluded. */
export const CORE_SELECTORS: readonly Hex4[] = [...LOUPE_SELECTORS.map((selector) => selector.hex), SUPPORTS_INTERFACE_SELECTOR];

type InterfaceId = { id: Hex4; name: string };

/** The ERC-165 ids an init plan can register, in the order the readout lists them. */
const IERC165: InterfaceId = { id: "0x01ffc9a7", name: "IERC165" };
const IDIAMOND_LOUPE: InterfaceId = { id: "0x48e2b093", name: "IDiamondLoupe" };
const IDIAMOND_CUT: InterfaceId = { id: "0x1f931c1c", name: "IDiamondCut" };
const INTERFACES: readonly InterfaceId[] = [IERC165, IDIAMOND_LOUPE, IDIAMOND_CUT];

/**
 * What one step of the init plan registers (lattice/src/utils/DiamondIntrospectionInit.sol): a step that
 * initializes ERC165 sets IERC165's own id; the automatic introspection step, or a step whose spec registers the
 * interfaces itself, sets IDiamondLoupe and, with an upgrade mechanism placed, IDiamondCut.
 */
function registeredBy(step: InitStepView, catalog: Catalog, upgradeable: boolean): InterfaceId[] {
  const spec = catalog.inits.find((candidate) => candidate.name === step.spec);
  const out: InterfaceId[] = [];
  if (spec?.initializes.some((entry) => entry.module === "ERC165")) out.push(IERC165);
  if (step.automatic !== undefined || spec?.registersInterfaces === true) {
    out.push(IDIAMOND_LOUPE);
    if (upgradeable) out.push(IDIAMOND_CUT);
  }
  return out;
}

/** The core's plan entries in CORE_FACETS order, then everything else in plan order. */
function splitPlan(plan: readonly PlanEntry[]): { fixed: PlanEntry[]; rest: PlanEntry[] } {
  const order = (entry: PlanEntry): number => (CORE_FACETS as readonly string[]).indexOf(entry.facet);
  return {
    fixed: plan.filter((entry) => isCoreFacet(entry.facet)).sort((a, b) => order(a) - order(b)),
    rest: plan.filter((entry) => !isCoreFacet(entry.facet)),
  };
}

export const coreStatus: CoreStatusFn = (recipe, catalog, analysis) => {
  const routes = (selector: Hex4): boolean => analysis.routing[selector]?.owner !== undefined;
  const loupe = LOUPE_SELECTORS.map((selector) => selector.hex);
  const placed = new Set(recipe.facets);
  // Catalog order: the raw recipe may list its facets in placement order.
  const cut = catalog.facets.filter((facet) => facet.family === "upgrade" && placed.has(facet.name)).map((facet) => facet.name);
  const upgradeable = hasUpgradeMechanism(recipe.facets, catalog);
  const steps = planInit(recipe, catalog).steps;
  const registered = new Set(steps.flatMap((step) => registeredBy(step, catalog, upgradeable)).map((entry) => entry.id));
  return {
    fallback: { ...analysis.stats },
    loupe: { selectors: loupe, covered: loupe.filter(routes) },
    erc165: {
      covered: routes(SUPPORTS_INTERFACE_SELECTOR),
      interfaceIds: INTERFACES.filter((entry) => registered.has(entry.id)).map(({ id, name }) => ({ id, name })),
    },
    cut: { facet: cut[0] ?? null, rivals: cut.slice(1), conflict: cut.length > 1, immutable: recipe.immutable === true },
    init: steps.map((step) => step.spec),
    plan: splitPlan(analysis.plan),
  };
};
