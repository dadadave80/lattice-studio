import { Panel, useStore, ViewportPortal, type ReactFlowState } from "@xyflow/react";
import { commandRef, layoutMetrics, useCatalog, useDocument, useSession } from "@/contracts";
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

/** The legend: the order, as the path visits it (the init order board), and how to change it. */
function Legend({ model }: { model: InitOrderModel }) {
  return (
    <Panel position="top-right" className={styles.legend} data-chrome="init-legend">
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
