/**
 * The public core API (contracts §3.4): one function type per public function. Each implementation file
 * declares `export const fn: FnType = …`, so its owner replaces the body and keeps the type.
 * Every function is pure and deterministic; `now` and `random` are injected where needed.
 */
import type {
  Analysis, AnalysisContext, AnalyzeOptions, Check, CheckInput, CutPlan, PlanComparison, PlanEntry, RecipeStats,
  Routing,
} from "./analysis";
import type { Catalog, Facet, InitParam, InitSpec, TemplateItem } from "./catalog";
import type {
  CreatexPredictArgs, DecodedRevert, DiamondDeploy, DiamondDeployArgs, FactoryPredictArgs, GasShare, LoupeFacet,
  MissingDeploys, MissingDeploysArgs, Random, Refs, RevertContext, Scope,
} from "./chain";
import type { ConsoleLineBuilders, CopyIssue, LineDraft, NarrateCause, Platform, RelativeTime, SelectorRef } from "./console";
import type { CoreStatus } from "./diamond";
import type { Address, Hex, Hex4 } from "./hex";
import type { ArgContext, AuthorityRow, DecodedInit, FieldModel, InitCall, InitPlan, Mechanism, MechanismChange, MechanismInputs, MechanismOptions } from "./init";
import type {
  BriefExportArgs, ExportFile, FoundryExportArgs, ImportedFile, Migrated, ParseIssue, ParseOptions, Parsed, SafeBatchArgs,
  SharedRecipe, ShareLink,
} from "./io";
import type { Json, JsonObject } from "./json";
import type {
  CardSize, CardSizeOptions, Layout, LayoutMetrics, NotePlacement, PlaceNotesArgs, Point, Rect,
  RouteTracesArgs, Size, Sizes, Trace,
} from "./layout";
import type { ProblemCode, Problem } from "./problems";
import type { Deployment, EditResult, Project, ProjectFile, ProjectStatus } from "./project";
import type { Arg, InitStep, RefName, Recipe } from "./recipe";
import type { Result } from "./result";
import type { WpId } from "./wp";

// ── canonical (C1) ─────────────────────────────────────────────────────────────────────────────────

/**
 * RFC 8785 canonical JSON: keys sorted by UTF-16 code units, ES number serialization, no whitespace.
 * Takes `unknown` so readonly structures (a viem ABI) pass in; values that aren't JSON (undefined, bigint,
 * functions, non-finite numbers) are rejected at runtime.
 */
export type CanonicalJsonFn = (value: unknown) => string;
/** Facets in catalog order, integers as decimal strings, hex lowercase, addresses EIP-55, refs symbolic (spec L283). */
export type NormalizeRecipeFn = (recipe: Recipe, catalog: Catalog) => Recipe;
/**
 * keccak256 of the canonical recipe without `$schema`, `name`, `template` and unknown fields (spec L283).
 * With `catalog` it normalizes first. Without `catalog`, the input MUST already be `normalizeRecipe`'s output:
 * the hash of an unnormalized recipe (facets out of catalog order, uppercase hex) is a different hash.
 */
export type RecipeHashFn = (recipe: Recipe, catalog?: Catalog) => Hex;
/** keccak256 of the canonical catalog index without its `hash` field. */
export type CatalogHashFn = (index: Catalog | Omit<Catalog, "hash">) => Hex;
/** Validates, migrates and normalizes a recipe; errors as `{ path, message }` (spec L501). */
export type ParseRecipeFn = (json: unknown, opts: ParseOptions) => Result<Parsed<Recipe>, ParseIssue[]>;
export type ParseProjectFn = (json: unknown, opts: ParseOptions) => Result<Parsed<Project>, ParseIssue[]>;
export type ParseProjectFileFn = (json: unknown, opts: ParseOptions) => Result<Parsed<ProjectFile>, ParseIssue[]>;
/**
 * Forward-only migrations keyed by `schemaVersion`. A newer version fails with
 * "This file needs Studio schema v2. This Studio reads v1."
 */
export type MigrateFn = (json: unknown) => Result<Migrated, string>;

// ── analysis (C2) ──────────────────────────────────────────────────────────────────────────────────

