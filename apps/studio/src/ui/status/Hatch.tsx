import styles from "./Hatch.module.css";

/** The pattern's id: fill an SVG shape with `fill="url(#lx-hatch)"` (or `HATCH_FILL`). */
export const HATCH_PATTERN_ID = "lx-hatch";
export const HATCH_FILL = `url(#${HATCH_PATTERN_ID})`;

/** The class that hatches an HTML element's background with the `--lx-hatch` token. */
export const hatchedClass = styles.hatched;

/**
 * The hatch as an SVG pattern: 45° stripes, 5 px on and 5 px off like the `--lx-hatch` token, in
 * `accent-soft` (CanvasText in forced colors). Render it once inside any `<svg>` that fills with it, or
 * once per document in a zero-size svg; ids must stay unique, so pass `id` for a second copy.
 */
export function HatchPattern({ id = HATCH_PATTERN_ID }: { id?: string }) {
  return (
    <defs>
      <pattern id={id} patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(45)">
        <rect className={styles.stripe} x="0" y="0" width="5" height="10" />
      </pattern>
    </defs>
  );
}

/** A zero-size svg holding the shared pattern, for pages whose SVGs reference `#lx-hatch`. */
export function HatchDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: "absolute" }}>
      <HatchPattern />
    </svg>
  );
}
