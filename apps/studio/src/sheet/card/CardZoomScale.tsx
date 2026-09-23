import { useStore } from "@xyflow/react";
import { useLayoutEffect } from "react";
import { SHEET_ZOOM_VAR } from "./node";

/**
 * A sheet layer that draws nothing: it writes the zoom to `--lx-sheet-zoom` on the React Flow root, so card
 * strokes scale with 1/zoom and stay legible when zoomed out (spec L772) without every card subscribing to
 * the zoom and re-rendering on each wheel step.
 */
export function CardZoomScale() {
  const zoom = useStore((s) => s.transform[2]);
  const root = useStore((s) => s.domNode);
  useLayoutEffect(() => {
    root?.style.setProperty(SHEET_ZOOM_VAR, String(zoom));
  }, [root, zoom]);
  useLayoutEffect(
    () => () => {
      root?.style.removeProperty(SHEET_ZOOM_VAR);
    },
    [root],
  );
  return null;
}
