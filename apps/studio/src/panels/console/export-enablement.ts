/**
 * The words an export gives when it can't run (spec L513-L517, L699). Plain functions of their inputs with no app
 * imports, so the e2e flows import them to predict what the app says; the `enabled` checks that read the stores
 * and the keymap are `export-gates.ts`'s.
 */
import type { Analysis } from "@lattice-studio/core";
import { plural } from "@lattice-studio/core";

/** While the catalog loads or after it failed. */
export const CATALOG_NOT_LOADED = "The catalog hasn't loaded yet · Wait for it to finish";
/** An empty sheet has nothing to export (spec L378's "Place facets first"). */
export const PLACE_FACETS_FIRST = "Place facets first";
/** The Script and Recipe JSON tabs on an empty sheet (spec L699). */
export const PLACE_FACETS_TO_GENERATE = "Place facets to generate a script.";

/** `problem.next`'s default binding: what the reason names while the keymap leaves it alone. */
export const NEXT_PROBLEM_DEFAULT_KEY = "F8";

/**
 * "Resolve 2 blockers to export · F8" (spec L513, L661, L699). `key` is `problem.next`'s key in effect, as
 * `export-gates.ts`'s `nextProblemKey` reads it from the keymap; null when it has none, and the reason names no
 * key. The app always passes it; the default serves callers that run on the default keymap (the e2e flows).
 */
export function resolveToExport(blockers: number, key: string | null = NEXT_PROBLEM_DEFAULT_KEY): string {
  const text = `Resolve ${plural(blockers, "blocker")} to export`;
  return key === null ? text : `${text} · ${key}`;
}

export function blockerCount(analysis: Pick<Analysis, "problems">): number {
  return analysis.problems.filter((p) => p.severity === "blocker").length;
}

/**
 * "Tick the acknowledgement first" (the same words as `chain/review/entry-copy.ts`'s `tickFirst`, spec L573).
 * Kept as its own copy rather than an import: `chain/review/model.ts` is the review's lazy chunk, and
 * importing its `pendingAcks` here grew the entry by ~2.9 KB gz (measured with `size.ts --build`); the review's
 * words are covered against this copy in `exports.browser.test.tsx`.
 */
export function tickAcknowledgementsFirst(count: number): string {
  return count === 1 ? "Tick the acknowledgement first" : `Tick the ${count} acknowledgements first`;
}
