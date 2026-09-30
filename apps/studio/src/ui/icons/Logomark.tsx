import { cx } from "../shared/cx";
import styles from "./Logomark.module.css";

/**
 * The three cuts of the pinned `lattice/assets/logomark.svg`, verbatim: two concentric diamonds joined by four
 * struts on a 24-unit grid, drawn with a 1.1-unit line. That is the brand's small cut, the one for marks set
 * inline with text under 40 px (design-system-rules.md "Logo"); `public/favicon.svg` carries the same three.
 */
const PATHS: readonly string[] = [
  "M12 1.5 L22.5 12 L12 22.5 L1.5 12 Z",
  "M12 6.5 L17.5 12 L12 17.5 L6.5 12 Z",
  "M12 1.5 L12 6.5 M22.5 12 L17.5 12 M12 22.5 L12 17.5 M1.5 12 L6.5 12",
];

export type LogomarkProps = {
  /** The side in CSS px, kept to a whole pixel so the line stays crisp. Default 20. */
  size?: number;
  className?: string | undefined;
};

/**
 * The Lattice mark, inline, in `currentColor`: set `color` on the parent and it follows the theme. Decorative on
 * its own (`aria-hidden`); the control or heading beside it carries the name. Not an `Icon` on purpose: the mark
 * keeps its own 1.1-unit line and butt caps, never the icon set's 1.5 restroke (design-system-rules.md "Logo").
 */
export function Logomark({ size = 20, className }: LogomarkProps) {
  const px = Math.round(size);
  return (
    <svg
      viewBox="0 0 24 24"
      width={px}
      height={px}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.1}
      strokeLinejoin="miter"
      shapeRendering="geometricPrecision"
      aria-hidden="true"
      focusable="false"
      data-logomark=""
      className={cx(styles.mark, className)}
    >
      {PATHS.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
