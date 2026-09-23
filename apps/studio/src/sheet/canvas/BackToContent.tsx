import { Panel, useStoreApi, type ReactFlowState } from "@xyflow/react";
import { useEffect, useState } from "react";
import { commandRef, layoutMetrics } from "@/contracts";
import { CommandButton } from "@/ui/buttons/CommandButton";
import styles from "./Sheet.module.css";

/** How long every card has to be off-screen before Back to content shows (spec L484). */
export const BACK_TO_CONTENT_DELAY_MS = 1000;

/** True when the sheet has cards and none of them shows; false while the sheet has no size (hidden). */
export function everyCardOffscreen(state: ReactFlowState): boolean {
  const { nodeLookup, transform, width, height } = state;
  if (nodeLookup.size === 0 || width === 0 || height === 0) return false;
  const [tx, ty, zoom] = transform;
  const view = { left: -tx / zoom, top: -ty / zoom, right: (width - tx) / zoom, bottom: (height - ty) / zoom };
  for (const node of nodeLookup.values()) {
    const { x, y } = node.internals.positionAbsolute;
    const w = node.measured.width ?? layoutMetrics.cardWidth;
    const h = node.measured.height ?? layoutMetrics.headerHeight;
    if (x < view.right && x + w > view.left && y < view.bottom && y + h > view.top) return false;
  }
  return true;
}

/**
 * "Back to content" (IR L113): appears once every card has been off-screen for 1 s, and fits the view. It sits
 * after the card grid in Tab order, so it's reachable the moment it shows.
 */
export function BackToContent() {
  const store = useStoreApi();
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stop = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    const check = (state: ReactFlowState) => {
      if (everyCardOffscreen(state)) {
        timer ??= setTimeout(() => setShown(true), BACK_TO_CONTENT_DELAY_MS);
      } else {
        stop();
        setShown(false);
      }
    };
    // Rescan only when the view, the sheet's size or the number of cards changes, never on a drag frame.
    const unsubscribe = store.subscribe((state, previous) => {
      if (
        state.transform === previous.transform &&
        state.width === previous.width &&
        state.height === previous.height &&
        state.nodes.length === previous.nodes.length
      ) {
        return;
      }
      check(state);
    });
    if (everyCardOffscreen(store.getState())) timer = setTimeout(() => setShown(true), BACK_TO_CONTENT_DELAY_MS);
    return () => {
      unsubscribe();
      stop();
    };
  }, [store]);

  if (!shown) return null;
  return (
    <Panel position="bottom-center" className={styles.backToContent} data-back-to-content="">
      <CommandButton command={commandRef("sheet.backToContent")} variant="secondary" />
    </Panel>
  );
}
