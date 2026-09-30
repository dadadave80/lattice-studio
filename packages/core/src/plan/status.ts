import { isCoreFacet } from "../diamond/core";
import { formatCount, formatStamp, plural } from "../format/format";
import type { ProjectStatusFn, RecipeStatsFn } from "../model/api";
import type { RecipeStats } from "../model/analysis";
import type { Hex } from "../model/hex";
import type { Deployment, DiamondState, ProjectStatus } from "../model/project";

/** Newest first: `at` (ISO time) descending, then revision descending, then address, so ties stay deterministic. */
function newestFirst(a: Deployment, b: Deployment): number {
  if (a.at !== b.at) return a.at < b.at ? 1 : -1;
  if (a.revision !== b.revision) return b.revision - a.revision;
  const x = a.address.toLowerCase();
  const y = b.address.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * Live (spec L287): a confirmed record with the current recipe hash. A record imported from a file is never
 * live until S8c re-reads it on-chain and clears `fromFile` (spec L501, L857), and a mismatch never is.
 */
function isLive(deployment: Deployment, recipeHash: Hex): boolean {
  return (
    deployment.status === "confirmed" &&
    deployment.fromFile !== true &&
    deployment.recipeHash.toLowerCase() === recipeHash.toLowerCase()
  );
}

/** What a record on its own says about the diamond on its chain, before the live check. */
const STATE_OF: Record<Exclude<Deployment["status"], "failed">, DiamondState> = {
  pending: "pending",
  proposed: "proposed",
  confirmed: "modified",
  mismatch: "mismatch",
};

/**
 * The diamond's state on the selected chain (spec L283-L291, L582-L584, L686), recomputed from the recipe hash
 * every time, so undoing back to a live recipe makes the chain live again.
 *
 * On the selected chain, first match wins:
 * 1. A live record (the newest, when there are several): "Live · Sepolia · r1".
 * 2. Otherwise the newest record that isn't failed and isn't from a file: pending "Pending · Sepolia",
 *    proposed "Proposed · Sepolia (Safe)", mismatch "Mismatch · Sepolia", or confirmed with another recipe hash
 *    "Modified since r1".
 * 3. Otherwise a record from a file: "From file", whatever status the file claims (spec L857).
 * 4. Otherwise a failed one: "Failed · Sepolia".
 * 5. Otherwise "Not deployed". With no chain selected the stamp reads "Not deployed" too.
 *
 * `live` lists every chain with a live record (the newest per chain, by chain id). `modifiedSince` and
 * `deployAgain` are set when the selected chain has a confirmed record (not from a file) and none is live: the
 * sheet differs from what's there, so the button reads Deploy again… (Flow 13). Records of other projects are
 * ignored.
 */
export const projectStatus: ProjectStatusFn = (project, deployments, chainId, recipeHash, chainName) => {
  const ours = deployments.filter((d) => d.projectId === project.id).sort(newestFirst);
  const nameOf = (id: number): string => chainName?.(id) ?? `Chain ${id}`;

  const livePerChain = new Map<number, Deployment>();
  for (const d of ours) if (isLive(d, recipeHash) && !livePerChain.has(d.chainId)) livePerChain.set(d.chainId, d);
  const live = [...livePerChain.values()]
    .sort((a, b) => a.chainId - b.chainId)
    .map((d) => ({ chainId: d.chainId, address: d.address, revision: d.revision }));

  const status: ProjectStatus = { state: "not-deployed", stamp: formatStamp({ state: "not-deployed" }), chainId, live, deployAgain: false };
  if (chainId === null) return status;

  const onChain = ours.filter((d) => d.chainId === chainId);
  const chain = nameOf(chainId);
  const liveHere = livePerChain.get(chainId);
  const settled = onChain.find((d) => d.status === "confirmed" && d.fromFile !== true);
  if (liveHere === undefined && settled !== undefined) {
    status.modifiedSince = settled.revision;
    status.deployAgain = true;
  }

  let shown: Deployment | undefined;
  let state: DiamondState = "not-deployed";
  if (liveHere !== undefined) {
    shown = liveHere;
    state = "live";
  } else if ((shown = onChain.find((d) => d.status !== "failed" && d.fromFile !== true)) !== undefined) {
    state = STATE_OF[shown.status as keyof typeof STATE_OF];
  } else if ((shown = onChain.find((d) => d.fromFile === true)) !== undefined) {
    state = "from-file";
  } else if ((shown = onChain.find((d) => d.status === "failed")) !== undefined) {
    state = "failed";
  }

  status.state = state;
  status.stamp = formatStamp({ state, chain, revision: shown?.revision ?? 0 });
  if (shown !== undefined) status.deployment = shown;
  return status;
};

/**
 * "12 facets · 120 selectors" and, per placed facet, "12/17 selectors" (routed/exported, spec L685). Placed
 * facets are the ones the routing names as contenders plus the plan's, in catalog order; routed counts come
 * from the routing's owners, exported counts from the catalog. `facets` counts the cards (the core's two left
 * out, decision D18); `selectors` and `perFacet` count the core's too, so an empty sheet reads "0 facets · 5 selectors".
 */
export const recipeStats: RecipeStatsFn = (analysis, catalog) => {
  const placed = new Set<string>(analysis.plan.map((entry) => entry.facet));
  const routed = new Map<string, number>();
  for (const route of Object.values(analysis.routing)) {
    for (const contender of route.contenders) placed.add(contender);
    if (route.owner !== undefined) {
      placed.add(route.owner);
      routed.set(route.owner, (routed.get(route.owner) ?? 0) + 1);
    }
  }

  const order = new Map(catalog.facets.map((facet, index) => [facet.name, index]));
  const names = [...placed].sort((a, b) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity) || (a < b ? -1 : a > b ? 1 : 0));

  const perFacet: RecipeStats["perFacet"] = {};
  let selectors = 0;
  for (const name of names) {
    const facet = catalog.facets.find((f) => f.name === name);
    const exported = facet
      ? facet.selectors.length
      : Object.values(analysis.routing).filter((route) => route.contenders.includes(name)).length;
    const count = routed.get(name) ?? 0;
    selectors += count;
    perFacet[name] = { routed: count, exported, text: formatCount(count, exported) };
  }

  const cards = names.filter((name) => !isCoreFacet(name)).length;
  return {
    facets: cards,
    selectors,
    text: `${plural(cards, "facet")} · ${plural(selectors, "selector")}`,
    perFacet,
  };
};
