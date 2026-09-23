import type { Hex, Hex4 } from "./hex";

/** The only recipe schema version this Studio reads (spec L289, contracts §3.2). */
export const RECIPE_SCHEMA_VERSION = 1;

/** Canonical and hashed: what the diamond is (spec L209-L223). */
export type Recipe = {
  /** Hosted JSON Schema, for editor autocomplete. */
  $schema?: string;
  schemaVersion: 1;
  /** Display only; written on export and in share links. */
  name?: string;
  catalog: { tag: string; hash: Hex };
  /** Provenance; its owners and exclusions are copied in at load. */
  template?: { name: string; catalogHash: Hex };
  /** A set, kept in catalog order; cut order follows it. */
  facets: string[];
  /** Contested selector → the placed facet that serves it. */
  owners: Record<Hex4, string>;
  /** Selectors left out of the diamond entirely. */
  exclude: Hex4[];
  init:
    /** e.g. GovernedVaultInit. */
    | { kind: "bundle"; spec: string; args: Record<string, Arg> }
    /** MultiInit, in call order. */
    | { kind: "steps"; steps: { spec: string; args: Record<string, Arg> }[] }
    | { kind: "none" };
  /** Acknowledged: no upgrade mechanism. */
  immutable?: true;
};

/**
 * An init argument (spec L224-L227). Integers as decimal strings, hex lowercase, addresses EIP-55.
 * `{ $ref: "self" | "deployer" }` is this diamond or the deploying account, resolved at build time.
 * A tuple argument is a nested object keyed by component name: the path `bundle.p.asset` addresses
 * `init.args.p.asset`, and `steps[2].admin` addresses `init.steps[2].args.admin`. Arrays are lists.
 */
export type Arg =
  | string
  | boolean
  | Arg[]
  | { [field: string]: Arg }
  | { $ref: "self" | "deployer" };

/** A reference an argument can hold (spec L285). */
export type RefName = "self" | "deployer";

/** `Recipe["init"]`. */
export type RecipeInit = Recipe["init"];

/** One MultiInit step as the recipe stores it. */
export type InitStep = { spec: string; args: Record<string, Arg> };
