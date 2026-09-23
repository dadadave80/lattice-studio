import type { SortProblemsFn } from "../model/api";
import { type Anchor, PROBLEM_CODES, type Problem, type Severity } from "../model/problems";

const SEVERITY: Record<Severity, number> = { blocker: 0, warning: 1, info: 2 };
const CODE = new Map(PROBLEM_CODES.map((code, at) => [code, at]));

/**
 * Blockers, then warnings, then info (spec L261, L300); within a severity, the catalog order of the first
 * anchor that names a facet (a facet anchor, or a selector anchor with its facet), with problems anchored on
 * no facet (the diamond, an init field, a chain) after them; then the code in the checks table's order; then
 * the id, so no two problems ever tie and the order is the same everywhere.
 */
export const sortProblems: SortProblemsFn = (problems, catalog) => {
  const index = new Map(catalog.facets.map((facet, at) => [facet.name, at]));
  const facetRank = (p: Problem): number => {
    const name = p.where.map(facetOf).find((facet) => facet !== undefined);
    return name === undefined ? Number.POSITIVE_INFINITY : (index.get(name) ?? Number.MAX_SAFE_INTEGER);
  };
  const keyed = problems.map((p) => ({ p, severity: SEVERITY[p.severity], facet: facetRank(p), code: CODE.get(p.code) ?? 0 }));
  keyed.sort(
    (a, b) =>
      a.severity - b.severity ||
      compare(a.facet, b.facet) ||
      a.code - b.code ||
      (a.p.id < b.p.id ? -1 : a.p.id > b.p.id ? 1 : 0),
  );
  return keyed.map((k) => k.p);
};

function facetOf(anchor: Anchor): string | undefined {
  if (anchor.kind === "facet") return anchor.facet;
  if (anchor.kind === "selector") return anchor.facet;
  return undefined;
}

/** Numeric comparison that treats two infinities as equal (Infinity - Infinity is NaN). */
function compare(a: number, b: number): number {
  return a === b ? 0 : a < b ? -1 : 1;
}
