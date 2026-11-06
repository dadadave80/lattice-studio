import type { Address, Hex } from "../model/hex";
import type { LoupeFacet } from "../model/chain";

export type PassportClaimStatus = "pass" | "fail" | "warn" | "skip";
export type PassportClaimId = "PP-01" | "PP-02" | "PP-03" | "PP-04" | "PP-05" | "PP-06" | "PP-07" | "PP-08";
export type PassportClaim = { id: PassportClaimId; status: PassportClaimStatus; message: string };

export type PassportCutAction = "add" | "replace" | "remove" | "unknown";

/** One `DiamondCut` event. */
export type PassportCutEvent = {
  block: number;
  logIndex: number;
  txHash: Hex;
  init: Address;
  cuts: { facet: Address; action: PassportCutAction; selectors: Hex[] }[];
};

export type PassportDeployment = { txHash: Hex; block: number; from: Address; to: Address | null; via: "LatticeFactory" | "CreateX" | "other" };

/** A facet as `identifyFacets` names it. */
export type PassportIdentifiedFacet = {
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
export type PassportRoutingDiff = {
  missing: { selector: string; facet: string; expected: Address }[];
  extra: { selector: string; actual: Address }[];
  misrouted: { selector: string; facet: string; expected: Address; actual: Address }[];
};

export type PassportCatalogPin = { tag: string; hash: Hex };

/** Everything read from the chain, as data. null: not read, or not there. */
export type PassportChainFacts = {
  chainId: number;
  chainName: string;
  address: Address;
  block: number;
  hasCode: boolean;
  loupe: LoupeFacet[] | null;
  /** Lowercase facet address to keccak256 of its runtime code. */
  codehashes: Record<string, Hex>;
  history: PassportCutEvent[] | null;
  historySource: "hyperrpc" | "rpc" | null;
  deployment: PassportDeployment | null;
  ownerRouted: boolean;
  owner: Address | null;
};

/** What `--recipe` adds. */
export type PassportRecipeFacts = { recipeHash: Hex; catalog: PassportCatalogPin; diff: PassportRoutingDiff; selectors: number; facets: number };

export type Passport = {
  kind: "lattice-passport/v1";
  chainId: number;
  address: Address;
  block: number;
  catalog: PassportCatalogPin | null;
  recipeHash: Hex | null;
  facets: PassportIdentifiedFacet[];
  deployment: PassportDeployment | null;
  history: PassportCutEvent[] | null;
  authority: { owner: Address } | null;
  claims: PassportClaim[];
  source: { reads: "rpc"; logs: "hyperrpc" | "rpc" | null };
  digest: Hex;
};
