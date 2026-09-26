/**
 * Gaps this suite found and filed (the Q2 report lists each with its fix package). A finding that matches one is
 * recorded as a `known-gap` annotation on the test instead of failing it; any other finding fails. When the owner
 * fixes a gap, its entry stops matching and can be deleted; nothing here has to change first.
 */
import type { TestInfo } from "@playwright/test";

export type KnownGap = {
  id: string;
  /** The work package and folder that owns the fix. */
  owner: string;
  /** The spec line and WCAG criterion it breaks. */
  rule: string;
  /** Whether a finding line (see `report.ts` and `focus.spec.ts`) is this gap. */
  matches(finding: string): boolean;
};

export const KNOWN_GAPS: readonly KnownGap[] = [
  {
    id: "note-targets-scale-with-zoom",
    owner: "FX28 · S4c · apps/studio/src/sheet/overlays",
    rule: "spec L770 · WCAG 2.5.8 target size: a note's buttons (Keep …, Route to …, Choose per selector…, the owner menu) shrink with the sheet's zoom, to 7-18 px tall at the 30% a fit of 30 cards gives",
    matches: (finding) =>
      finding.includes("target-size ") &&
      (/data-variant="secondary" data-trigger-disabled="">(Keep |Route to |Choose per selector…)/.test(finding) ||
        // The owner menu's trigger ("Owner: …"), whose text the snippet cuts off.
        finding.includes('<button type="button" tabindex="0" aria-haspopup="menu" aria-expanded="false" data-variant="secondary" data-trigger-disabled="">')),
  },
  {
    id: "zoom-readout-covers-focused-card",
    owner: "FX28 · S4b · apps/studio/src/sheet/canvas/sheet-view.ts (ensureVisible, clearOf, cardRect)",
    rule: "spec L771 · WCAG 2.4.11 (partly obscured, so the spec's stricter reading): at 200% on the 30-card sheet, ⌘/Ctrl+↓ to DIAAdapter leaves the card's bottom-left corner 9 x 24 px under the \"Zoom 200%\" readout, though the readout is a Panel that floatingRects lists",
    matches: (finding) => /under floating UI at \{"x":\d+(\.\d+)?,"y":\d+(\.\d+)?,"width":56,"height":24\}/.test(finding),
  },
];

/** Splits findings into known gaps (annotated on `info`) and the rest, which fail the test. */
export function withoutKnownGaps(findings: readonly string[], info: TestInfo): string[] {
  const unknown: string[] = [];
  const hit = new Set<KnownGap>();
  for (const finding of findings) {
    const gap = KNOWN_GAPS.find((g) => g.matches(finding));
    if (gap) hit.add(gap);
    else unknown.push(finding);
  }
  for (const gap of hit) info.annotations.push({ type: "known-gap", description: `${gap.id} · ${gap.owner} · ${gap.rule}` });
  return unknown;
}
