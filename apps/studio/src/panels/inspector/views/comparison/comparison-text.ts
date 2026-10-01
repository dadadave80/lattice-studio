/**
 * The Comparison view's words (IR L116, spec L576): the verdict sentence, selectors in the dense form, and the
 * plain-text report that Copy details puts on the clipboard. Pure: no React, no stores.
 */
import type { Address, Catalog, Hex, Hex4, PlanComparison, PlanEntry } from "@lattice-studio/core";
import { formatSelector, isCoreFacet, plural } from "@lattice-studio/core";

/** A selector's signature from the catalog, when any facet exports it. */
export type SignatureOf = (hex: Hex4) => string | undefined;

/** Looks signatures up in the catalog's facets (hex compared lowercase). */
export function signatureLookup(catalog: Pick<Catalog, "facets"> | null): SignatureOf {
  const byHex = new Map<string, string>();
  for (const facet of catalog?.facets ?? []) {
    for (const selector of facet.selectors) {
      const hex = selector.hex.toLowerCase();
      if (!byHex.has(hex)) byHex.set(hex, selector.signature);
    }
  }
  return (hex) => byHex.get(hex.toLowerCase());
}

/** `transfer · 0xa9059cbb` without the backticks (spec L670); the hex alone when no catalog facet names it. */
export function denseSelector(hex: Hex4, signatureOf: SignatureOf): string {
  const signature = signatureOf(hex);
  return signature === undefined ? hex : formatSelector({ hex, signature }, "dense").replaceAll("`", "");
}

/** "the core and 12 facets, 120 selectors": the plan's size, the core's two Adds named rather than counted. */
export function planSize(plan: readonly Pick<PlanEntry, "facet" | "selectors">[]): string {
  const selectors = plan.reduce((sum, entry) => sum + entry.selectors.length, 0);
  const cards = plan.filter((entry) => !isCoreFacet(entry.facet)).length;
  return `the core and ${plural(cards, "facet")}, ${plural(selectors, "selector")}`;
}

/** The verdict (spec L576): "Diamond matches the sheet: the core and 12 facets, 120 selectors." or the mismatch line. */
export function verdict(comparison: Pick<PlanComparison, "matches">, plan: readonly Pick<PlanEntry, "facet" | "selectors">[]): string {
  return comparison.matches ? `Diamond matches the sheet: ${planSize(plan)}.` : "Deployed, but doesn't match the sheet";
}

export type ComparisonReport = {
  /** "Sepolia". */
  chain: string;
  chainId: number;
  address: Address;
  /** The deployment record's recipe hash; null when there's no record. */
  recordHash: Hex | null;
  sheetHash: Hex;
  plan: readonly Pick<PlanEntry, "facet" | "selectors">[];
  /** The comparison once `facets()` was read; otherwise `status` says why there's none. */
  comparison: PlanComparison | null;
  /** What the view shows instead of a comparison: "Chain checks need a connection.". */
  status?: string;
};

/**
 * The plain-text report Copy details copies: chain, address, both recipe hashes and every difference, with
 * addresses in full and selectors as `transfer · 0xa9059cbb`.
 */
export function comparisonText(report: ComparisonReport, signatureOf: SignatureOf): string {
  const lines = [
    "Compare with the sheet",
    `Chain: ${report.chain} (${report.chainId})`,
    `Address: ${report.address}`,
    `Record's recipe hash: ${report.recordHash ?? "No record"}`,
    `Sheet's recipe hash: ${report.sheetHash}`,
    "",
  ];
  const { comparison } = report;
  if (comparison === null) {
    lines.push(report.status ?? "facets() wasn't read.");
    return lines.join("\n");
  }
  lines.push(verdict(comparison, report.plan));
  const dense = (selectors: readonly Hex4[]) => selectors.map((hex) => denseSelector(hex, signatureOf)).join(", ");
  if (comparison.missing.length > 0) {
    lines.push("", "Missing on chain:");
    for (const entry of comparison.missing) lines.push(`  ${entry.facet}: ${dense(entry.selectors)}`);
  }
  if (comparison.extra.length > 0) {
    lines.push("", "Not in the plan:");
    for (const entry of comparison.extra) lines.push(`  ${entry.address}: ${dense(entry.selectors)}`);
  }
  if (comparison.moved.length > 0) {
    lines.push("", "Moved:");
    for (const entry of comparison.moved) {
      lines.push(`  ${denseSelector(entry.selector, signatureOf)}: planned at ${entry.expected}, on chain at ${entry.actual}`);
    }
  }
  return lines.join("\n");
}
