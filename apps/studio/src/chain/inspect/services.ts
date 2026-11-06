/** Registration only; inspection and wallet code load when the dialog or deployed view opens. */
import { createElement, lazy, Suspense } from "react";
import { registerDialog, registerInspectorView, type DialogComponentProps, type InspectorViewProps } from "@/contracts";

const LazyOpen = lazy(() => import("./OpenDiamondHost").then((module) => ({ default: module.OpenDiamondHost })));
const LazyView = lazy(() => import("./DeployedView").then((module) => ({ default: module.DeployedView })));
const LazyTransaction = lazy(() => import("./TransactionReviewDialog").then((module) => ({ default: module.TransactionReviewDialog })));

function Open(props: DialogComponentProps<"open-diamond">) {
  return createElement(Suspense, { fallback: null }, createElement(LazyOpen, props));
}
function Deployed(props: InspectorViewProps<"deployed">) {
  return createElement(Suspense, { fallback: createElement("p", { role: "status" }, "Inspecting diamond…") }, createElement(LazyView, props));
}
function Transaction(props: DialogComponentProps<"inspect-transaction">) {
  return createElement(Suspense, { fallback: null }, createElement(LazyTransaction, props));
}

registerDialog("open-diamond", Open);
registerInspectorView("deployed", Deployed);
registerDialog("inspect-transaction", Transaction);
