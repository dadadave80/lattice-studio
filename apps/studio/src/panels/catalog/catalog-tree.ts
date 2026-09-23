/**
 * The catalog panel's pure logic: search matching (spec "Catalog" empty text, IR L82), grouping facets into
 * area folders with "n on sheet" (IR L84), and reading chain-dependent availability and verification off a
 * probed `ChainState` (spec L832: unknown until a chain has been checked). No DOM, no React.
 */
import type { Area, Catalog, ChainState, Facet } from "@lattice-studio/core";
import type { ChainReadiness } from "@/contracts";
import type { TreeNode } from "@/ui/nav";

/** `TreeNode.id` prefix for an area folder, so a folder id can never collide with a facet name. */
const AREA_PREFIX = "area:";

/** Display names for `Area` (contracts §3.1); no board fixes these, so they're built from the design system. */
export const AREA_LABELS: Record<Area, string> = {
  access: "Access",
  accounts: "Accounts",
  amm: "AMM",
  crosschain: "Crosschain",
  defi: "DeFi",
  diamond: "Diamond",
  ens: "ENS",
  governance: "Governance",
  oracles: "Oracles",
  privacy: "Privacy",
  security: "Security",
  tokens: "Tokens",
  utils: "Utils",
};

export function areaNodeId(area: Area): string {
  return `${AREA_PREFIX}${area}`;
}

export function isAreaNodeId(id: string): boolean {
  return id.startsWith(AREA_PREFIX);
}

/** The `Area` an area folder's node id names. Only call this once `isAreaNodeId` said yes. */
export function areaOfNodeId(id: string): Area {
  return id.slice(AREA_PREFIX.length) as Area;
}

function functionNameOf(signature: string): string {
  const paren = signature.indexOf("(");
  return paren === -1 ? signature : signature.slice(0, paren);
}

/** Whether `facet` matches a typed query: name, area, namespace, function name, or selector hex by prefix. */
export function facetMatchesQuery(facet: Facet, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (q.startsWith("0x")) return facet.selectors.some((s) => s.hex.startsWith(q));
  if (facet.name.toLowerCase().includes(q)) return true;
  if (facet.area.includes(q) || AREA_LABELS[facet.area].toLowerCase().includes(q)) return true;
  if (facet.storage && facet.storage.id.toLowerCase().includes(q)) return true;
  return facet.selectors.some((s) => functionNameOf(s.signature).toLowerCase().includes(q));
}

export type CatalogTreeResult = {
  nodes: TreeNode[];
  /** How many facets matched (across every area), for the announced match count. */
  matchCount: number;
  /** Area folder ids with at least one match, for auto-expanding while a query is active. */
  matchedAreaIds: string[];
};

/**
 * Groups the catalog's facets into area folders, filtered by `query` and, when given, `include` (the
 * "Available on {chain}" filter). Areas and facets are sorted alphabetically by display name so a person
 * scanning or typing ahead finds them predictably; the catalog's own (source) order isn't preserved.
 */
export function buildCatalogNodes(catalog: Catalog, query: string, include?: (facet: Facet) => boolean): CatalogTreeResult {
  const byArea = new Map<Area, Facet[]>();
  let matchCount = 0;
  for (const facet of catalog.facets) {
    if (!facetMatchesQuery(facet, query)) continue;
    if (include && !include(facet)) continue;
    matchCount += 1;
    const list = byArea.get(facet.area);
    if (list) list.push(facet);
    else byArea.set(facet.area, [facet]);
  }
  const areas = [...byArea.keys()].sort((a, b) => AREA_LABELS[a].localeCompare(AREA_LABELS[b], "en"));
  const nodes: TreeNode[] = areas.map((area) => ({
    id: areaNodeId(area),
    label: AREA_LABELS[area],
    children: [...(byArea.get(area) ?? [])]
      .sort((a, b) => a.name.localeCompare(b.name, "en"))
      .map((facet) => ({ id: facet.name, label: facet.name })),
  }));
  return { nodes, matchCount, matchedAreaIds: areas.map(areaNodeId) };
}

/** How many of an area's facets (in the whole catalog, unfiltered by search) are on the open sheet. */
export function placedCountByArea(catalog: Catalog, placed: ReadonlySet<string>): Map<Area, number> {
  const counts = new Map<Area, number>();
  for (const facet of catalog.facets) {
    if (!placed.has(facet.name)) continue;
    counts.set(facet.area, (counts.get(facet.area) ?? 0) + 1);
  }
  return counts;
}

export type FacetAvailability = { available: boolean; verified: boolean };

/**
 * A facet's availability and verification on a chain, from its last probe: present in `ChainState.shared`,
 * and "verified" when the runtime codehash found there matches the catalog's own release codehash for it
 * (contracts §5.1 `ChainState`; there's no separate Sourcify flag at this layer). Null while unprobed, still
 * checking, or the probe failed: those all show as unknown (spec L832), never as "not available".
 */
export function chainAvailability(catalog: Catalog, readiness: ChainReadiness | null): Map<string, FacetAvailability> | null {
  if (!readiness || readiness.status !== "ready") return null;
  return facetAvailabilityFromState(catalog, readiness.state);
}

function facetAvailabilityFromState(catalog: Catalog, state: ChainState): Map<string, FacetAvailability> {
  const out = new Map<string, FacetAvailability>();
  for (const facet of catalog.facets) {
    const entry = state.shared[facet.name];
    const available = Boolean(entry?.present);
    out.set(facet.name, { available, verified: available && entry?.codehash === facet.release.codehash });
  }
  return out;
}