/** Routing, problems, the cut plan, the init call and stats (spec L296). */
export type AnalyzeFn = (recipe: Recipe, catalog: Catalog, ctx?: AnalysisContext, options?: AnalyzeOptions) => Analysis;
/** Who serves every exported selector of the placed facets (spec L302-L303). */
export type ComputeRoutingFn = (recipe: Recipe, catalog: Catalog) => Routing;
/** Severity, then catalog order of the first facet anchor, then code, then anchor (spec L300). */
export type SortProblemsFn = (problems: readonly Problem[], catalog: Catalog) => Problem[];

// ── checks (C2, C3, C4a, C4c, C6) ──────────────────────────────────────────────────────────────────

/** Runs the checks in the order sel, sem, core, dep, sto, init, auth, link, net; `checks` replaces them. */
export type RunChecksFn = (input: CheckInput, checks?: readonly Check[]) => Problem[];

// ── init/plan (C4a) ────────────────────────────────────────────────────────────────────────────────

export type PlanInitFn = (recipe: Recipe, catalog: Catalog) => InitPlan;
/** Stable topological sort satisfying every `after` constraint; unchanged when already valid. */
export type AutoOrderFn = (steps: readonly InitStep[], catalog: Catalog) => InitStep[];
/** `at` is the step's path ("bundle", "steps[2]"), prefixed to the field's path. */
export type FieldModelFn = (spec: InitSpec, param: InitParam, at?: string) => FieldModel;
/** Ok with the value to store (addresses checksummed); an error in the spec's voice otherwise. */
export type ValidateArgFn = (field: FieldModel, value: Arg | undefined, ctx: ArgContext) => Result<Arg, string>;

// ── init/encode (C4b) ──────────────────────────────────────────────────────────────────────────────

export type ResolveRefsFn = (args: Record<string, Arg>, refs: Refs) => Result<Record<string, Arg>, string>;
/** The references the recipe's init uses, each once, in first-use order. */
export type CollectRefsFn = (recipe: Recipe) => RefName[];
/** bundle → the bundle's init call; steps → `multiInit(address[],bytes[])`; none → zero target and "0x". */
export type EncodeInitFn = (plan: InitPlan, catalog: Catalog, refs: Refs) => Result<InitCall, string>;
/** `refs`, when given, marks arguments that equal a resolved reference. */
export type DecodeInitFn = (data: Hex, catalog: Catalog, refs?: Refs) => Result<DecodedInit, string>;

// ── authority (C4c) ────────────────────────────────────────────────────────────────────────────────

export type AuthorityTableFn = (recipe: Recipe, catalog: Catalog, ctx?: AnalysisContext) => AuthorityRow[];
export type MechanismOptionsFn = (recipe: Recipe, catalog: Catalog) => MechanismOptions;
export type PlanMechanismChangeFn = (
  recipe: Recipe,
  catalog: Catalog,
  choice: Mechanism,
  inputs: MechanismInputs,
) => Result<MechanismChange, string>;

// ── diamond (C2) ───────────────────────────────────────────────────────────────────────────────────

/** DiamondLoupeFacet and ERC165Facet: in every recipe, never on the sheet, first in the cut plan. */
export type IsCoreFacetFn = (name: string) => boolean;
/** True when nothing but the core is in the recipe: the sheet is empty. */
export type IsCoreOnlyFn = (recipe: Pick<Recipe, "facets">) => boolean;
/** The diamond's fixed part for the core cell, the Diamond view and the console's `core` verb. */
export type CoreStatusFn = (recipe: Recipe, catalog: Catalog, analysis: Analysis) => CoreStatus;

// ── plan (C5a) ─────────────────────────────────────────────────────────────────────────────────────

export type BuildPlanFn = (recipe: Recipe, catalog: Catalog, routing: Routing) => CutPlan;
/** Per facet as sets; order never matters. */
export type ComparePlanFn = (plan: readonly PlanEntry[], facets: readonly LoupeFacet[]) => PlanComparison;
export type TemplateListFn = (catalog: Catalog) => TemplateItem[];
/** Copies facets, owners, exclusions and init with examples; sets `template: { name, catalogHash }`. */
export type LoadTemplateFn = (catalog: Catalog, name: string) => Result<Recipe, string>;
/** DiamondLoupeFacet, ERC165Facet, Receive, AccessControl, AccessControlDiamondCut; admin `{$ref:"deployer"}` (spec L990). */
export type BlankDiamondFn = (catalog: Catalog) => Recipe;
/** `chainName` labels stamps ("Live · Sepolia · r1"); without it the chain reads "Chain <id>". */
export type ProjectStatusFn = (
  project: Project,
  deployments: readonly Deployment[],
  chainId: number | null,
  recipeHash: Hex,
  chainName?: (chainId: number) => string,
) => ProjectStatus;
/** Per-facet exported counts come from the catalog. */
export type RecipeStatsFn = (analysis: Analysis, catalog: Catalog) => RecipeStats;

