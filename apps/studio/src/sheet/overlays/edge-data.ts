/**
 * The sheet's edges as React Flow sees them (spec L480, L823): one dependency trace per met requirement and
 * one tie per contested selector between neighbouring contenders, both from C9's `routeTraces`. The path is
 * C9's token geometry, never measured (spec L824); the handles only tell React Flow which cards an edge joins.
 */
import type { Edge } from "@xyflow/react";
import type { Hex4, Layout, Point, Sizes, Trace } from "@lattice-studio/core";
import { dependencyHandleId, pinHandleId } from "@/sheet/card";

export const TRACE_EDGE_TYPE = "dependency";
export const TIE_EDGE_TYPE = "tie";

export type TraceEdgeData = {
  points: Point[];
  mid: Point;
  /** "needs ERC4626". */
  label?: string;
  /** Ties: the contested selector. */
  selector?: Hex4;
};

export type SheetEdge = Edge<TraceEdgeData>;

/** An orthogonal path through `points`: straight runs, mitred corners. */
export function pathOf(points: readonly Point[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");
}

/** Which side of its card an end of a trace sits on: the side its point touches. */
function sideAt(point: Point | undefined, layout: Layout, sizes: Sizes, facet: string): "left" | "right" {
  const entry = layout[facet];
  const width = sizes[facet]?.width ?? 0;
  if (!point || !entry) return "right";
  return Math.abs(point.x - entry.x) <= Math.abs(point.x - (entry.x + width)) ? "left" : "right";
}

/** React Flow edges for C9's traces, in its order (dependencies, then ties). */
export function edgesOf(traces: readonly Trace[], layout: Layout, sizes: Sizes): SheetEdge[] {
  return traces.map((trace) => {
    const data: TraceEdgeData = { points: trace.points, mid: trace.mid };
    if (trace.label !== undefined) data.label = trace.label;
    if (trace.selector !== undefined) data.selector = trace.selector;
    const handles =
      trace.kind === "tie" && trace.selector !== undefined
        ? { sourceHandle: pinHandleId(trace.selector), targetHandle: pinHandleId(trace.selector) }
        : {
            sourceHandle: dependencyHandleId(sideAt(trace.points[0], layout, sizes, trace.from)),
            targetHandle: dependencyHandleId(sideAt(trace.points.at(-1), layout, sizes, trace.to)),
          };
    return {
      id: trace.id,
      type: trace.kind === "tie" ? TIE_EDGE_TYPE : TRACE_EDGE_TYPE,
      source: trace.from,
      target: trace.to,
      ...handles,
      data,
      selectable: false,
      focusable: false,
      deletable: false,
      reconnectable: false,
    };
  });
}
