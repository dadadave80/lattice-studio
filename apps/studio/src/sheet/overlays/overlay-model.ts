/**
 * What the overlay layer draws, from the document, the analysis and the zoom: C9's traces as React Flow edges,
 * and the notes placed by C9 (`placeNotes`) with the rect F8 scrolls into view and the fixes they offer. Pure,
 * apart from the caches an `overlayModel()` keeps between calls.
 *
 * While cards are dragged (spec L816, L825), `follow` re-routes the traces but doesn't place the notes again:
 * each note moves by as much as its anchor (its tie's midpoint or its card) has moved since the last placement,
 * so a note whose anchor stayed put keeps its object and doesn't re-render. The next `place` lays them out again.
 */
import type {
  Analysis, Catalog, CardLayout, CommandRef, Facet, Layout, NotePlacement, Point, Rect, Recipe, Sizes, Trace,
} from "@lattice-studio/core";
import { cardSize, contestedSelectors, isNotImplemented, placeNotes, routeTraces } from "@lattice-studio/core";
import { layoutMetrics } from "@/contracts";
import { edgesOf, type SheetEdge } from "./edge-data";
import { buildNotes, type NoteModel } from "./note-model";

/** Grid steps a Place fix lands to the right of the note's card (C9's gap beside a card). */
const BESIDE_GAP_UNITS = 5;

export type OverlayInputs = {
  layout: Layout;
  recipe: Recipe;
  catalog: Catalog | null;
  analysis: Analysis;
  /** Below 40% zoom cards draw compact, so traces anchor to their tick strips. */
  compact: boolean;
  /** Heights the notes measured, by note id. */
  heights: Readonly<Record<string, number>>;
};

/** What a note was placed against, and where that was: a drag moves the note by as much as this moves. */
export type NoteAnchor =
  | { kind: "tie"; trace: string; at: Point }
  | { kind: "card"; facet: string; at: Point }
  | { kind: "none" };

export type NoteEntry = {
  note: NoteModel;
  placement: NotePlacement;
  /** The note and its first card: what F8 brings into view. */
  frame: Rect;
  fixes: CommandRef[];
  card: string | undefined;
  anchor: NoteAnchor;
};

export type Overlay = { edges: SheetEdge[]; entries: NoteEntry[] };

type SizeInputs = { facet: Facet; entry: CardLayout; compact: boolean; analysis: Analysis };

/**
 * Card sizes as the sheet draws them now, from tokens (spec L824). A card's size is worked out again only when
 * its facet, its expanded state, its pins side, the zoom's compact threshold or the analysis changed: a drag
 * changes none of them.
 */
function sizeCache(): (layout: Layout, catalog: Catalog | null, analysis: Analysis, compact: boolean) => Sizes {
  let facets: { catalog: Catalog; byName: Map<string, Facet> } | null = null;
  const cache = new Map<string, { inputs: SizeInputs; width: number; height: number }>();
  const stale = (was: SizeInputs, now: SizeInputs): boolean =>
    was.facet !== now.facet ||
    was.compact !== now.compact ||
    was.analysis !== now.analysis ||
    (was.entry !== now.entry && (was.entry.expanded !== now.entry.expanded || was.entry.pins !== now.entry.pins));
  return (layout, catalog, analysis, compact) => {
    if (!catalog) return {};
    if (facets?.catalog !== catalog) facets = { catalog, byName: new Map(catalog.facets.map((f) => [f.name, f])) };
    const sizes: Sizes = {};
    for (const [name, entry] of Object.entries(layout)) {
      const facet = facets.byName.get(name);
      if (!facet) continue;
      const inputs: SizeInputs = { facet, entry, compact, analysis };
      let hit = cache.get(name);
      if (!hit || stale(hit.inputs, inputs)) {
        const size = cardSize(facet, {
          metrics: layoutMetrics,
          expanded: entry.expanded === true,
          pins: entry.pins,
          compact,
          contested: contestedSelectors(analysis, name),
        });
        hit = { inputs, width: size.width, height: size.height };
        cache.set(name, hit);
      }
      sizes[name] = { width: hit.width, height: hit.height };
    }
    return sizes;
  };
}

/** C9's traces, or none while a neighbor isn't built. */
function tracesOf(layout: Layout, sizes: Sizes, recipe: Recipe, catalog: Catalog | null, analysis: Analysis): Trace[] {
  if (!catalog) return [];
  try {
    return routeTraces({ layout, sizes, recipe, catalog, analysis, metrics: layoutMetrics });
  } catch (error) {
    if (isNotImplemented(error)) return [];
    throw error;
  }
}

