import { Panel, useStore, ViewportPortal, type ReactFlowState } from "@xyflow/react";
import { useLayoutEffect, useState, type CSSProperties } from "react";
import { commandRef, layoutMetrics, useCatalog, useDocument, useSession, useSettings } from "@/contracts";
import { CommandButton } from "@/ui/buttons/CommandButton";
import { bundleFixed, DRAG_TO_REORDER, INIT_ORDER_CHIP } from "./copy";
import { badgeText, initOrderModel, type InitOrderModel } from "./init-order-model";
import styles from "./chrome.module.css";

/** Where the path meets a card: the middle of its header, where the badge sits. */
function anchors(state: ReactFlowState, facets: readonly string[]): string {
  const points: string[] = [];
  for (const facet of facets) {
    const node = state.nodeLookup.get(facet);
    if (!node) continue;
    const { x, y } = node.internals.positionAbsolute;
    const width = node.measured.width ?? layoutMetrics.cardWidth;
    points.push(`${Math.round(x + width / 2)},${Math.round(y + layoutMetrics.headerHeight / 2)}`);
  }
  return points.join(" ");
}

/** The dashed path through the badged cards, in step order (spec L383), drawn in sheet units. */
function InitOrderPath({ model }: { model: InitOrderModel }) {
  const order = model.steps.flatMap((step) => step.facets);
  const points = useStore((s) => anchors(s, order));
  if (points.split(" ").length < 2) return null;
  return (
    <ViewportPortal>
      <svg className={styles.initPath} aria-hidden="true" data-init-path="">
        <polyline points={points} />
      </svg>
    </ViewportPortal>
  );
}

/**
 * How far down the sheet the minimap reaches, in px, while it shows (S4b draws it top-right, as a lazy chunk, at
 * React Flow's size): measured, so the legend sits under it whatever size it has. Null while it doesn't show.
 */
function useMinimapBottom(on: boolean): number | null {
  const root = useStore((s) => s.domNode);
  const [bottom, setBottom] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!on || !root) return;
    const measure = () => {
      const minimap = root.querySelector(".react-flow__minimap");
      setBottom(minimap ? Math.ceil(minimap.getBoundingClientRect().bottom - root.getBoundingClientRect().top) : null);
    };
    measure();
    const sizes = new ResizeObserver(measure);
    sizes.observe(root);
    // The minimap mounts late (its own chunk) and can change size: follow both.
    const children = new MutationObserver(() => {
      const minimap = root.querySelector(".react-flow__minimap");
      if (minimap) sizes.observe(minimap);
      measure();
    });
    children.observe(root, { childList: true, subtree: true });
    return () => {
      sizes.disconnect();
      children.disconnect();
    };
  }, [on, root]);
  return on ? bottom : null;
}

/** The legend: the order, as the path visits it (the init order board), and how to change it. */
function Legend({ model }: { model: InitOrderModel }) {
  // The minimap shares the top-right corner (S4b): the legend sits under it while it shows.
  const minimap = useSettings((s) => s.minimap);
  const below = useMinimapBottom(minimap);
  return (
    <Panel
      position="top-right"
      className={styles.legend}
      data-chrome="init-legend"
      // It scrolls within the sheet's free height (SH-03), so it takes Tab and a name: the keyboard can scroll it.
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
      role="group"
      aria-labelledby="init-order-legend"
      tabIndex={0}
      data-below-minimap={below === null ? undefined : ""}
      style={below === null ? undefined : ({ "--minimap-bottom": `${below}px` } as CSSProperties)}
    >
      <section aria-labelledby="init-order-legend">
        <h2 id="init-order-legend" className={styles.legendTitle}>
          Init order
        </h2>
        <ol className={styles.legendList}>
          {model.steps.map((step) => (
            <li key={step.number} className={step.facets.length ? undefined : styles.legendQuiet}>
              <span className={styles.legendBadge} aria-hidden="true">
                {badgeText(step.number)}
              </span>
              <span>{step.label}</span>
            </li>
          ))}
        </ol>
        <p className={styles.legendNote}>
          {model.kind === "bundle" && model.bundle ? bundleFixed(model.bundle) : model.movable > 1 ? DRAG_TO_REORDER : null}
        </p>
      </section>
    </Panel>
  );
}

/**
 * Init order mode on the sheet (spec L383, Flow 7 step 5): the chip "Init order · Esc" (a button that leaves the
 * mode), the dashed path in step order and the legend. The badges and the 35% dim live on the cards
 * (`init-mark.tsx`). Nothing draws while the mode is off.
 */
export function InitOrderOverlay() {
  const on = useSession((s) => s.modes.initOrder);
  const recipe = useDocument((s) => (on ? s.project.recipe : null));
  const catalog = useCatalog();
  if (!on || !recipe || !catalog) return null;
  const model = initOrderModel(recipe, catalog);
  return (
    <>
      <Panel position="top-center" className={styles.chip} data-chrome="init-chip">
        <CommandButton command={commandRef("initOrder.toggle")} size="small">
          {INIT_ORDER_CHIP}
        </CommandButton>
      </Panel>
      {model.kind === "none" ? null : (
        <>
          <InitOrderPath model={model} />
          <Legend model={model} />
        </>
      )}
    </>
  );
}
