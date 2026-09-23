import styles from "./Hatch.module.css";

/** The pattern's id: fill an SVG shape with `fill="url(#lx-hatch)"` (or `HATCH_FILL`). */
export const HATCH_PATTERN_ID = "lx-hatch";
export const HATCH_FILL = `url(#${HATCH_PATTERN_ID})`;

/** The class that hatches an HTML element's background with the `--lx-hatch` token. */
export const hatchedClass = styles.hatched ?? "";

/** The class for the pattern's stripes. */
export const hatchStripeClass = styles.stripe ?? "";
