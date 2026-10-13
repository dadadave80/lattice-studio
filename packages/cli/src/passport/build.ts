import { keccak256, stringToHex } from "viem";
import { canonicalJson } from "./canonical";
import { differenceCount } from "./compare";
import { summarizeHistory } from "./history";
import type { CatalogPin, ChainFacts, ClaimId, ClaimStatus, IdentifiedFacet, Passport, PassportClaim, RecipeFacts } from "./types";

const HISTORY_NOT_READ = "History not read: set ENVIO_API_TOKEN or pass --from-block.";

function claim(id: ClaimId, status: ClaimStatus, message: string): PassportClaim {
  return { id, status, message };
}

/** "1 facet", "3 facets". */
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function short(text: string): string {
  return text.length > 12 ? `${text.slice(0, 6)}…${text.slice(-4)}` : text;
}

function list(items: readonly string[], max = 5): string {
  const shown = items.slice(0, max).join(", ");
  return items.length > max ? `${shown} and ${items.length - max} more` : shown;
}

/** PP-03: every facet is a release in a bundled catalog, or the diamond itself. */
function identityClaim(facets: readonly IdentifiedFacet[]): PassportClaim {
  const unknown = facets.filter((facet) => facet.kind === "unknown");
  if (unknown.length > 0) {
    return claim("PP-03", "fail", `${count(unknown.length, "facet")} with no match in a bundled catalog: ${list(unknown.map((facet) => facet.address))}.`);
  }
  const known = facets.filter((facet) => facet.kind === "known");
  if (known.length === 0) return claim("PP-03", "pass", "No facets outside the diamond itself.");
  return claim("PP-03", "pass", `Every facet is a Lattice release: ${list(known.map((facet) => `${facet.name}@${facet.version}`))}.`);
}

/** PP-04: the chain routes every selector exactly as the recipe's plan does. */
function routingClaim(facts: ChainFacts, recipe: RecipeFacts): PassportClaim {
  if (facts.loupe === null) return claim("PP-04", "fail", "The recipe routes selectors, but facets() didn't answer.");
  const differences = differenceCount(recipe.diff);
  if (differences === 0) {
    return claim("PP-04", "pass", `Routing matches the recipe: ${count(recipe.selectors, "selector")} on ${count(recipe.facets, "facet")}.`);
  }
  const details = [
    ...recipe.diff.missing.map((d) => `${d.selector} missing (${d.facet})`),
    ...recipe.diff.extra.map((d) => `${d.selector} extra (${short(d.actual)})`),
    ...recipe.diff.misrouted.map((d) => `${d.selector} on ${short(d.actual)}, not ${d.facet}`),
  ];
  return claim("PP-04", "fail", `Routing differs from the recipe in ${count(differences, "selector")}: ${list(details)}.`);
}

/** PP-07: the earliest cut's transaction, and what it went through. */
function deploymentClaim(facts: ChainFacts, deploymentCuts: number): PassportClaim {
  const d = facts.deployment;
  if (d === null && deploymentCuts === 0) return claim("PP-07", "warn", "No DiamondCut event in the blocks read, so the deployment wasn't found.");
  if (d === null) return claim("PP-07", "warn", "The deployment transaction couldn't be read.");
  if (d.via === "other") {
    return claim("PP-07", "warn", `Deployed in ${d.txHash} at block ${d.block} by ${d.from} through ${d.to ?? "a contract creation"}, neither LatticeFactory nor CreateX.`);
  }
  return claim("PP-07", "pass", `Deployed in ${d.txHash} at block ${d.block} by ${d.from} through ${d.via}.`);
}

/** PP-06 and PP-07, from the cut history when it was read. */
function historyClaims(facts: ChainFacts): PassportClaim[] {
  if (facts.history === null) return [claim("PP-06", "skip", HISTORY_NOT_READ), claim("PP-07", "skip", HISTORY_NOT_READ)];
  const { initial, later } = summarizeHistory(facts.history);
  let upgrades: PassportClaim;
  if (later.length > 0) {
    upgrades = claim("PP-06", "warn", `${count(later.length, "cut")} since the deployment: ${list(later.map((cut) => `${short(cut.txHash)} at block ${cut.block}`))}.`);
  } else if (initial.length === 0) {
    upgrades = claim("PP-06", "pass", "No cuts in the blocks read.");
  } else {
    upgrades = claim("PP-06", "pass", "No cuts since the deployment.");
  }
  return [upgrades, deploymentClaim(facts, initial.length)];
}

/** PP-08: who holds owner(), when the diamond routes it. */
function ownerClaim(facts: ChainFacts): PassportClaim {
  if (!facts.ownerRouted) return claim("PP-08", "skip", "The diamond doesn't route owner().");
  if (facts.owner === null) return claim("PP-08", "warn", "owner() is routed but didn't answer.");
  return claim("PP-08", "pass", `owner() is ${facts.owner}.`);
}

/** The eight claims and the digest, from facts alone: no client, no clock, no randomness. */
export function buildPassport(facts: ChainFacts, facets: readonly IdentifiedFacet[], recipe: RecipeFacts | null, catalog: CatalogPin | null): Passport {
  const where = `${facts.address} on ${facts.chainName}`;
  const claims: PassportClaim[] = [facts.hasCode ? claim("PP-01", "pass", `Code is deployed at ${where}.`) : claim("PP-01", "fail", `No code at ${where}.`)];
  if (facts.loupe === null) {
    claims.push(claim("PP-02", "fail", "facets() didn't answer, so this isn't an EIP-2535 diamond or its loupe isn't routed."));
    claims.push(claim("PP-03", "skip", "No facets to identify: facets() didn't answer."));
  } else {
    const routed = facts.loupe.reduce((sum, row) => sum + row.selectors.length, 0);
    claims.push(claim("PP-02", "pass", `The loupe lists ${count(facts.loupe.length, "facet")} routing ${count(routed, "selector")}.`));
    claims.push(identityClaim(facets));
  }
  if (recipe === null) {
    claims.push(claim("PP-04", "skip", "No recipe given: pass --recipe <file> to compare routing."));
    claims.push(claim("PP-05", "skip", "No recipe given."));
  } else {
    claims.push(routingClaim(facts, recipe));
    claims.push(claim("PP-05", "pass", `The recipe is pinned to catalog ${recipe.catalog.tag}, which this CLI bundles.`));
  }
  claims.push(...historyClaims(facts), ownerClaim(facts));

  const body = {
    kind: "lattice-passport/v1" as const,
    chainId: facts.chainId,
    address: facts.address,
    block: facts.block,
    catalog,
    recipeHash: recipe === null ? null : recipe.recipeHash,
    facets: [...facets],
    deployment: facts.deployment,
    history: facts.history,
    authority: facts.owner === null ? null : { owner: facts.owner },
    claims,
    source: { reads: "rpc" as const, logs: facts.historySource },
  };
  return { ...body, digest: keccak256(stringToHex(canonicalJson(body))) };
}

/** True when any claim fails: the command then exits 1. */
export function failed(passport: Pick<Passport, "claims">): boolean {
  return passport.claims.some((item) => item.status === "fail");
}
