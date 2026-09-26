/** The Migrate review's words (spec L290): its summary line and how a change is named. */
import { plural } from "@lattice-studio/core";
import { catalogVersion } from "./copy";
import { reviewCounts, type ContractChange, type MigrationReview, type SelectorChange } from "./migrate-diff";

/** The review's first line: what moving changes, in counts (IR L178: initial focus on the summary). */
export function reviewSummary(review: MigrationReview): string {
  const from = catalogVersion(review.fromTag);
  const to = catalogVersion(review.toTag);
  const { added, removed, code, missing } = reviewCounts(review);
  const parts: string[] = [];
  if (added > 0) parts.push(`${plural(added, "selector")} added`);
  if (removed > 0) parts.push(`${plural(removed, "selector")} removed`);
  if (code > 0) parts.push(`new code for ${plural(code, "contract")}`);
  if (missing > 0) parts.push(`${plural(missing, "facet")} not in ${to}`);
  const head = review.complete
    ? `Catalog ${from} to ${to}`
    : `Studio doesn't have catalog ${from} any more, so this compares the recipe with ${to}`;
  return parts.length === 0 ? `${head}: nothing this project uses changes.` : `${head}: ${parts.join(", ")}.`;
}

export function kindLabel(change: ContractChange): string {
  if (change.kind === "init") return "init";
  if (change.kind === "shared") return "shared contract";
  return "facet";
}

/** "guardianCount() 0x1a2b3c4d", or the hex alone when the old catalog isn't there to name it. */
export function selectorText(selector: SelectorChange): string {
  return selector.signature === "" ? selector.hex : `${selector.signature} ${selector.hex}`;
}

export function shortHex(hex: string): string {
  return `${hex.slice(0, 6)}…${hex.slice(-4)}`;
}
