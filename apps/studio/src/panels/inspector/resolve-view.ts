/**
 * Which view the inspector shows (IR L115-L126, spec L358): the session's explicit view, or, while it's null,
 * the one the selection implies: Diamond for none, Facet for one card, Selection for several. An explicit view
 * that no longer applies (its facet was removed, its problem resolved) falls back to the selection's view.
 */
import type { InspectorView } from "@/contracts";
import type { WpId } from "@lattice-studio/core";

export type ResolvedView = NonNullable<InspectorView>;

/** The views S5c draws itself; every other kind comes through the inspector seam. */
export const OWN_KINDS = ["diamond", "facet", "selection", "preview", "problem", "comparison"] as const;
export type OwnKind = (typeof OWN_KINDS)[number];

/** Who registers each seam view (contracts/inspector.ts). */
export const SEAM_OWNERS: Record<Exclude<ResolvedView["kind"], OwnKind>, WpId> = {
  init: "S5d",
  doc: "S12",
  "confirm-addresses": "S13",
};

export function isOwnKind(kind: ResolvedView["kind"]): kind is OwnKind {
  return (OWN_KINDS as readonly string[]).includes(kind);
}

export type ViewInputs = {
  view: InspectorView;
  selection: readonly string[];
  /** `recipe.facets`. */
  placed: readonly string[];
  /** Ids of the problems the analysis raises now. */
  problems: readonly string[];
};

/** The view the selection implies. Selected names that aren't placed are ignored. */
export function selectionView(selection: readonly string[], placed: readonly string[]): ResolvedView {
  const onSheet = selection.filter((name) => placed.includes(name));
  if (onSheet.length === 0) return { kind: "diamond" };
  if (onSheet.length === 1) return { kind: "facet", facet: onSheet[0] as string };
  return { kind: "selection" };
}

export function resolveView({ view, selection, placed, problems }: ViewInputs): ResolvedView {
  const fallback = (): ResolvedView => selectionView(selection, placed);
  if (view === null) return fallback();
  switch (view.kind) {
    case "facet":
      return placed.includes(view.facet) ? view : fallback();
    case "problem":
      return problems.includes(view.id) ? view : fallback();
    case "selection":
      return selection.filter((name) => placed.includes(name)).length > 1 ? view : fallback();
    default:
      return view;
  }
}
