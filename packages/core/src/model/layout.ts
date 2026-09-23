import type { Analysis } from "./analysis";
import type { Catalog } from "./catalog";
import type { Hex4 } from "./hex";
import type { Project } from "./project";
import type { Recipe } from "./recipe";

/** `Project["layout"]` (contracts §3.1): card positions by facet name, in sheet units (px at 100%). */
export type Layout = Project["layout"];

/** One card's layout entry. */
export type CardLayout = Layout[string];

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Rect = { x: number; y: number; width: number; height: number };

/** Card sizes by facet name. */
export type Sizes = Record<string, Size>;

/**
 * The lengths layout geometry uses, in sheet units (px at 100%). Core can't import the tokens package
 * (spec L102), so the app passes these in: `layoutSizes` from `@lattice-studio/tokens` has these key names
 * and satisfies this type as it is.
 */
export type LayoutMetrics = {
  /** Grid pitch (8). */
  readonly grid: number;
  /** Snap step for positions (8). */
  readonly snap: number;
  readonly cardWidth: number;
  readonly headerHeight: number;
  readonly rowHeight: number;
  readonly footerHeight: number;
  /** Rows a collapsed card shows (6). */
  readonly collapsedRows: number;
  /** More selectors than this collapse (9). */
  readonly expandThreshold: number;
  /** Below this zoom cards draw compact (0.4). */
  readonly compactZoom: number;
  readonly noteWidth: number;
  /** From this zoom trace labels show (0.75). */
  readonly traceLabelZoom: number;
};

/** C9 `cardSize` options (spec L479-L481). */
export type CardSizeOptions = {
  metrics: LayoutMetrics;
  expanded: boolean;
  pins: "left" | "right";
  /** Below 40% zoom: header plus a tick strip. */
  compact: boolean;
  /** Contested selectors on this card; their rows never hide. */
  contested: readonly Hex4[];
};

/** C9 `cardSize`'s result. */
export type CardSize = Size & {
  /** Selector rows drawn. */
  rows: number;
  /** Rows behind "+ n more". */
  hidden: number;
};

/** A drawn connection: a dependency trace, or a 2 px tie between contested pins (spec L434, L480). */
export type Trace = {
  id: string;
  kind: "dependency" | "tie";
  from: string;
  to: string;
  /** Orthogonal path, in sheet units. */
  points: Point[];
  /** Label anchor. */
  mid: Point;
  /** "needs ERC4626". */
  label?: string;
  /** Ties: the contested selector. */
  selector?: Hex4;
};

/** C9 `routeTraces`. */
export type RouteTracesArgs = {
  layout: Layout;
  sizes: Sizes;
  recipe: Recipe;
  catalog: Catalog;
  analysis: Analysis;
  metrics: LayoutMetrics;
};

/** A margin note to place: a problem's note box, beside its ties or cards. */
export type NoteRequest = {
  /** The problem id. */
  id: string;
  size: Size;
  /** Facets the note is about. */
  facets: string[];
  /** Traces it sits beside (ties for a collision). */
  traces?: string[];
};

/** C9 `placeNotes`. */
export type PlaceNotesArgs = {
  layout: Layout;
  sizes: Sizes;
  traces: Trace[];
  notes: NoteRequest[];
  metrics: LayoutMetrics;
};

/**
 * C11 `placeFacet`'s placement: the drop point (or the view's center, or beside the selected card) plus what
 * `freeSlot` needs. The caller computes sizes with `cardSize`, which needs the analysis C11 doesn't have.
 */
export type Placement = {
  at: Point;
  /** Sizes of the cards already on the sheet. */
  sizes: Sizes;
  /** The new card's size. */
  size: Size;
  metrics: LayoutMetrics;
};

/** C11 `setExpanded`'s push: the card's height change and what `pushBelow` needs (spec L479). */
export type Push = {
  /** New height minus old height; a negative `dy` moves nothing. */
  dy: number;
  sizes: Sizes;
  metrics: LayoutMetrics;
};

/** Where a note goes, never over a card, with its leader. */
export type NotePlacement = {
  id: string;
  rect: Rect;
  /** Where the leader touches its target. */
  anchor: Point;
  leader: Point[];
};
