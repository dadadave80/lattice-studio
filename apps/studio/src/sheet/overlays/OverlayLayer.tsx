import type { NotePlacement } from "@lattice-studio/core";
import { useReactFlow, useStore, useStoreApi } from "@xyflow/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { doc, getAnalysis, getCatalog, layoutMetrics, subscribeAnalysis, subscribeCatalog } from "@/contracts";
import { reducedMotion, useReducedMotion } from "@/a11y/preferences";
import type { SheetEdge } from "./edge-data";
import { Note } from "./Note";
import { trackFocusedCard } from "./focused-card";
import { overlayModel, type NoteEntry, type Overlay } from "./overlay-model";
import { reuse } from "./stable";
import styles from "./Note.module.css";

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

type Drawn = { edges: SheetEdge[]; entries: NoteEntry[]; leaving: NoteEntry[] };

const NOTHING: Drawn = { edges: [], entries: [], leaving: [] };

const edgeKey = (edge: SheetEdge): string => edge.id;
const entryKey = (entry: NoteEntry): string => entry.note.id;

/**
 * The analysis drawn on the sheet (WP-S4c): dependency traces and collision ties as React Flow edges (the
 * sheet passes none of its own, so this layer sets them), and the margin notes with their leaders, placed
 * by C9 (`placeNotes`) beside their ties or cards.
 *
 * The geometry is worked out once per frame after the document, the analysis, the catalog or the compact
 * threshold changes, outside React's render, and whatever came out the same keeps its object: an edit
 * re-renders only the notes and edges it changed (spec L825). While cards are dragged, each move re-routes the
 * traces and moves only the notes anchored to what moved; the notes are placed again when the drag commits.
 *
 * The notes are a plain layer, not React Flow's `ViewportPortal`: the portal sits inside the viewport, before
 * every panel in the DOM, and the sheet's Tab order is the card grid, the tool strip, the notes, then the title
 * block (spec L744). As a layer (order 10, contracts `sheet.ts`), its place among the panels is its Tab order.
 */
export function OverlayLayer() {
  const store = useStoreApi();
  const { setEdges } = useReactFlow();
  const root = useStore((s) => s.domNode);
  const reduced = useReducedMotion();
  const [drawn, setDrawn] = useState<Drawn>(NOTHING);
  const heights = useRef<Readonly<Record<string, number>>>({});
  const scheduled = useRef<() => void>(() => undefined);

  useEffect(() => {
    let frame = 0;
    let compact = store.getState().transform[2] < layoutMetrics.compactZoom;
    const model = overlayModel();
    /** The last full layout, which a drag's moves follow; null until the first, and when anything but a drag changes. */
    let placed: Overlay | null = null;
    const compute = () => {
      frame = 0;
      const project = doc.get();
      const inputs = {
        layout: project.layout, recipe: project.recipe, catalog: getCatalog(), analysis: getAnalysis(), compact,
        heights: heights.current,
      };
      const next = placed ? model.follow(placed, inputs) : (placed = model.place(inputs));
      // Resolved notes' heights go with them.
      const live = new Set(next.entries.map((e) => e.note.id));
      if (Object.keys(heights.current).some((id) => !live.has(id))) {
        heights.current = Object.fromEntries(Object.entries(heights.current).filter(([id]) => live.has(id)));
      }
      setDrawn((d) => {
        const edges = reuse(d.edges, next.edges, edgeKey);
        const entries = reuse(d.entries, next.entries, entryKey);
        if (edges === d.edges && entries === d.entries) return d;
        // A resolved note stays a moment to fade (spec L438), unless motion is reduced (spec L784).
        const ids = new Set(entries.map((e) => e.note.id));
        const fade = !reducedMotion();
        const gone = fade ? d.entries.filter((e) => !ids.has(e.note.id)) : [];
        const still = fade ? d.leaving.filter((e) => !ids.has(e.note.id)) : [];
        return { edges, entries, leaving: [...still, ...gone] };
      });
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(compute);
    };
    /** Lay everything out again at the next frame. */
    const replace = () => {
      placed = null;
      schedule();
    };
    scheduled.current = replace;
    const stops = [
      // A drag's live moves only move the notes with their anchors; any other change (the drag's commit
      // included) places them again. A drag that ends where it began, or is cancelled, leaves the layout the
      // notes were placed for, so following it lands them where they were.
      doc.subscribe((state) => (state.lastChange?.kind === "drag" ? schedule() : replace())),
      subscribeAnalysis(replace),
      subscribeCatalog(replace),
      store.subscribe((s) => {
        const now = s.transform[2] < layoutMetrics.compactZoom;
        if (now === compact) return;
        compact = now;
        replace();
      }),
    ];
    replace();
    return () => {
      cancelAnimationFrame(frame);
      scheduled.current = () => undefined;
      for (const stop of stops) stop();
    };
  }, [store]);

  useEffect(() => {
    setEdges(drawn.edges);
  }, [drawn.edges, setEdges]);

  // Which card has keyboard focus, for the traces' reasons below 75% zoom.
  useEffect(() => (root ? trackFocusedCard(root) : undefined), [root]);

  // A note whose measured height is off by more than a grid step asks to be placed again.
  const onHeight = useMemo(
    () => (id: string, height: number) => {
      if (heights.current[id] === height) return;
      heights.current = { ...heights.current, [id]: height };
      scheduled.current();
    },
    [],
  );
  const onLeft = useMemo(
    () => (id: string) => setDrawn((d) => ({ ...d, leaving: d.leaving.filter((e) => e.note.id !== id) })),
    [],
  );

  const leaving = reduced ? [] : drawn.leaving;
  const all = [...drawn.entries.map((e) => ({ ...e, leaving: false })), ...leaving.map((e) => ({ ...e, leaving: true }))];
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
