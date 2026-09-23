import type { Analysis, AnalysisContext } from "./analysis";
import type { Catalog } from "./catalog";
import type { ChainState, DeployPath, Scope } from "./chain";
import type { Address, Hex } from "./hex";
import type { Json } from "./json";
import type { Deployment, Project } from "./project";
import type { Recipe } from "./recipe";

/**
 * One validation problem in a file, link or stored record: `path` renders like `facets[3]` or
 * `init.steps[0].args.admin` ("" is the root), `message` reads after it: `facets[3]` "is 3; expected text."
 */
export type ParseIssue = { path: string; message: string; file?: string };

/** Where parsed JSON came from; links and files mark authority addresses unconfirmed (LINK-01). */
export type ParseSource = "file" | "link" | "db";

/** C1 `parseRecipe`, `parseProject`, `parseProjectFile` options. */
export type ParseOptions = {
  /** Catalogs this build bundles; the recipe's `catalog.hash` picks one. */
  catalogs: readonly Catalog[];
  source: ParseSource;
  /** For messages: "recipe.json: facets[3] ‘ERC20X’ isn't in Lattice 0.4.0." */
  filename?: string;
};

/** A parsed value with what the parse learned about it. */
export type Parsed<T> = {
  value: T;
  /** Paths of fields Studio doesn't recognize: kept, listed read-only, left out of the hash (spec L289). */
  unknownFields: string[];
  /** The catalog it names; null when this build doesn't bundle it (opens read-only, spec L290). */
  catalog: Catalog | null;
  /** Set when a forward migration ran. */
  migratedFrom?: number;
};

/** C1 `migrate`'s result. */
export type Migrated = { value: Json; from: number; to: number };

/** A generated file. */
export type ExportFile = { filename: string; mime: string; text: string };

/** C7a `exportFoundry`. */
export type FoundryExportArgs = {
  project: Project;
  catalog: Catalog;
  analysis: Analysis;
  studioVersion: string;
  /** Chains with per-chain constants: the catalog's `chains`, plus 31337 in e2e builds (contracts §5.5). */
  chainIds: number[];
  /**
   * The `Lattice` proxy's creation code, embedded as a hex literal for the CreateX path (the script has no
   * Lattice dependency). The caller loads it; the callee checks `keccak256(bytes) === catalog.proxy.initCodeHash`
   * and returns an error on a mismatch, or when the project's path is CreateX and it's missing.
   */
  proxyCreationCode?: Hex;
};

/** C7b `exportBrief`. */
export type BriefExportArgs = {
  recipe: Recipe;
  catalog: Catalog;
  analysis: Analysis;
  studioVersion: string;
};

/** C7c `exportSafeBatch` (Transaction Builder 1.0; `now` in milliseconds becomes `createdAt`). */
export type SafeBatchArgs = {
  recipe: Recipe;
  catalog: Catalog;
  safe: Address;
  chainId: number;
  entropy: Hex;
  scope: Scope;
  path: DeployPath;
  now: number;
  /** Heads the batch's description like every export (spec L508); CCR from C7c. */
  studioVersion: string;
  /**
   * The project's addresses and argument sources that AUTH-02 and LINK-01 need, so the export gate refuses
   * every blocker (spec L517, L565); CCR from C7c. Without it those two checks can't fire here.
   */
  context?: Pick<AnalysisContext, "known" | "unconfirmed" | "knownFrom" | "unconfirmedFrom">;
  /** Registry records for whole-facet `RecipeEntry` cuts. */
  chain?: ChainState;
  /**
   * The `Lattice` proxy's creation code, for the CreateX batch. The caller loads it; the callee checks
   * `keccak256(bytes) === catalog.proxy.initCodeHash` and returns an error on a mismatch, or on the CreateX
   * path when it's missing.
   */
  proxyCreationCode?: Hex;
};

/** C8 `encodeShareLink`'s result. Studio warns above 2,000 characters (spec L291). */
export type ShareLink = { fragment: string; length: number; tooLong: boolean };

/** C8 `decodeShareLink`'s result. */
export type SharedRecipe = {
  recipe: Recipe;
  hash: Hex;
  /** Authority argument paths holding literal addresses (LINK-01). */
  unconfirmed: string[];
  unknownFields: string[];
  catalog: Catalog | null;
};

/** C8 `importFile`'s result: a `.lattice.json` project file or a `recipe.json`. */
export type ImportedFile =
  | {
      kind: "project";
      project: Project;
      /** Marked `fromFile`. */
      deployments: Deployment[];
      unconfirmed: string[];
      unknownFields: string[];
      catalog: Catalog | null;
    }
  | {
      kind: "recipe";
      recipe: Recipe;
      unconfirmed: string[];
      unknownFields: string[];
      catalog: Catalog | null;
    };
