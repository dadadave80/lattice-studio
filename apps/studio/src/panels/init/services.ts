/**
 * S5d's registrations (contracts/inspector.ts, contracts/dialogs.ts): the Init plan view and the Choose an
 * upgrade mechanism dialog. Both load lazily, as their own chunk (spec L822), each inside its own Suspense
 * boundary so neither depends on where its host sits.
 */
import { createElement, lazy, Suspense } from "react";
import { registerDialog, registerInspectorView, type DialogComponentProps, type InspectorViewProps } from "@/contracts";

const LazyInitEditor = lazy(() => import("./InitEditor").then((m) => ({ default: m.InitEditor })));
const LazyChooseMechanism = lazy(() => import("./ChooseMechanismDialog").then((m) => ({ default: m.ChooseMechanismDialog })));

function InitPlanView(props: InspectorViewProps<"init">) {
  return createElement(Suspense, { fallback: createElement("p", { role: "status" }, "Loading the init plan…") }, createElement(LazyInitEditor, props));
}

function ChooseMechanism(props: DialogComponentProps<"choose-mechanism">) {
  return createElement(Suspense, { fallback: null }, createElement(LazyChooseMechanism, props));
}

registerInspectorView("init", InitPlanView);
registerDialog("choose-mechanism", ChooseMechanism);
