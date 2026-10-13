import type { Address, Hex } from "@lattice-studio/core";

export type ClaimStatus = "pass" | "fail" | "warn" | "skip";
export type ClaimId = "PP-01" | "PP-02" | "PP-03" | "PP-04" | "PP-05" | "PP-06" | "PP-07" | "PP-08";
export type PassportClaim = { id: ClaimId; status: ClaimStatus; message: string };

/** One row of `facets()`, selectors lowercase. */
export type LoupeFacet = { address: Address; selectors: Hex[] };

export type CutAction = "add" | "replace" | "remove" | "unknown";

/** One `DiamondCut` event. */
export type CutEvent = {
  block: number;
  logIndex: number;
  txHash: Hex;
  init: Address;
  cuts: { facet: Address; action: CutAction; selectors: Hex[] }[];
};

export type Deployment = { txHash: Hex; block: number; from: Address; to: Address | null; via: "LatticeFactory" | "CreateX" | "other" };

/** A facet as `identifyFacets` names it. */
export type IdentifiedFacet = {
  address: Address;
  codehash: Hex | null;
  selectors: Hex[];
  /** known: a bundled catalog's release. self: the diamond's own address. unknown: neither. */
  kind: "known" | "self" | "unknown";
  name: string | null;
  version: string | null;
  catalog: string | null;
};

/** Selector-level differences between a plan and `facets()`, selectors lowercase. */
export type RoutingDiff = {
  missing: { selector: string; facet: string; expected: Address }[];
  extra: { selector: string; actual: Address }[];
  misrouted: { selector: string; facet: string; expected: Address; actual: Address }[];
};

export type CatalogPin = { tag: string; hash: Hex };

/** Everything read from the chain, as data. null: not read, or not there. */
export type ChainFacts = {
  chainId: number;
  chainName: string;
  address: Address;
  block: number;
  hasCode: boolean;
  loupe: LoupeFacet[] | null;
  /** Lowercase facet address to keccak256 of its runtime code. */
  codehashes: Record<string, Hex>;
  history: CutEvent[] | null;
  historySource: "hyperrpc" | "rpc" | null;
  deployment: Deployment | null;
  ownerRouted: boolean;
  owner: Address | null;
};

/** What `--recipe` adds. */
export type RecipeFacts = { recipeHash: Hex; catalog: CatalogPin; diff: RoutingDiff; selectors: number; facets: number };

export type Passport = {
  kind: "lattice-passport/v1";
  chainId: number;
  address: Address;
  block: number;
  catalog: CatalogPin | null;
  recipeHash: Hex | null;
  facets: IdentifiedFacet[];
  deployment: Deployment | null;
  history: CutEvent[] | null;
  authority: { owner: Address } | null;
  claims: PassportClaim[];
  source: { reads: "rpc"; logs: "hyperrpc" | "rpc" | null };
  digest: Hex;
};