// ── address (C5b) ──────────────────────────────────────────────────────────────────────────────────

/** CREATE2 through Arachnid's proxy 0x4e59b44847b379578588920cA78FbF26c0B4956C. */
export type ArachnidAddressFn = (salt: Hex, initCodeHash: Hex) => Address;
/** keccak256("lattice.<name>.<version>"); versionless for LatticeRegistry and LatticeFactory. */
export type SharedSaltFn = (name: string, version?: string) => Hex;
export type FactoryPredictFn = (args: FactoryPredictArgs) => Address;
export type CreatexPredictFn = (args: CreatexPredictArgs) => Address;
/** `from ‖ flag ‖ entropy`: 20 + 1 + 11 bytes (spec L286). */
export type BuildSaltFn = (from: Address, scope: Scope, entropy: Hex) => Hex;
/** Ok with the salt when `bytes20(salt) == from`. */
export type AssertSaltSenderFn = (salt: Hex, from: Address) => Result<Hex, string>;
/** 11 bytes of fresh entropy from the injected source. */
export type NewEntropyFn = (random: Random) => Hex;

// ── deploy (C5c) ───────────────────────────────────────────────────────────────────────────────────

export type BuildDiamondDeployFn = (args: DiamondDeployArgs) => Result<DiamondDeploy, string>;
export type BuildMissingDeploysFn = (args: MissingDeploysArgs) => Result<MissingDeploys, string>;
/** keccak256 of the calldata, for comparison with a wallet's data view (spec L573). */
export type CalldataHashFn = (data: Hex) => Hex;
export type GasShareFn = (gas: bigint, cap: bigint) => GasShare;

// ── revert (C6) ────────────────────────────────────────────────────────────────────────────────────

export type DecodeRevertFn = (data: Hex, catalog: Catalog, context: RevertContext) => DecodedRevert;

// ── export (C7a, C7b, C7c) ─────────────────────────────────────────────────────────────────────────

export type ExportFoundryFn = (args: FoundryExportArgs) => Result<ExportFile, string>;
export type ExportBriefFn = (args: BriefExportArgs) => ExportFile;
export type ExportRecipeJsonFn = (recipe: Recipe, catalog: Catalog) => ExportFile;
export type ExportProjectFileFn = (project: Project, deployments: readonly Deployment[]) => ExportFile;
/** JSON Schema generated from the Zod recipe schema. */
export type RecipeJsonSchemaFn = () => JsonObject;
export type ExportSafeBatchFn = (args: SafeBatchArgs) => Result<ExportFile, string>;

// ── share (C8) ─────────────────────────────────────────────────────────────────────────────────────

/** `#s=1.<base64url(deflate-raw(recipe))>` without `$schema` (spec L291). */
export type EncodeShareLinkFn = (recipe: Recipe) => ShareLink;
export type DecodeShareLinkFn = (fragment: string, catalogs: readonly Catalog[]) => Result<SharedRecipe, ParseIssue[]>;
/** Tells a `.lattice.json` project file from a `recipe.json`; errors name the file, path and reason. */
export type ImportFileFn = (text: string, filename: string, catalogs: readonly Catalog[]) => Result<ImportedFile, ParseIssue[]>;

// ── layout (C9) ────────────────────────────────────────────────────────────────────────────────────

export type CardSizeFn = (facet: Facet, opts: CardSizeOptions) => CardSize;
/**
 * Where a card (or a group) of `size` goes: snapped to `metrics.snap`, spiraling out from `at`, overlapping no
 * card in `layout`. `size` is the card's, or the bounding box of a multi-card drop. Cards being moved must be
 * left out of `layout` by the caller, so they don't block their own landing spot.
 */
