/**
 * S5c's own views, each loaded on first use: the panel is in the entry chunk (App imports it), the views are
 * not (spec L822, the 240 KB first-load budget). They share one chunk, `views/index.ts`, so switching views after the first costs no further fetch.
 */
import { lazy } from "react";

const views = () => import("./views");

export const DiamondView = lazy(() => views().then((m) => ({ default: m.DiamondView })));
export const FacetView = lazy(() => views().then((m) => ({ default: m.FacetView })));
export const SelectionView = lazy(() => views().then((m) => ({ default: m.SelectionView })));
export const PreviewView = lazy(() => views().then((m) => ({ default: m.PreviewView })));
export const ProblemView = lazy(() => views().then((m) => ({ default: m.ProblemView })));
export const ComparisonView = lazy(() => views().then((m) => ({ default: m.ComparisonView })));

/**
 * The cut plan footer and the narrow Fill in bar pull in the UI primitives (Base UI's button and tooltip), which
 * nothing else in the entry chunk needs yet, so they load beside the views.
 */
const parts = () => import("./frame-parts");

export const CutPlanFooter = lazy(() => parts().then((m) => ({ default: m.CutPlanFooter })));
export const NarrowFillIn = lazy(() => parts().then((m) => ({ default: m.NarrowFillIn })));
