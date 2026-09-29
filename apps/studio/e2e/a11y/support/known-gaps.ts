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
    // A disabled menu item shows its reason under the label inside the item (`MenuItem.tsx`: named by the label,
    // described by the reason), so the item's visible text is more than its name. Found when FX45 switched the rule
    // on (the Export menu with blockers).
    id: "FX45-G2 disabled menu item reason in its text",
    owner: "S0 · apps/studio/src/ui/overlays (MenuItem and the other menu items)",
    rule: "spec L779 · WCAG 2.5.3",
    matches: (finding) => /: label-content-name-mismatch .*role="menuitem"[^>]*aria-disabled="true"/.test(finding),
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