export type FreeSlotFn = (layout: Layout, sizes: Sizes, at: Point, size: Size, metrics: LayoutMetrics) => Point;
/** Cards below `facet` in the same column move down by `dy`; a negative `dy` pulls nothing up (spec L479). */
export type PushBelowFn = (layout: Layout, sizes: Sizes, facet: string, dy: number, metrics: LayoutMetrics) => Layout;
/**
 * Deterministic dependency bands; with a selection, only those cards around their current center.
 * Sizes come from `cardSize` with `metrics` and the analysis's contested selectors.
 */
export type TidyFn = (
  project: Project,
  catalog: Catalog,
  analysis: Analysis,
  metrics: LayoutMetrics,
  selection?: readonly string[],
) => Layout;
export type RouteTracesFn = (args: RouteTracesArgs) => Trace[];
export type PlaceNotesFn = (args: PlaceNotesArgs) => NotePlacement[];
/** Null for an empty sheet. */
export type ContentBoundsFn = (layout: Layout, sizes: Sizes) => Rect | null;

// ── narrate, format (C10) ──────────────────────────────────────────────────────────────────────────

/** The checks table's message template, word for word. */
export type RenderProblemFn = (code: ProblemCode, params: Record<string, Json>) => string;
/** The difference between two analyses; `prev = null` narrates nothing (baseline reset on load). */
export type NarrateFn = (prev: Analysis | null, next: Analysis, cause?: NarrateCause) => LineDraft[];
/** `transfer(address,uint256)` 0xa9059cbb (full) or `transfer · 0xa9059cbb` (dense). */
export type FormatSelectorFn = (selector: SelectorRef, style?: "full" | "dense") => string;
/** ENS name first when known; else `0x1234…abcd` (6 + 4); `full` shows it checksummed in full. */
export type FormatAddressFn = (address: Address, opts?: { ens?: string; full?: boolean }) => string;
/** "12/17 selectors". */
export type FormatCountFn = (routed: number, exported: number) => string;
/** "about 2.4M gas". */
export type FormatGasFn = (gas: bigint) => string;
/** Native token, 4 significant figures, no fiat. */
export type FormatFeeFn = (wei: bigint, symbol: string, decimals?: number) => string;
/** "5 minutes (300 s)". */
export type FormatDurationFn = (seconds: bigint | number | string) => string;
/** "2 min ago", with the absolute time for the tooltip. Both times are ISO strings. */
export type FormatTimeFn = (at: string, now: string) => RelativeTime;
/** "Mod+C" → "⌘C" on macOS, "Ctrl+C" elsewhere. */
export type FormatKeysFn = (keys: string, platform: Platform) => string;
/** "1 selector", "2 selectors". */
export type PluralFn = (count: number | bigint, one: string, many?: string) => string;
export type LintCopyFn = (text: string) => CopyIssue[];

// ── edit (C11): every op returns EditResult ────────────────────────────────────────────────────────

/**
 * Places the card at `at`, as given. The caller has already snapped it and moved it to a free slot with C9's
 * `freeSlot` (spec L425): edit ops stay free of geometry.
 */
export type PlaceFacetFn = (project: Project, catalog: Catalog, name: string, at: Point) => EditResult;
/** Drops their owners, init steps and now-orphaned exclusions. */
export type RemoveFacetsFn = (project: Project, catalog: Catalog, names: readonly string[]) => EditResult;
export type RouteSelectorFn = (project: Project, catalog: Catalog, selector: Hex4, facet: string) => EditResult;
/** `catalog` gives the summary the selector's signature ("transfer · 0xa9059cbb"). */
export type ClearOwnerFn = (project: Project, catalog: Catalog, selector: Hex4) => EditResult;
export type ExcludeSelectorFn = (project: Project, catalog: Catalog, selector: Hex4) => EditResult;
export type IncludeSelectorFn = (project: Project, catalog: Catalog, selector: Hex4, facet?: string) => EditResult;
/**
 * Replaces the recipe and the layout as one step. The caller passes the tidied layout (C9's `tidy` needs the
 * analysis of the new recipe, which C11 doesn't compute).
 */
