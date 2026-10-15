/**
 * The sheet chrome's lazy chunk: everything S4d draws but the Start block (in the entry, see `services.ts`),
 * loaded when the canvas first renders its layers (the canvas is itself a lazy chunk, spec L818). `services.ts`
 * registers thin Suspense wrappers around these.
 */
import { Panel } from "@xyflow/react";
import { useLayoutEffect, useRef, useState } from "react";
import { useLayoutTier } from "@/shell/layout-tier";
import { useSheetInsets } from "@/shell/sheet-insets";
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

/** The gap the title block keeps from the zoom readout, in px (a grid step). */
const READOUT_GAP = 8;

/**
 * Publishes the title block's size while its panel shows, so the core cell sits immediately left of it. When the
 * block would reach the zoom readout (they share the bottom edge, the readout at the left), it lifts above the
 * readout instead, keeping its one line (the strip at 768 px); the height it publishes then includes the lift, so
 * the core cell stays above it. Its left edge doesn't depend on the lift, so the choice never flips back and forth.
 */
function TitleBlockPanel() {
  const panel = useRef<HTMLDivElement>(null);
  const [lift, setLift] = useState(0);
  const insets = useSheetInsets();
  useLayoutEffect(() => {
    const el = panel.current;
    if (!el) return;
    const root = el.closest(".react-flow");
    let watched: Element | null = null;
    const sizes = new ResizeObserver(() => measure());
    const measure = () => {
      // The readout's chunk can land after this one: look for it each time, and watch it once it's there.
      const readout = root?.querySelector('[data-chrome="zoom-readout"]') ?? null;
      if (readout && readout !== watched) {
        watched = readout;
        sizes.observe(readout);
      }
      const own = el.getBoundingClientRect();
      const box = readout?.getBoundingClientRect();
      const next = box && box.width > 0 && own.left < box.right + READOUT_GAP ? Math.ceil(box.height) + READOUT_GAP : 0;
      setLift(next);
      publishTitleBlockSize({ width: el.offsetWidth, height: el.offsetHeight + next });
    };
    measure();
    sizes.observe(el);
    if (root) sizes.observe(root);
    return () => {
      sizes.disconnect();
      publishTitleBlockSize(null);
    };
  }, [insets.start, insets.end]);
  return (
    <Panel
      ref={panel}
      position="bottom-right"
      className={styles.titlePanel}
      data-lifted={lift > 0 ? "" : undefined}
      style={lift > 0 ? { marginBlockEnd: `calc(var(--lx-space-4) + ${lift}px)` } : undefined}
    >
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
