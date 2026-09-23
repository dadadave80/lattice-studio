/**
 * S8b's registrations (contracts/dialogs.ts): the deploy review and Remove facets. Both load lazily as their own
 * chunk (spec L822), each inside its own Suspense boundary, so the review never weighs on the first load.
 */
import { createElement, lazy, Suspense } from "react";
import { registerDialog, type DialogComponentProps } from "@/contracts";

const LazyDeployReview = lazy(() => import("./DeployReview").then((m) => ({ default: m.DeployReview })));
const LazyRemoveFacets = lazy(() => import("./RemoveFacetsDialog").then((m) => ({ default: m.RemoveFacetsDialog })));

function DeployReviewDialog(props: DialogComponentProps<"deploy-review">) {
  return createElement(Suspense, { fallback: null }, createElement(LazyDeployReview, props));
}

function RemoveFacets(props: DialogComponentProps<"remove-facets">) {
  return createElement(Suspense, { fallback: null }, createElement(LazyRemoveFacets, props));
}

registerDialog("deploy-review", DeployReviewDialog);
registerDialog("remove-facets", RemoveFacets);
