/**
 * S5c's own views, each loaded on first use: the panel is in the entry chunk (App imports it), the views are
 * not. They share one chunk, `views/index.ts`, so switching views after the first costs no further fetch.
 */
import { lazy } from "react";

const views = () => import("./views");

export const DiamondView = lazy(() => views().then((m) => ({ default: m.DiamondView })));
export const FacetView = lazy(() => views().then((m) => ({ default: m.FacetView })));
export const SelectionView = lazy(() => views().then((m) => ({ default: m.SelectionView })));
export const PreviewView = lazy(() => views().then((m) => ({ default: m.PreviewView })));
export const ProblemView = lazy(() => views().then((m) => ({ default: m.ProblemView })));
export const ComparisonView = lazy(() => views().then((m) => ({ default: m.ComparisonView })));