export type LoadRecipeFn = (project: Project, catalog: Catalog, recipe: Recipe, layout: Layout) => EditResult;
/** `value` undefined clears the argument. */
export type SetInitArgFn = (project: Project, catalog: Catalog, path: string, value: Arg | undefined) => EditResult;
export type AddInitStepFn = (project: Project, catalog: Catalog, spec: string, index?: number) => EditResult;
/** INIT-03's Remove {A}. */
export type RemoveInitStepFn = (project: Project, catalog: Catalog, path: string) => EditResult;
export type MoveInitStepFn = (project: Project, catalog: Catalog, from: number, to: number) => EditResult;
export type SetImmutableFn = (project: Project, immutable: boolean) => EditResult;
export type RenameProjectFn = (project: Project, name: string) => EditResult;
export type MoveCardsFn = (project: Project, facets: readonly string[], by: Point) => EditResult;
export type SetCardPositionFn = (project: Project, facet: string, at: Point) => EditResult;
export type FlipPinsFn = (project: Project, facets: readonly string[]) => EditResult;
/**
 * Sets the card's `expanded` flag only. Pushing the cards below it down (spec L479) is S1's composition:
 * C9's `pushBelow` plus `applyLayout`, in the same `doc.apply` step.
 */
export type SetExpandedFn = (project: Project, facet: string, expanded: boolean) => EditResult;
/** Never touches the recipe. */
export type ApplyLayoutFn = (project: Project, layout: Layout) => EditResult;
/** Appends to `project.predicted` unless the pair is there (addresses compared case-insensitively). */
export type RecordPredictionFn = (project: Project, prediction: { chainId: number; address: Address }) => EditResult;

/** Every public function's owner, for the stub tests and "Not built yet · WP-<id>" boundaries. */
export const API_OWNERS = {
  canonicalJson: "C1", normalizeRecipe: "C1", recipeHash: "C1", catalogHash: "C1",
  parseRecipe: "C1", parseProject: "C1", parseProjectFile: "C1", migrate: "C1",
  analyze: "C2", computeRouting: "C2", sortProblems: "C2", isCoreFacet: "C2", isCoreOnly: "C2", coreStatus: "C2",
  planInit: "C4a", autoOrder: "C4a", fieldModel: "C4a", validateArg: "C4a",
  resolveRefs: "C4b", collectRefs: "C4b", encodeInit: "C4b", decodeInit: "C4b",
  authorityTable: "C4c", mechanismOptions: "C4c", planMechanismChange: "C4c",
  buildPlan: "C5a", comparePlan: "C5a", templateList: "C5a", loadTemplate: "C5a", blankDiamond: "C5a",
  projectStatus: "C5a", recipeStats: "C5a",
  arachnidAddress: "C5b", sharedSalt: "C5b", factoryPredict: "C5b", createxPredict: "C5b", createxProxy: "C5b",
  buildSalt: "C5b", assertSaltSender: "C5b", newEntropy: "C5b",
  buildDiamondDeploy: "C5c", buildMissingDeploys: "C5c", calldataHash: "C5c", gasShare: "C5c",
  decodeRevert: "C6",
  exportFoundry: "C7a",
  exportBrief: "C7b", exportRecipeJson: "C7b", exportProjectFile: "C7b", recipeJsonSchema: "C7b",
  exportSafeBatch: "C7c",
  encodeShareLink: "C8", decodeShareLink: "C8", importFile: "C8",
  cardSize: "C9", freeSlot: "C9", pushBelow: "C9", tidy: "C9", routeTraces: "C9", placeNotes: "C9", contentBounds: "C9",
  renderProblem: "C10", narrate: "C10", lines: "C10",
  formatSelector: "C10", formatAddress: "C10", formatCount: "C10", formatGas: "C10", formatFee: "C10",
  formatDuration: "C10", formatTime: "C10", formatKeys: "C10", plural: "C10", lintCopy: "C10",
  placeFacet: "C11", removeFacets: "C11", routeSelector: "C11", clearOwner: "C11", excludeSelector: "C11",
  includeSelector: "C11", loadRecipe: "C11", setInitArg: "C11", addInitStep: "C11", removeInitStep: "C11",
  moveInitStep: "C11", setImmutable: "C11", renameProject: "C11", moveCards: "C11", setCardPosition: "C11",
  flipPins: "C11", setExpanded: "C11", applyLayout: "C11", recordPrediction: "C11",
} as const satisfies Record<string, WpId>;

/** A public function's name. `lines` is the builder object `ConsoleLineBuilders`. */
export type ApiName = keyof typeof API_OWNERS;

/** `lines.*` (C10): one builder per console line. */
export type LinesApi = ConsoleLineBuilders;
