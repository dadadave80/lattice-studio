import type { Catalog } from "./catalog";
import type { ChainState, Refs } from "./chain";
import type { Address, Hex, Hex4 } from "./hex";
import type { Problem } from "./problems";
import type { Recipe } from "./recipe";

/**
 * Derived on every edit, never stored (spec L260-L267).
 * `plan` holds `PlanEntry` rows: the spec's `{ facet, address, selectors }` plus `codehash` and the pinned
 * `version` (contracts §3.1), which the review and every export show (spec L855).
 */
export type Analysis = {
  recipeHash: Hex;
  routing: Record<Hex4, { owner?: string; contenders: string[]; via: "only" | "seam" | "default" | "chosen" }>;
  /** Blockers, then warnings, then info; catalog order within. */
  problems: Problem[];
  /** One Add per facet with ≥ 1 routed selector, in catalog order. */
  plan: PlanEntry[];
  /** `data` once a deploy context resolves every ref. */
  init: { target: Address; data?: Hex; refs: ("self" | "deployer")[] } | null;
  /**
   * `facets` counts cards: the recipe's facets without the core (DiamondLoupeFacet, ERC165Facet). `routed`,
   * `exported` and `excluded` count selectors and include the core's five, so a core-only recipe routes 5.
   */
  stats: { facets: number; routed: number; exported: number; excluded: number; namespaces: number };
};

/**
 * What lives beside the recipe (spec L268-L272).
 * Additions: `chain` (contracts §3.1), `refs`, `unconfirmedFrom` and `knownFrom`. `known` holds `project.predicted` and every recorded deployment address;
 * `unconfirmed` holds authority paths whose provenance is `link` or `file`.
 */
export type AnalysisContext = {
  /** Resolves refs; enables NET checks. */
  deploy?: { chainId: number; path: "factory" | "createx"; from: Address; salt: Hex };
  /** Earlier predictions and recorded deployments (AUTH-02). */
  known: Address[];
  /** Argument paths that came from a link or file (LINK-01). */
  unconfirmed: string[];
  /**
   * Where each `unconfirmed` path came from, keyed by argument path (S1 fills it from `project.provenance`).
   * LINK-01 names the source from it.
   */
  unconfirmedFrom?: Record<string, "link" | "file">;
  /**
   * What each `known` address is, keyed by lowercase address (S1 fills it from `project.predicted` and the
   * deployment records). AUTH-02 words its message from it.
   */
  knownFrom?: Record<string, { source: "prediction" | "deployment"; chainId: number; chain?: string }>;
  /** The selected chain's probes, for the NET checks. */
  chain?: ChainState;
  /**
   * What "This diamond" and "Deploying account" resolve to for `deploy` (S1 fills it). C4c uses it for
   * `AuthorityRow.resolved` and to never raise AUTH-01 for this diamond's own predicted address.
   */
  refs?: Refs;
};

/** `Analysis["routing"]` (contracts §3.1). */
export type Routing = Analysis["routing"];

/** One selector's routing. */
export type Route = Routing[Hex4];

/** How a selector's owner was decided (spec L302-L303). */
export type Via = Route["via"];

/** One Add per facet that routes at least one selector (contracts §3.1). */
export type PlanEntry = {
  facet: string;
  address: Address;
  codehash: Hex;
  /** The pinned version; the review and every export show it (spec L855). */
  version: string;
  /** Routed selectors, in the facet's own order. */
  selectors: Hex4[];
};

/** C5a `buildPlan`'s result: the Adds, plus placed facets that route nothing (for exports). */
export type CutPlan = { entries: PlanEntry[]; omitted: string[] };

/**
 * The plan against a diamond's `facets()`, per facet as sets: LatticeFactory applies registry cuts before
 * custom cuts, so `facets()` order differs from the plan's (contracts §3.1).
 */
export type PlanComparison = {
  matches: boolean;
  missing: { facet: string; selectors: Hex4[] }[];
  extra: { address: Address; selectors: Hex4[] }[];
  moved: { selector: Hex4; expected: Address; actual: Address }[];
};

/** What every check reads (contracts §3.4). */
export type CheckInput = {
  recipe: Recipe;
  catalog: Catalog;
  routing: Routing;
  ctx: AnalysisContext;
};

/**
 * A check: sel, sem, core, dep, sto, init, auth, link or net (contracts §3.4). Checks build problems with
 * `message: ""` (the `problem()` builder does); `runChecks` renders every message in one place with
 * narrate's `renderProblem(code, params)`.
 */
export type Check = (input: CheckInput) => Problem[];

/** The check files, in the order `runChecks` calls them. */
export type CheckName = "sel" | "sem" | "core" | "dep" | "sto" | "init" | "auth" | "link" | "net";

/** C2 `analyze` options. `checks` replaces the registry's checks, so tests can inject fakes. */
export type AnalyzeOptions = { checks?: readonly Check[] };

/** C5a `recipeStats`: "12 facets · 120 selectors" (cards; selectors include the core's five) and per-facet "12/17 selectors" (spec L685). */
export type RecipeStats = {
  facets: number;
  selectors: number;
  /** "12 facets · 120 selectors". */
  text: string;
  perFacet: Record<string, { routed: number; exported: number; text: string }>;
};
