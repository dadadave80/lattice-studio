import type { FacetInstance, LayoutMetrics } from "@lattice-studio/core";
import { rawFacetCardSize } from "@lattice-studio/core";

export function rawCardRows(instance: Exclude<FacetInstance, { kind: "known" }>, expanded: boolean) {
  return expanded ? instance.selectors : instance.selectors.slice(0, 3);
}
export function rawCardSize(instance: Exclude<FacetInstance, { kind: "known" }>, expanded: boolean, metrics: LayoutMetrics) {
  return rawFacetCardSize(instance.selectors, expanded, metrics);
}
