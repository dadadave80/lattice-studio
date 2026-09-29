import styles from "./FacetCard.module.css";

const CORNERS = ["topLeft", "topRight", "bottomLeft", "bottomRight"] as const;

/**
 * The card's corner furniture, decorative: the dark theme's four detent screws, lit when selected, and the light theme's CAD
 * corner ticks around a selected card (design boards: module card, Selected, in both themes).
 */
export function CardMarks({ selected }: { selected: boolean }) {
  return (
    <>
      {CORNERS.map((corner) => (
        <span key={`screw-${corner}`} className={`${styles.screw} ${styles[corner]}`} aria-hidden="true" />
      ))}
      {selected
        ? CORNERS.map((corner) => (
            <span key={`corner-${corner}`} className={`${styles.corner} ${styles[corner]}`} aria-hidden="true" />
          ))
        : null}
    </>
  );
}
