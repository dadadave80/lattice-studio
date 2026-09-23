/**
 * The pure half of `Splitter` (APG window splitter): clamping, key steps and drag math, plus the pane header
 * menu's Narrower and Wider. Sizes are CSS px.
 */

export type SplitterOrientation = "vertical" | "horizontal";

/** Which side of the splitter the controlled pane is on: "before" is left of or above it. */
export type PaneSide = "before" | "after";

export type SplitterBounds = { min: number; max: number };

export function clampSize(value: number, { min, max }: SplitterBounds): number {
  return Math.min(max, Math.max(min, value));
}

/** One step smaller, not below `min` (the pane header menu's Narrower). */
export function narrower(value: number, { min, step = 8 }: { min: number; step?: number }): number {
  return Math.max(min, value - step);
}

/** One step larger, not above `max` (the pane header menu's Wider). */
export function wider(value: number, { max, step = 8 }: { max: number; step?: number }): number {
  return Math.min(max, value + step);
}

export type SplitterKeyInput = SplitterBounds & {
  value: number;
  orientation: SplitterOrientation;
  paneSide: PaneSide;
  step: number;
  largeStep: number;
};

export type SplitterKeyResult = { kind: "resize"; value: number } | { kind: "toggle" };

/**
 * What a key does on a focused splitter, or null when it isn't handled. A vertical splitter (between side-by-side
 * panes) takes ← →, a horizontal one ↑ ↓; → and ↓ move the splitter right or down, which grows a pane before it
 * and shrinks a pane after it. Shift takes the large step; Home and End go to the minimum and maximum; Enter
 * toggles collapse.
 */
export function splitterKey(key: string, shift: boolean, input: SplitterKeyInput): SplitterKeyResult | null {
  const { value, orientation, paneSide, step, largeStep } = input;
  const bounds = { min: input.min, max: input.max };
  if (key === "Enter") return { kind: "toggle" };
  if (key === "Home") return { kind: "resize", value: bounds.min };
  if (key === "End") return { kind: "resize", value: bounds.max };
  const forward = orientation === "vertical" ? "ArrowRight" : "ArrowDown";
  const backward = orientation === "vertical" ? "ArrowLeft" : "ArrowUp";
  if (key !== forward && key !== backward) return null;
  const direction = (key === forward ? 1 : -1) * (paneSide === "before" ? 1 : -1);
  return { kind: "resize", value: clampSize(value + direction * (shift ? largeStep : step), bounds) };
}

/** The size during a drag: the start size plus the pointer's movement along the splitter's axis, clamped. */
export function dragSize(start: number, delta: number, paneSide: PaneSide, bounds: SplitterBounds): number {
  return clampSize(Math.round(start + (paneSide === "before" ? delta : -delta)), bounds);
}
