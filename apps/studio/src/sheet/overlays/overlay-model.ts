/**
 * What the overlay layer draws, from the document, the analysis and the zoom: C9's traces as React Flow edges,
 * and the notes placed by C9 (`placeNotes`) with the rect F8 scrolls into view and the fixes they offer. Pure.
 */
import type { Analysis, Catalog, CommandRef, Layout, NotePlacement, Rect, Recipe, Sizes, Trace } from "@lattice-studio/core";
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

export type NoteEntry = {
  note: NoteModel;
  placement: NotePlacement;
  /** The note and its first card: what F8 brings into view. */
  frame: Rect;
  fixes: CommandRef[];
  card: string | undefined;
};

export type Overlay = { edges: SheetEdge[]; entries: NoteEntry[] };

/** Card sizes as the sheet draws them now, from tokens (spec L824). */
function sizesOf(layout: Layout, catalog: Catalog | null, analysis: Analysis, compact: boolean): Sizes {
  const sizes: Sizes = {};
  for (const [name, entry] of Object.entries(layout)) {
    const facet = catalog?.facets.find((f) => f.name === name);
    if (!facet) continue;
    const size = cardSize(facet, {
      metrics: layoutMetrics,
      expanded: entry.expanded === true,
      pins: entry.pins,
      compact,
      contested: contestedSelectors(analysis, name),
    });
    sizes[name] = { width: size.width, height: size.height };
  }
  return sizes;
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

export function computeOverlay({ layout, recipe, catalog, analysis, compact, heights }: OverlayInputs): Overlay {
  const sizes = sizesOf(layout, catalog, analysis, compact);
  const traces = tracesOf(layout, sizes, recipe, catalog, analysis);
  const notes = buildNotes(analysis, catalog);
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
  const entries = notes.flatMap((note): NoteEntry[] => {
    const placement = byId.get(note.id);
    if (!placement) return [];
    const card = note.facets.find(placed);
    const entry = card === undefined ? undefined : layout[card];
    const size = card === undefined ? undefined : sizes[card];
    const cardRect = entry && size ? { x: entry.x, y: entry.y, ...size } : undefined;
    const frame = cardRect ? union([placement.rect, cardRect]) : placement.rect;
    return [{ note, placement, frame, fixes: fixesOf(note, cardRect), card }];
  });
  return { edges: edgesOf(traces, layout, sizes), entries };
}
