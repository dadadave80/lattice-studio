/**
 * The init badge S4a's card shows in init order mode (`provideInitMark`, spec L383): a step's number, or the
 * 35% dim for a card without a step. In the entry chunk, because every card calls it on every render: it
 * reads three stores, returns a constant while the mode is off, and draws the badge's face until the lazy
 * chrome (which adds dragging) has loaded.
 */
import { lazy, Suspense } from "react";
import { useCatalog, useDocument, useSession } from "@/contracts";
import type { InitMark } from "@/sheet/card/init-mark";
import { BadgeFace, type BadgeProps } from "./BadgeFace";
import { initOrderModel } from "./init-order-model";

const NONE: InitMark = { badge: null, dimmed: false };
const DIMMED: InitMark = { badge: null, dimmed: true };

const LazyBadge = lazy(() => import("./layers").then((m) => ({ default: m.InitBadge })));

function Badge(props: BadgeProps) {
  return (
    <Suspense fallback={<BadgeFace {...props} />}>
      <LazyBadge {...props} />
    </Suspense>
  );
}

/** A hook, for `provideInitMark`: the card's badge and dimming. */
export function useChromeInitMark(facet: string): InitMark {
  const on = useSession((s) => s.modes.initOrder);
  const recipe = useDocument((s) => (on ? s.project.recipe : null));
  const catalog = useCatalog();
  if (!on || !recipe || !catalog) return NONE;
  const model = initOrderModel(recipe, catalog);
  if (model.kind === "none") return NONE;
  const step = model.byFacet.get(facet);
  if (!step) return DIMMED;
  return { badge: <Badge number={step.number} index={step.index} bundle={model.bundle} />, dimmed: false };
}
