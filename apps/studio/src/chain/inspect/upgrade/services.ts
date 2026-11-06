import { createElement, lazy, Suspense } from "react";
import { registerDialog, type DialogComponentProps } from "@/contracts";
import { setUpgradeReviewPrompt } from "../upgrade-review-ports";

const LazyReview = lazy(() => import("./UpgradeReviewDialog").then((module) => ({ default: module.UpgradeReviewDialog })));
function Review(props: DialogComponentProps<"upgrade-plan-review">) {
  return createElement(Suspense, { fallback: null }, createElement(LazyReview, props));
}
registerDialog("upgrade-plan-review", Review);
setUpgradeReviewPrompt(async (details) => (await import("./review")).openUpgradeReview(details));