/** The words a note's button shows, near enough to size it (the registry titles them when it renders). */
function buttonLabels(note: NoteModel): string[] {
  if (note.kind === "collision") {
    const [a = "", b = ""] = note.contenders;
    const choose = note.selectors.length > 1 ? ["Choose per selector…"] : [];
    return note.contenders.length === 2 ? [`Keep ${a}`, `Route to ${b}`, ...choose] : [`Owner: ${a} ▾`, ...choose];
  }
  return note.fixes.map((fix) => {
    const facet = typeof fix.args?.["facet"] === "string" ? fix.args["facet"] : "";
    if (fix.id === "facet.place") return `Place ${facet}`;
    if (fix.id === "selector.route") return `Route to ${facet}`;
    if (fix.id === "facet.remove") return "Remove a facet name";
    return "Compare options…";
  });
}

/**
 * A note's height before it has measured itself, from the tokens: 20 px lines of body and code text across the
 * note's width, and 24 px buttons packed into rows (Note.module.css). The measured height replaces it when it
 * differs by more than a grid step.
 */
export function estimateHeight(note: NoteModel): number {
  const line = 20;
  const inner = layoutMetrics.noteWidth - 22;
  const lines = (text: string, charWidth: number) => Math.max(1, Math.ceil((text.length * charWidth) / inner));
  const selectors = note.selectors.reduce((n, s) => n + lines(`${s.signature} ${s.hex}`, 7.8), 0);
  let rows = 0;
  let used = inner;
  for (const label of buttonLabels(note)) {
    const width = Math.min(inner, label.length * 7.4 + 18);
    if (used + 4 + width > inner) {
      rows += 1 + Math.floor((label.length * 7.4 + 18) / inner);
      used = width;
    } else {
      used += 4 + width;
    }
  }
  const caption = 16;
  const body = (selectors ? 4 + selectors * line : 0) + 4 + lines(note.text, 7) * line;
  const actions = rows ? 8 + rows * 24 + (rows - 1) * 4 : 0;
  return 16 + caption + body + actions;
}

function union(rects: readonly Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x, y, width: right - x, height: bottom - y };
}

/** A Place fix lands beside the note's card (Flow 5: "Placing puts the provider next to the dependent"). */
function fixesOf(note: NoteModel, cardRect: Rect | undefined): CommandRef[] {
  if (!cardRect) return note.fixes;
  const at = { x: cardRect.x + cardRect.width + BESIDE_GAP_UNITS * layoutMetrics.grid, y: cardRect.y };
  return note.fixes.map((fix) => (fix.id === "facet.place" && fix.args && !fix.args["at"] ? { ...fix, args: { ...fix.args, at } } : fix));
}

/** Where `anchor`'s target is now, or null when it has left the sheet. */
function anchorNow(anchor: NoteAnchor, layout: Layout, mids: ReadonlyMap<string, Point>): Point | null {
  if (anchor.kind === "tie") return mids.get(anchor.trace) ?? null;
  if (anchor.kind === "card") {
    const entry = layout[anchor.facet];
    return entry ? { x: entry.x, y: entry.y } : null;
  }
  return null;
}

const shiftPoint = (p: Point, dx: number, dy: number): Point => ({ x: p.x + dx, y: p.y + dy });
const shiftRect = (r: Rect, dx: number, dy: number): Rect => ({ ...r, x: r.x + dx, y: r.y + dy });

/** `entry` moved by as much as its anchor moved; the same object when the anchor stayed put or left. */
function followed(entry: NoteEntry, layout: Layout, mids: ReadonlyMap<string, Point>): NoteEntry {
  const { anchor } = entry;
  if (anchor.kind === "none") return entry;
  const now = anchorNow(anchor, layout, mids);
  if (!now) return entry;
  const dx = now.x - anchor.at.x;
  const dy = now.y - anchor.at.y;
  if (dx === 0 && dy === 0) return entry;
  const { placement } = entry;
  return {
    ...entry,
    placement: {
      ...placement,
      rect: shiftRect(placement.rect, dx, dy),
      anchor: shiftPoint(placement.anchor, dx, dy),
      leader: placement.leader.map((p) => shiftPoint(p, dx, dy)),
    },
    frame: shiftRect(entry.frame, dx, dy),
  };
}

