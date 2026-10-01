/**
 * The Diamond view's words (spec L676-L690): authority holders, init summaries, deployment status and
 * verification, and the Deployments list's order. Pure, so the view stays a thin layer over them.
 */
import type { Arg, AuthorityRow, Catalog, Deployment, Hex, InitPlan, Recipe } from "@lattice-studio/core";
import { formatAddress, isAddress, plural } from "@lattice-studio/core";
import { etherscanServes } from "@/chain/verify/chains";
import type { EtherscanOutcome } from "@/chain/verify/etherscan-outcomes";

function isRef(arg: Arg): arg is { $ref: "self" | "deployer" } {
  return typeof arg === "object" && !Array.isArray(arg) && "$ref" in arg;
}

/** Who holds a role: "This diamond", "Deploying account", an address in full (spec L682), "anyone" or "none". */
export function holderText(row: Pick<AuthorityRow, "holder" | "anyone">): string {
  if (row.anyone) return "anyone";
  const holder = row.holder;
  if (holder === null) return "none";
  if (isRef(holder)) return holder.$ref === "self" ? "This diamond" : "Deploying account";
  if (typeof holder === "string") return isAddress(holder) ? formatAddress(holder, { full: true }) : holder;
  return JSON.stringify(holder);
}

/** "GovernedVaultInit (bundle)", "3 steps", "No init". */
export function initText(recipe: Recipe, plan: InitPlan): string {
  if (recipe.init.kind === "bundle") return `${recipe.init.spec} (bundle)`;
  if (plan.kind === "none" || plan.steps.length === 0) return "No init";
  return plural(plan.steps.length, "step");
}

/** How many required init arguments are still missing (INIT-01), across every step. */
export function missingArgs(plan: InitPlan): number {
  return plan.steps.reduce((sum, step) => sum + step.missing.length, 0);
}

/** The distinct storage namespaces of the placed facets, in sheet order. */
export function namespaceIds(recipe: Recipe, catalog: Catalog | null): string[] {
  if (!catalog) return [];
  const ids = new Set<string>();
  for (const name of recipe.facets) {
    const id = catalog.facets.find((facet) => facet.name === name)?.storage?.id;
    if (id) ids.add(id);
  }
  return [...ids];
}

/** A record's status word (spec L576-L584, L686). */
export function statusWord(record: Deployment, currentHash: Hex): string {
  if (record.fromFile) return "From file";
  switch (record.status) {
    case "pending":
      return "Pending";
    case "proposed":
      return "Proposed (Safe)";
    case "confirmed":
      return record.recipeHash.toLowerCase() === currentHash.toLowerCase()
        ? `Live · r${record.revision}`
        : `Confirmed · r${record.revision}`;
    case "mismatch":
      return "Mismatch";
    case "failed":
      return "Failed";
  }
}

/**
 * Verification states (spec L579): Verifying, Verified (exact match or match), Couldn't verify. Offline, the
 * stored status can't be confirmed, so it reads Unknown instead (ruling R7, spec L832).
 */
export function verificationWord(verification: Deployment["verification"], online: boolean): string {
  if (!online) return "Unknown";
  switch (verification) {
    case "pending":
      return "Verifying";
    case "exact_match":
      return "Verified (exact match)";
    case "match":
      return "Verified (match)";
    case "failed":
      return "Couldn't verify";
  }
}

/**
 * Why a failed verification couldn't finish (spec L579, L606, Flow 14 "Verification failed: The reason").
 * Offline, the record's verification is unknown, so a stale failure reason stays hidden too (ruling R7).
 */
export function verificationFailureReason(record: Deployment, online: boolean): string | undefined {
  return online && record.verification === "failed" ? record.verificationReason : undefined;
}

/**
 * Etherscan's line under Sourcify's, for a confirmed record of our own: its outcome, or Verifying while there's a
 * key and no outcome yet. Null when there's nothing to say: offline, no key, or a chain Etherscan doesn't serve.
 */
export function etherscanWord(
  record: Pick<Deployment, "status" | "fromFile" | "chainId">, outcome: EtherscanOutcome | undefined, online: boolean, keySet: boolean,
): string | null {
  if (!online || record.status !== "confirmed" || record.fromFile === true) return null;
  if (outcome?.outcome === "verified") return "Verified on Etherscan";
  if (outcome?.outcome === "failed") return "Couldn't verify on Etherscan";
  return keySet && etherscanServes(record.chainId) ? "Verifying on Etherscan" : null;
}

/** Why Etherscan couldn't verify, shown exactly when `etherscanWord` says it couldn't. */
export function etherscanFailureReason(
  record: Pick<Deployment, "status" | "fromFile">, outcome: EtherscanOutcome | undefined, online: boolean,
): string | undefined {
  if (!online || record.status !== "confirmed" || record.fromFile === true) return undefined;
  return outcome?.outcome === "failed" ? outcome.reason : undefined;
}

export type DeploymentGroup = { chainId: number; records: Deployment[] };

/** Every record grouped by chain, newest first; the chain with the newest record comes first (Flow 13). */
export function groupDeployments(records: readonly Deployment[]): DeploymentGroup[] {
  const sorted = [...records].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const groups = new Map<number, Deployment[]>();
  for (const record of sorted) {
    const group = groups.get(record.chainId);
    if (group) group.push(record);
    else groups.set(record.chainId, [record]);
  }
  return [...groups].map(([chainId, list]) => ({ chainId, records: list }));
}

/** One key per record: the store's own key, [chainId, address]. */
export function recordKey(record: Pick<Deployment, "chainId" | "address">): string {
  return `${record.chainId}:${record.address.toLowerCase()}`;
}
