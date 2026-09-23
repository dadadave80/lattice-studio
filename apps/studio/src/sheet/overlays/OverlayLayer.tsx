import type { Analysis, Catalog, CommandRef, Layout, NotePlacement, Rect, Recipe, Sizes, Trace } from "@lattice-studio/core";
import { cardSize, contestedSelectors, isNotImplemented, placeNotes, routeTraces } from "@lattice-studio/core";
import { useStore, useStoreApi } from "@xyflow/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { layoutMetrics, useAnalysis, useCatalog, useDocument } from "@/contracts";
import { useReducedMotion } from "@/a11y/preferences";
import { edgesOf } from "./edge-data";
import { Note } from "./Note";
import { buildNotes, type NoteModel } from "./note-model";
import styles from "./Note.module.css";

/** Grid steps a Place fix lands to the right of the note's card (C9's gap beside a card). */
const BESIDE_GAP_UNITS = 5;

/** Card sizes as the sheet draws them now (compact below 40% zoom), from tokens (spec L824). */
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

/** A note's height before it has measured itself: its lines at the tokens' line heights. */
function estimateHeight(note: NoteModel): number {
  const line = 16;
  const perLine = Math.floor((layoutMetrics.noteWidth - 20) / 7);
  const text = Math.max(1, Math.ceil(note.text.length / perLine));
  const selectors = note.selectors.reduce((n, s) => n + Math.ceil((s.signature.length + 11) / perLine), 0);
  const buttons = note.kind === "collision" ? 3 : note.fixes.length;
  return 16 + line + selectors * line + text * line + 8 + Math.max(1, buttons) * 28;
}

function union(rects: readonly Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x, y, width: right - x, height: bottom - y };
}

type Entry = { note: NoteModel; placement: NotePlacement; frame: Rect; fixes: CommandRef[]; card: string | undefined };

/** A Place fix lands beside the note's card (Flow 5: "Placing puts the provider next to the dependent"). */
function fixesOf(note: NoteModel, cardRect: Rect | undefined): CommandRef[] {
  if (!cardRect) return note.fixes;
  const at = { x: cardRect.x + cardRect.width + BESIDE_GAP_UNITS * layoutMetrics.grid, y: cardRect.y };
  return note.fixes.map((fix) => (fix.id === "facet.place" && fix.args && !fix.args["at"] ? { ...fix, args: { ...fix.args, at } } : fix));
}

/** Follows React Flow's viewport, so the notes sit in sheet units with the cards. */
function Follow({ children }: { children: ReactNode }) {
  const [x, y, zoom] = useStore((s) => s.transform);
  return (
    <div className={styles.viewport} style={{ transform: `translate(${x}px, ${y}px) scale(${zoom})` }}>
      {children}
    </div>
  );
}

function leaderPath(points: NotePlacement["leader"]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");
}

/**
 * The analysis drawn on the sheet (WP-S4c): dependency traces and collision ties as React Flow edges (the
 * sheet passes none of its own, so this layer sets them), and the margin notes with their leaders, placed
 * by C9 (`placeNotes`) beside their ties or cards.
 *
 * The notes are a plain layer, not React Flow's `ViewportPortal`: the portal sits inside the viewport, before
 * every panel in the DOM, and the sheet's Tab order is the card grid, the tool strip, the notes, then the title
 * block (spec L744). As a layer (order 10, contracts `sheet.ts`), its place among the panels is its Tab order.
 */
export function OverlayLayer() {
  const layout = useDocument((s) => s.project.layout);
  const recipe = useDocument((s) => s.project.recipe);
  const catalog = useCatalog();
  const analysis = useAnalysis();
  const compact = useStore((s) => s.transform[2] < layoutMetrics.compactZoom);
  const reduced = useReducedMotion();
  const store = useStoreApi();

  const sizes = useMemo(() => sizesOf(layout, catalog, analysis, compact), [layout, catalog, analysis, compact]);
  const traces = useMemo(() => tracesOf(layout, sizes, recipe, catalog, analysis), [layout, sizes, recipe, catalog, analysis]);
  const edges = useMemo(() => edgesOf(traces, layout, sizes), [traces, layout, sizes]);
  // The sheet passes neither `edges` nor `defaultEdges`, and without either React Flow's `setEdges` drops the
  // update. Setting them as default edges (what the `defaultEdges` prop does) makes them React Flow's own.
  useEffect(() => {
    store.getState().setDefaultNodesAndEdges(undefined, edges);
  }, [edges, store]);

  const notes = useMemo(() => buildNotes(analysis, catalog), [analysis, catalog]);
  const [heights, setHeights] = useState<Readonly<Record<string, number>>>({});

  const entries = useMemo((): Entry[] => {
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
    return notes.flatMap((note) => {
      const placement = byId.get(note.id);
      if (!placement) return [];
      const card = note.facets.find(placed);
      const entry = card === undefined ? undefined : layout[card];
      const size = card === undefined ? undefined : sizes[card];
      const cardRect = entry && size ? { x: entry.x, y: entry.y, ...size } : undefined;
      const frame = cardRect ? union([placement.rect, cardRect]) : placement.rect;
      return [{ note, placement, frame, fixes: fixesOf(note, cardRect), card }];
    });
  }, [notes, layout, sizes, traces, heights]);

  // A resolved note stays a moment to fade (spec L438), unless motion is reduced (spec L784).
  const [shown, setShown] = useState<{ entries: Entry[]; leaving: Entry[] }>({ entries, leaving: [] });
  if (shown.entries !== entries) {
    const ids = new Set(entries.map((e) => e.note.id));
    const gone = reduced ? [] : shown.entries.filter((e) => !ids.has(e.note.id));
    const still = reduced ? [] : shown.leaving.filter((e) => !ids.has(e.note.id));
    setShown({ entries, leaving: [...still, ...gone] });
  }
  const leaving = reduced ? [] : shown.leaving;

  const onHeight = useMemo(
    () => (id: string, height: number) => setHeights((h) => (h[id] === height ? h : { ...h, [id]: height })),
    [],
  );
  const onLeft = useMemo(
    () => (id: string) => setShown((s) => ({ ...s, leaving: s.leaving.filter((e) => e.note.id !== id) })),
    [],
  );

  const all = [...entries.map((e) => ({ ...e, leaving: false })), ...leaving.map((e) => ({ ...e, leaving: true }))];
  return (
    <div className={styles.layer} data-sheet-layer="notes">
      <Follow>
        <svg className={styles.leaders} aria-hidden="true">
          {all.map(({ note, placement, leaving: gone }) =>
            placement.leader.length > 1 && !gone ? (
              <path key={note.id} className={styles.leader} data-kind={note.kind} d={leaderPath(placement.leader)} />
            ) : null,
          )}
        </svg>
        {all.map(({ note, placement, frame, fixes, card, leaving: gone }) => (
          <Note
            key={note.id}
            note={note}
            rect={placement.rect}
            frame={frame}
            fixes={fixes}
            card={card}
            leaving={gone}
            onHeight={onHeight}
            onLeft={onLeft}
          />
        ))}
      </Follow>
    </div>
  );
}
