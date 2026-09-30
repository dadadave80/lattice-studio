/**
 * Draws the traces React decided to show. React mounts one `<g>` per traced card: the wire, then a group of the
 * stubs and a junction dot per routed row. This writes their geometry, in screen px, from the card's rect in the
 * document × React Flow's transform and the core cell's pads: one pass per animation frame, however many moves,
 * pans or zooms asked for it. A card that only moved rewrites two attributes (the wire's `d` and the group's
 * `transform`); its stubs are redrawn only when its size, pins, rows or the zoom change. With no trace to draw it
 * listens to nothing.
 */
import type { Layout, Point, Sizes } from "@lattice-studio/core";
import { JOINT_RADIUS, tracePaths, type PinSide, type Transform } from "./geometry";

/** What the painter reads of React Flow's store: the transform, now and as it changes. */
export type TransformStore = {
  getState(): { transform: Transform };
  subscribe(listener: (state: { transform: Transform }) => void): () => void;
};

/** One traced card, as React mounted it. */
export type TraceTarget = {
  name: string;
  element: SVGGElement;
  /** Sheet units from the card's top of each stub, for a live trace; empty otherwise. */
  stubs: readonly number[];
  /** Which pad the trace ends on. */
  to: "fallback" | "cut";
};

/** Where the cell's pads sit and where the rail runs, in screen px relative to the sheet. */
export type Pads = { fallback: Point; cut: Point | null; railY: number };

export type PainterInputs = {
  /** React Flow's store, for the transform. */
  store: TransformStore;
  /** The document's layout, as it is now (a drag moves it every frame). */
  layout(): Layout;
  /** Token-computed card sizes (never measured, spec L824). */
  sizes(): Sizes;
  /** Re-runs `paint` when the layout changes; returns a disposer. */
  onLayout(listener: () => void): () => void;
  pads(): Pads | null;
};

export type Painter = {
  /** The traces to draw. Paints on the next frame; with none, stops listening. */
  set(targets: readonly TraceTarget[]): void;
  /** Asks for a paint on the next frame (the pads moved). */
  schedule(): void;
  dispose(): void;
};

/** What each `<g>` was last given, so an unchanged attribute is never written again. */
type Painted = { line: string; origin: string; shape: string };

function sideOf(layout: Layout, name: string): PinSide {
  return layout[name]?.pins === "right" ? "right" : "left";
}

/** The trace's parts, as React mounts them: `<path>` (the wire), then `<g>` holding a `<path>` and the dots. */
function partsOf(element: SVGGElement): { line: SVGPathElement; group: SVGGElement; stubs: SVGPathElement; joints: Element[] } | null {
  const [line, group] = element.children;
  if (!(line instanceof SVGPathElement) || !(group instanceof SVGGElement)) return null;
  const [stubs, ...joints] = group.children;
  if (!(stubs instanceof SVGPathElement)) return null;
  return { line, group, stubs, joints };
}

export function createPainter(inputs: PainterInputs): Painter {
  let targets: readonly TraceTarget[] = [];
  let frame = 0;
  let listening: (() => void)[] = [];
  const painted = new WeakMap<SVGGElement, Painted>();

  const clear = (element: SVGGElement) => {
    const parts = partsOf(element);
    parts?.line.removeAttribute("d");
    parts?.stubs.removeAttribute("d");
    painted.delete(element);
  };

  const paint = () => {
    frame = 0;
    const layout = inputs.layout();
    const sizes = inputs.sizes();
    const transform = inputs.store.getState().transform;
    const pads = inputs.pads();
    for (const target of targets) {
      const entry = layout[target.name];
      const size = sizes[target.name];
      const parts = partsOf(target.element);
      if (!entry || !size || !pads || !parts) {
        clear(target.element);
        continue;
      }
      const pad = target.to === "cut" ? (pads.cut ?? pads.fallback) : pads.fallback;
      const side = sideOf(layout, target.name);
      const rect = { x: entry.x, y: entry.y, width: size.width, height: size.height };
      const paths = tracePaths({ rect, side, transform, railY: pads.railY, pad, stubs: target.stubs });
      const was = painted.get(target.element);
      const origin = `translate(${paths.origin.x} ${paths.origin.y})`;
      const shape = `${size.width}|${size.height}|${side}|${transform[2]}|${target.stubs.join(",")}|${parts.joints.length}`;
      if (was?.line !== paths.line) parts.line.setAttribute("d", paths.line);
      if (was?.origin !== origin) parts.group.setAttribute("transform", origin);
      if (was?.shape !== shape) {
        if (paths.stubs) parts.stubs.setAttribute("d", paths.stubs);
        else parts.stubs.removeAttribute("d");
        parts.joints.forEach((joint, index) => {
          const at = paths.joints[index];
          if (!at) return;
          joint.setAttribute("cx", String(at.x));
          joint.setAttribute("cy", String(at.y));
          joint.setAttribute("r", String(JOINT_RADIUS));
        });
      }
      painted.set(target.element, { line: paths.line, origin, shape });
    }
  };

  const schedule = () => {
    if (frame === 0 && targets.length > 0) frame = requestAnimationFrame(paint);
  };

  const listen = () => {
    if (listening.length > 0) return;
    let transform = inputs.store.getState().transform;
    listening = [
      inputs.store.subscribe((state) => {
        if (state.transform === transform) return;
        transform = state.transform;
        schedule();
      }),
      inputs.onLayout(schedule),
    ];
  };

  const quiet = () => {
    for (const stop of listening) stop();
    listening = [];
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
  };

  return {
    set(next) {
      targets = next;
      if (targets.length === 0) {
        quiet();
        return;
      }
      listen();
      schedule();
    },
    schedule,
    dispose() {
      targets = [];
      quiet();
    },
  };
}
