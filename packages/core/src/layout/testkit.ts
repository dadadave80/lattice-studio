/**
 * Test helpers for the layout tests: analyses with collisions, and random sheets. Not re-exported by `index.ts`.
 */
import type { Analysis } from "../model/analysis";
import type { Catalog, Facet } from "../model/catalog";
import type { Hex4 } from "../model/hex";
import type { Layout, LayoutMetrics, Rect, Sizes } from "../model/layout";
import { problem } from "../model/problems";
import { makeCatalog, makeFacet } from "../testing/builders";
import { sel } from "../testing/ids";
import { overlaps } from "./geometry";

/** An analysis with nothing but these SEL-01 collisions. */
export function analysisWith(collisions: readonly { selector: Hex4; contenders: string[] }[] = []): Analysis {
  return {
    recipeHash: `0x${"0".repeat(64)}`,
    routing: {},
    problems: collisions.map((c) =>
      problem("SEL-01", [{ kind: "selector", selector: c.selector }], {
        selector: c.selector,
        signature: `f${c.selector}()`,
        contenders: c.contenders,
      }, [], { id: `SEL-01:${c.selector}` }),
    ),
    plan: [],
    init: null,
    stats: { facets: 0, routed: 0, exported: 0, excluded: 0, namespaces: 0 },
  };
}

/** A facet with `count` selectors numbered from `first` (plus any `extra`), and optional requirements. */
export function facetWith(name: string, count: number, first = 1, extra: Hex4[] = [], requires: string[][] = []): Facet {
  const selectors = [...Array.from({ length: count }, (_, i) => sel(first + i)), ...extra].map((hex) => ({
    hex,
    signature: `f${hex}()`,
  }));
  return makeFacet({
    name,
    selectors,
    requires: requires.map((anyOf) => ({ anyOf, strength: "hard", reason: "test" })),
  });
}

/** Every pair of cards that overlaps, as "A/B". */
export function overlapping(layout: Layout, sizes: Sizes, metrics: LayoutMetrics): string[] {
  const names = Object.keys(layout).sort();
  const rect = (n: string): Rect => {
    const e = layout[n];
    const s = sizes[n] ?? { width: metrics.cardWidth, height: metrics.headerHeight + metrics.footerHeight };
    return { x: e?.x ?? 0, y: e?.y ?? 0, width: s.width, height: s.height };
  };
  const out: string[] = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i];
      const b = names[j];
      if (a !== undefined && b !== undefined && overlaps(rect(a), rect(b))) out.push(`${a}/${b}`);
    }
  }
  return out;
}

/** A random-looking but seeded catalog of `n` facets with requirements and shared (contested) selectors. */
export type SheetSpec = {
  counts: number[];
  requires: number[][];
  shared: number[][];
};

/** Builds the catalog, and the collisions (one per shared selector placed on two or more facets). */
export function buildSheet(spec: SheetSpec): {
  catalog: Catalog;
  names: string[];
  collisions: { selector: Hex4; contenders: string[] }[];
} {
  const names = spec.counts.map((_, i) => `F${String(i).padStart(2, "0")}`);
  const sharedOf = new Map<number, Hex4[]>();
  const collisions: { selector: Hex4; contenders: string[] }[] = [];
  spec.shared.forEach((members, k) => {
    const unique = [...new Set(members)].filter((m) => m < names.length).sort((a, b) => a - b);
    if (unique.length < 2) return;
    const selector = sel(900_000 + k);
    for (const m of unique) sharedOf.set(m, [...(sharedOf.get(m) ?? []), selector]);
    collisions.push({ selector, contenders: unique.map((m) => names[m] ?? "") });
  });
  const facets = spec.counts.map((count, i) =>
    facetWith(
      names[i] ?? "",
      count,
      1000 * (i + 1),
      sharedOf.get(i) ?? [],
      (spec.requires[i] ?? []).filter((d) => d < names.length && d !== i).map((d) => [names[d] ?? ""]),
    ),
  );
  return { catalog: makeCatalog({ facets }), names, collisions };
}
