/**
 * The sheet chrome's lazy chunk: everything S4d draws but the Start block (in the entry, see `services.ts`),
 * loaded when the canvas first renders its layers (the canvas is itself a lazy chunk, spec L818). `services.ts`
 * registers thin Suspense wrappers around these.
 */
import { Panel } from "@xyflow/react";
import { useLayoutTier } from "@/shell/layout-tier";
import { TitleBlockContent } from "./TitleBlock";
import { ToolStrip } from "./ToolStrip";
import { ZoomReadout } from "./ZoomReadout";
import styles from "./chrome.module.css";

export { BrowseRecipesDialog } from "./BrowseRecipesDialog";
export { InitBadge } from "./InitBadge";
export { InitOrderOverlay } from "./InitOrderOverlay";
export { OpenError } from "./OpenError";

/** The tool strip, then the zoom readout: one layer, so both come before the notes in Tab order (spec L752). */
export function ToolStripLayer() {
  return (
    <>
      <ToolStrip />
      <ZoomReadout />
    </>
  );
}

/** The title block, bottom-right, last in the sheet's Tab order (spec L752). Under 768 px the title bar has it. */
export function TitleBlockLayer() {
  const tier = useLayoutTier();
  if (tier === "phone") return null;
  return (
    <Panel position="bottom-right" className={styles.titlePanel}>
      <TitleBlockContent />
    </Panel>
  );
}