export type OverlayModel = {
  /** Everything laid out again: the traces and every note (after an edit, the analysis, the zoom, a height). */
  place(inputs: OverlayInputs): Overlay;
  /**
   * During a drag: the traces again, and `placed`'s notes moved with their anchors. `placed` is the last
   * `place` result; its entries come back as they are wherever an anchor didn't move.
   */
  follow(placed: Overlay, inputs: OverlayInputs): Overlay;
};

/** The overlay's model, with its caches: one per layer. */
export function overlayModel(): OverlayModel {
  const sizesOf = sizeCache();
  let notesMemo: { analysis: Analysis; catalog: Catalog | null; notes: NoteModel[] } | null = null;
  const notesOf = (analysis: Analysis, catalog: Catalog | null): NoteModel[] => {
    if (notesMemo?.analysis !== analysis || notesMemo.catalog !== catalog) {
      notesMemo = { analysis, catalog, notes: buildNotes(analysis, catalog) };
    }
    return notesMemo.notes;
  };

  const place = ({ layout, recipe, catalog, analysis, compact, heights }: OverlayInputs): Overlay => {
    const sizes = sizesOf(layout, catalog, analysis, compact);
    const traces = tracesOf(layout, sizes, recipe, catalog, analysis);
    const notes = notesOf(analysis, catalog);
    const tieIds = new Set(traces.map((t) => t.id));
    const placed = (name: string) => layout[name] !== undefined && sizes[name] !== undefined;
    const requests = notes.map((note) => {
      const facets = note.facets.filter(placed);
      const selectors = new Set<string>(note.selectors.map((s) => s.hex));
      const ties =
        note.kind === "collision"
          ? traces.filter((t) => t.kind === "tie" && t.selector !== undefined && selectors.has(t.selector) && facets.includes(t.from)).map((t) => t.id)
          : [];
      return {
        id: note.id,
        size: { width: layoutMetrics.noteWidth, height: heights[note.id] ?? estimateHeight(note) },
        facets,
        ...(ties.length ? { traces: ties } : {}),
      };
    });
    let placements: NotePlacement[];
    try {
      placements = placeNotes({ layout, sizes, traces, notes: requests, metrics: layoutMetrics });
    } catch (error) {
      if (!isNotImplemented(error)) throw error;
      placements = [];
    }
    const byId = new Map(placements.map((p) => [p.id, p]));
    const mids = new Map(traces.map((t) => [t.id, t.mid]));
    const requested = new Map(requests.map((r) => [r.id, r]));
    const entries = notes.flatMap((note): NoteEntry[] => {
      const placement = byId.get(note.id);
      if (!placement) return [];
      const card = note.facets.find(placed);
      const entry = card === undefined ? undefined : layout[card];
      const size = card === undefined ? undefined : sizes[card];
      const cardRect = entry && size ? { x: entry.x, y: entry.y, ...size } : undefined;
      const frame = cardRect ? union([placement.rect, cardRect]) : placement.rect;
      // What C9 placed it against: the first of its ties on the sheet, else its first card on the sheet.
      const tie = requested.get(note.id)?.traces?.find((id) => tieIds.has(id));
      const tieMid = tie === undefined ? undefined : mids.get(tie);
      const anchor: NoteAnchor =
        tie !== undefined && tieMid
          ? { kind: "tie", trace: tie, at: tieMid }
          : card !== undefined && entry
            ? { kind: "card", facet: card, at: { x: entry.x, y: entry.y } }
            : { kind: "none" };
      return [{ note, placement, frame, fixes: fixesOf(note, cardRect), card, anchor }];
    });
    return { edges: edgesOf(traces, layout, sizes), entries };
  };

  const follow = (placed: Overlay, { layout, recipe, catalog, analysis, compact }: OverlayInputs): Overlay => {
    const sizes = sizesOf(layout, catalog, analysis, compact);
    const traces = tracesOf(layout, sizes, recipe, catalog, analysis);
    const mids = new Map(traces.map((t) => [t.id, t.mid]));
    return { edges: edgesOf(traces, layout, sizes), entries: placed.entries.map((entry) => followed(entry, layout, mids)) };
  };

  return { place, follow };
}

/** One full layout with fresh caches (tests, and callers without a layer). */
export function computeOverlay(inputs: OverlayInputs): Overlay {
  return overlayModel().place(inputs);
}
