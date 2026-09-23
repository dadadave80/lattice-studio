import { HATCH_PATTERN_ID, hatchStripeClass } from "./hatch";

/**
 * The hatch as an SVG pattern: 45° stripes, 5 px on and 5 px off like the `--lx-hatch` token, in
 * `accent-soft` (CanvasText in forced colors). Render it inside any `<svg>` that fills with it; ids must
 * stay unique, so pass `id` for a second copy.
 */
export function HatchPattern({ id = HATCH_PATTERN_ID }: { id?: string }) {
  return (
    <defs>
      <pattern id={id} patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(45)">
        <rect className={hatchStripeClass} x="0" y="0" width="5" height="10" />
      </pattern>
    </defs>
  );
}
