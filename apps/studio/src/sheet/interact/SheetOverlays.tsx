import { DropGhost } from "./DropGhost";
import { Marquee } from "./Marquee";
import { MoveToLayer } from "./MoveToLayer";
import { SheetMenu } from "./SheetMenu";
import styles from "./interact.module.css";

/**
 * Everything S4e draws over the sheet, loaded as its own chunk (`InteractionsLayer`): the marquee, Move to…,
 * the catalog drop ghost, the context menus, and the spot the tour points at when it says where a facet goes.
 */
export function SheetOverlays() {
  return (
    <>
      <div className={styles.placeTarget} data-tour="place-facet" aria-hidden="true" />
      <Marquee />
      <MoveToLayer />
      <DropGhost />
      <SheetMenu />
    </>
  );
}
