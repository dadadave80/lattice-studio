import { useEffect } from "react";
import { endDrag } from "./drag";
import { onSheetMenuKey } from "./handlers";
import { DropGhost } from "./DropGhost";
import { Marquee } from "./Marquee";
import { MoveToLayer } from "./MoveToLayer";
import { SheetMenu } from "./SheetMenu";
// The handlers and command runs load with the layer.
import "./runtime-impl";
import styles from "./interact.module.css";

/**
 * Everything S4e draws over the sheet, loaded as its own chunk (`InteractionsLayer`): the marquee, Move to…,
 * the catalog drop ghost, the context menus, and the spot the tour points at when it says where a facet goes.
 */
export function SheetOverlays() {
  // A drag doesn't outlive the sheet it started on.
  useEffect(() => () => endDrag(null), []);
  useEffect(() => {
    window.addEventListener("keydown", onSheetMenuKey);
    return () => window.removeEventListener("keydown", onSheetMenuKey);
  }, []);
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
