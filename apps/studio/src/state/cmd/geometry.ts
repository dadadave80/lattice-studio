/**
 * Where cards land and how big they are, from C9's geometry and the tokens' layout lengths (contracts §3.4:
 * C11 does no geometry, so S1 frees every position before placing).
 */
import type { Analysis, Catalog, Point, Project, Size, Sizes } from "@lattice-studio/core";
import { analyze, cardSize, contestedSelectors, freeSlot, placeFacet } from "@lattice-studio/core";
import { layoutMetrics, type SessionState } from "@/contracts";
import { facetOf } from "./shared";

/** Where Tidy starts, and where the first card lands when there's no view to center on (C9's origin, 12 grid). */
const ORIGIN_UNITS = 12;
/** The gap left beside the selected card, in grid units (C9's Tidy row gap). */
const BESIDE_GAP_UNITS = 5;
/** The title bar and the console header, in px (spec L353, L358). */
const TITLE_BAR = 40;
const CONSOLE_HEADER = 36;

/** Every card's size as the sheet draws it at full size: expanded flag, pins and contested rows. */
export function cardSizes(project: Project, catalog: Catalog, analysis: Analysis): Sizes {
  const sizes: Sizes = {};
  for (const name of Object.keys(project.layout)) {
    const entry = project.layout[name];
    const facet = facetOf(catalog, name);
    if (!entry || !facet) continue;
    sizes[name] = sizeOf(facet.name, catalog, analysis, entry.expanded === true, entry.pins);
  }
  return sizes;
}

export function sizeOf(name: string, catalog: Catalog, analysis: Analysis, expanded: boolean, pins: "left" | "right"): Size {
  const facet = facetOf(catalog, name);
  if (!facet) return { width: layoutMetrics.cardWidth, height: layoutMetrics.headerHeight + layoutMetrics.footerHeight };
  const size = cardSize(facet, { metrics: layoutMetrics, expanded, pins, compact: false, contested: contestedSelectors(analysis, name) });
  return { width: size.width, height: size.height };
}

/**
 * The middle of the visible sheet in sheet units, from the project's viewport and the panes' sizes; null
 * without a viewport (S4b stores one per project once the sheet has rendered).
 */
export function viewCenter(session: SessionState, projectId: string): Point | null {
  const viewport = session.viewports[projectId];
  if (!viewport || !(viewport.zoom > 0) || typeof window === "undefined") return null;
  const { panes } = session;
  const width = window.innerWidth - (panes.left.open ? panes.left.size : 0) - (panes.inspector.open ? panes.inspector.size : 0);
  const height = window.innerHeight - TITLE_BAR - CONSOLE_HEADER - (panes.console.open ? panes.console.size : 0);
  return { x: (width / 2 - viewport.x) / viewport.zoom, y: (height / 2 - viewport.y) / viewport.zoom };
}

export type LandingInput = {
  project: Project;
  catalog: Catalog;
  analysis: Analysis;
  session: SessionState;
  facet: string;
  /** The drop point or the pointer (Add facet here…). */
  at?: Point;
};

/**
 * The analysis once `facet` joins the recipe: contested rows that only exist because two facets now export the
 * same selector don't show up until it's actually placed, so sizing from the analysis given (the sheet before
 * this facet) would undercount them (spec L425, L479: colliding rows never collapse). Falls back to the given
 * analysis for a facet that can't be placed (already on the sheet) or a neighbor not built yet: a placement
 * never crashes here.
 */
function afterPlacement(project: Project, catalog: Catalog, facet: string, analysis: Analysis): Analysis {
  try {
    const placed = placeFacet(project, catalog, facet, { x: 0, y: 0 });
    return placed.changed ? analyze(placed.project.recipe, catalog) : analysis;
  } catch {
    return analysis;
  }
}

/**
 * Where a new card lands (spec L425): at the given point, else beside the selected card, else at the center of
 * the view; then snapped and moved to the nearest free slot, so cards never stack. Sized, and every other card
 * sized, from the recipe once this facet has joined it, so a card that turns out contested reserves its real
 * height before `freeSlot` picks its spot.
 */
export function landing(input: LandingInput): Point {
  const { project, catalog, analysis, session, facet, at } = input;
  const metrics = layoutMetrics;
  const settled = afterPlacement(project, catalog, facet, analysis);
  const sizes = cardSizes(project, catalog, settled);
  const size = sizeOf(facet, catalog, settled, false, "right");
  let target: Point;
  if (at && Number.isFinite(at.x) && Number.isFinite(at.y)) {
    target = at;
  } else {
    const beside = session.selection.find((name) => project.layout[name] !== undefined);
    const entry = beside === undefined ? undefined : project.layout[beside];
    const besideSize = beside === undefined ? undefined : sizes[beside];
    const center = viewCenter(session, project.id);
    if (entry && besideSize) {
      target = { x: entry.x + besideSize.width + BESIDE_GAP_UNITS * metrics.grid, y: entry.y };
    } else if (center) {
      target = { x: center.x - size.width / 2, y: center.y - size.height / 2 };
    } else {
      target = { x: ORIGIN_UNITS * metrics.grid, y: ORIGIN_UNITS * metrics.grid };
    }
  }
  return freeSlot(project.layout, sizes, target, size, metrics);
}
