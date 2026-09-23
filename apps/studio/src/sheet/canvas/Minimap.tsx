import { MiniMap } from "@xyflow/react";
import styles from "./Sheet.module.css";
import { moveViewport, sheetSize, sheetViewport } from "./sheet-view";
import { centerOn } from "./viewport-math";

/**
 * The minimap (spec L482, PA L67: adopted, off by default): cards in ink, the view outlined in the accent.
 * A click pans the sheet there, keeping the zoom. A lazy chunk: it loads the first time Show minimap is on.
 */
export function Minimap() {
  return (
    <MiniMap
      className={styles.minimap}
      position="top-right"
      ariaLabel="Minimap"
      nodeColor="var(--lx-text)"
      nodeBorderRadius={0}
      nodeStrokeWidth={0}
      bgColor="var(--lx-panel)"
      maskColor="var(--lx-accent-soft)"
      maskStrokeColor="var(--lx-accent)"
      maskStrokeWidth={2}
      onClick={(_event, position) => {
        moveViewport(centerOn(position, sheetSize(), sheetViewport().zoom));
      }}
    />
  );
}
