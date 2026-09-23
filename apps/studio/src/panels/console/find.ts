/**
 * `find <text or 0x…>` (IR L38, L152): the facets and pins on the sheet that match, so the console can select
 * and locate them, the one way to reach a match that's off-screen (⌘F finds text but can't pan the sheet).
 * Pure: the placed facets and the catalog come in.
 *
 * A query that looks like hex (`0x`, then up to 8 hex digits) matches selectors by prefix. Anything else matches,
 * case-insensitively, facet names that contain it and pins whose signature contains it.
 */
import type { Anchor, Catalog, Hex4 } from "@lattice-studio/core";
import { formatSelector, plural } from "@lattice-studio/core";

export type FoundPin = { facet: string; selector: Hex4; signature: string };

export type FindResult = {
  query: string;
  /** Placed facets whose name matches, in sheet order. */
  facets: string[];
  /** Pins that match, facet by facet in sheet order, each facet's in its own order. */
  pins: FoundPin[];
};

const HEX_QUERY = /^0x[0-9a-f]{0,8}$/;

export function findOnSheet(query: string, placed: readonly string[], catalog: Pick<Catalog, "facets">): FindResult {
  const typed = query.trim();
  const lower = typed.toLowerCase();
  const result: FindResult = { query: typed, facets: [], pins: [] };
  if (lower === "") return result;
  const hex = HEX_QUERY.test(lower);
  for (const name of placed) {
    const facet = catalog.facets.find((f) => f.name === name);
    if (!facet) continue;
    if (!hex && name.toLowerCase().includes(lower)) result.facets.push(name);
    for (const s of facet.selectors) {
      const hit = hex ? s.hex.startsWith(lower) : s.signature.toLowerCase().includes(lower);
      if (hit) result.pins.push({ facet: name, selector: s.hex, signature: s.signature });
    }
  }
  return result;
}

/** Every facet a match sits on, in sheet order: what `find` selects. */
export function foundFacets(result: FindResult, placed: readonly string[]): string[] {
  const hits = new Set([...result.facets, ...result.pins.map((p) => p.facet)]);
  return placed.filter((name) => hits.has(name));
}

/** Where `find` locates: the first matching facet, else the first matching pin. */
export function firstAnchor(result: FindResult): Anchor | null {
  const facet = result.facets[0];
  if (facet !== undefined) return { kind: "facet", facet };
  const pin = result.pins[0];
  return pin ? { kind: "selector", selector: pin.selector, facet: pin.facet } : null;
}

function listNames(names: readonly string[], max = 3): string {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  const items = rest > 0 ? [...shown, `${rest} more`] : shown;
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1) ?? ""}`;
}

/** What `find` says: how many facets and pins match, and which facets it selected. */
export function findSummary(result: FindResult, placed: readonly string[]): string {
  const quoted = `‘${result.query}’`;
  if (!result.facets.length && !result.pins.length) {
    return `Nothing on the sheet matches ${quoted}.`;
  }
  const parts: string[] = [];
  if (result.facets.length) parts.push(plural(result.facets.length, "facet"));
  if (result.pins.length) parts.push(plural(result.pins.length, "pin"));
  const pins = result.pins.length > 0 && result.pins.length <= 2
    ? `: ${result.pins.map((p) => `${formatSelector({ hex: p.selector, signature: p.signature }, "dense")} on ${p.facet}`).join(" and ")}`
    : "";
  const selected = foundFacets(result, placed);
  return `Found ${parts.join(" and ")} matching ${quoted}${pins}. Selected ${listNames(selected)}.`;
}
