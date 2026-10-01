/**
 * The sheet chrome's lazy chunk: everything S4d draws but the Start block (in the entry, see `services.ts`),
 * loaded when the canvas first renders its layers (the canvas is itself a lazy chunk, spec L818). `services.ts`
 * registers thin Suspense wrappers around these.
 */
import { Panel } from "@xyflow/react";
import { useLayoutEffect, useRef } from "react";
import { useLayoutTier } from "@/shell/layout-tier";
import { TitleBlockContent } from "./TitleBlock";
import { publishTitleBlockSize } from "./title-block-size";
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

/** Publishes the title block's size while its panel shows, so the core cell sits immediately left of it. */
function TitleBlockPanel() {
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = panel.current;
    if (!el) return;
    const measure = () => publishTitleBlockSize({ width: el.offsetWidth, height: el.offsetHeight });
    measure();
    const sizes = new ResizeObserver(measure);
    sizes.observe(el);
    return () => {
      sizes.disconnect();
      publishTitleBlockSize(null);
    };
  }, []);
  return (
    <Panel ref={panel} position="bottom-right" className={styles.titlePanel}>
      <TitleBlockContent />
    </Panel>
  );
}

/** The title block, bottom-right, after the notes in the sheet's Tab order (spec L752). Under 768 px the title bar has it. */
export function TitleBlockLayer() {
  const tier = useLayoutTier();
  if (tier === "phone") return null;
  return <TitleBlockPanel />;
}
