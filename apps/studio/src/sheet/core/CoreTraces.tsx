import type { Layout, Sizes } from "@lattice-studio/core";
import { useStoreApi } from "@xyflow/react";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { doc, useAnalysis, useCatalog, useDocument } from "@/contracts";
import { cardSizes } from "@/sheet/canvas/geometry";
import { createPainter, type Painter, type Pads, type TraceTarget } from "./painter";
import styles from "./core.module.css";

/** How a trace draws: 1.5 px ink (hover, focus, the CUT pad hot), 2 px accent (selected), accent fading (just placed). */
export type Tone = "soft" | "live" | "flash";

export type TraceSpec = {
  name: string;
  tone: Tone;
  /** Which pad it ends on: the cut facet's on CUT, every other card's on FALLBACK. */
  to: "fallback" | "cut";
  /** Sheet units from the card's top of each routed row's stub; empty unless live. */
  stubs: readonly number[];
};

let lastLayout: Layout | null = null;
let lastKey = "";

/** Whether two layouts place the same cards with the same pins and expanded flags, wherever they sit. */
function sameShape(a: Layout, b: Layout): boolean {
  let count = 0;
  for (const name in b) {
    const was = a[name];
    const now = b[name];
    if (!was || !now || was.pins !== now.pins || (was.expanded === true) !== (now.expanded === true)) return false;
    count += 1;
  }
  for (const name in a) {
    if (a[name]) count -= 1;
  }
  return count === 0;
}

/**
 * Sizes change with a card's pins or expanded flag (and the catalog and analysis), never with its position, so
 * a drag frame reuses the last ones: the memo is keyed on this shape, not on the layout object. A drag frame
 * moves cards only, so the last key is handed back without building a string.
 */
export function shapeKey(layout: Layout): string {
  if (layout === lastLayout) return lastKey;
  if (lastLayout === null || !sameShape(lastLayout, layout)) {
    lastKey = Object.entries(layout)
      .map(([name, entry]) => `${name}:${entry.pins}:${entry.expanded === true ? 1 : 0}`)
      .join("|");
  }
  lastLayout = layout;
  return lastKey;
}

/** The layout `shapeKey` describes, every card at the origin: all `cardSizes` reads. */
export function shapeOf(key: string): Layout {
  const layout: Layout = {};
  for (const part of key ? key.split("|") : []) {
    const [name = "", pins, expanded] = part.split(":");
    layout[name] = { x: 0, y: 0, pins: pins === "right" ? "right" : "left", ...(expanded === "1" ? { expanded: true } : {}) };
  }
  return layout;
}

/** Every placed card's token-computed size, reused across a drag. */
export function useCardSizes(): Sizes {
  const key = useDocument((s) => shapeKey(s.project.layout));
  const catalog = useCatalog();
  const analysis = useAnalysis();
  return useMemo(() => cardSizes(shapeOf(key), catalog, analysis), [key, catalog, analysis]);
}

/**
 * The traces into the core: one SVG over the sheet's ground and under its cards, no pointer, and a second over
 * the cards holding only the stretches a wire can't route around a card: those bridge the card on a casing in
 * the ground's colour (CO-01). React decides which `<g>` exist and how each draws (`data-tone`);`painter.ts` writes their geometry once per animation
 * frame from the document's layout, React Flow's transform and the cell's pads, and listens to nothing while no
 * trace shows.
 */
export function CoreTraces({ traces, pads }: { traces: readonly TraceSpec[]; pads: Pads | null }) {
  const store = useStoreApi();
  const sizes = useCardSizes();
  const elements = useRef(new Map<string, SVGGElement>());
  const bridges = useRef(new Map<string, SVGGElement>());
  const latest = useRef({ sizes, pads });
  const painter = useRef<Painter | null>(null);

  useLayoutEffect(() => {
    latest.current = { sizes, pads };
    painter.current ??= createPainter({
      store,
      layout: () => doc.get().layout,
      sizes: () => latest.current.sizes,
      onLayout: (listener) =>
        doc.subscribe((state, previous) => {
          if (state.project.layout !== previous.project.layout) listener();
        }),
      pads: () => latest.current.pads,
    });
    const targets: TraceTarget[] = [];
    for (const trace of traces) {
      const element = elements.current.get(trace.name);
      const bridge = bridges.current.get(trace.name) ?? null;
      if (element) targets.push({ name: trace.name, element, bridge, stubs: trace.stubs, to: trace.to });
    }
    painter.current.set(targets);
  }, [store, traces, sizes, pads]);

  useEffect(
    () => () => {
      painter.current?.dispose();
      painter.current = null;
    },
    [],
  );

  return (
    <>
      <svg className={styles.traces} aria-hidden="true" data-core-traces="">
        {traces.map((trace) => (
          <g
            key={trace.name}
            ref={(element) => {
              if (element) elements.current.set(trace.name, element);
              else elements.current.delete(trace.name);
            }}
            className={styles.trace}
            data-trace={trace.name}
            data-tone={trace.tone}
            data-to={trace.to}
          >
            <path />
            <g>
              <path />
              {trace.stubs.map((offset) => (
                <circle key={offset} className={styles.joint} />
              ))}
            </g>
          </g>
        ))}
      </svg>
      <svg className={styles.bridges} aria-hidden="true" data-core-bridges="">
        {traces.map((trace) => (
          <g
            key={trace.name}
            ref={(element) => {
              if (element) bridges.current.set(trace.name, element);
              else bridges.current.delete(trace.name);
            }}
            className={styles.bridge}
            data-bridge={trace.name}
            data-tone={trace.tone}
          >
            <path className={styles.casing} />
            <path />
          </g>
        ))}
      </svg>
    </>
  );
}
