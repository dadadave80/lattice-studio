/**
 * S4d's registrations (contracts `sheet.ts`, `dialogs.ts`, S4a's `init-mark.ts`): the sheet chrome's layers, in
 * the sheet's Tab order (spec L752: the card grid, the tool strip, the notes, the title block), Browse all
 * recipes, and the init badge every card shows in init order mode. Each layer is a small Suspense wrapper around
 * the chrome's lazy chunk (`layers.tsx`), so the entry grows by the wrappers only.
 *
 * Orders: the Start block (1) takes the card grid's place on an empty sheet; the tool strip and zoom readout (2)
 * come before S4c's notes (10 by the contract's suggestion); init order mode's chip and legend (28) and the title
 * block (30) come after them.
 */
import { createElement, lazy, Suspense, type ComponentType } from "react";
import { registerDialog, registerSheetLayer, type DialogComponentProps } from "@/contracts";
import { provideInitMark } from "@/sheet/card/init-mark";
import { useChromeInitMark } from "./init-mark";

const chunk = () => import("./layers");

function layer(load: () => Promise<{ default: ComponentType }>): ComponentType {
  const Lazy = lazy(load);
  return function Layer() {
    return createElement(Suspense, { fallback: null }, createElement(Lazy));
  };
}

export const START_LAYER = { id: "start", order: 1 } as const;
export const TOOL_STRIP_LAYER = { id: "tool-strip", order: 2 } as const;
export const INIT_ORDER_LAYER = { id: "init-order", order: 28 } as const;
export const TITLE_BLOCK_LAYER = { id: "title-block", order: 30 } as const;

registerSheetLayer({ ...START_LAYER, Component: layer(() => chunk().then((m) => ({ default: m.StartBlock }))) });
registerSheetLayer({ ...TOOL_STRIP_LAYER, Component: layer(() => chunk().then((m) => ({ default: m.ToolStripLayer }))) });
registerSheetLayer({ ...INIT_ORDER_LAYER, Component: layer(() => chunk().then((m) => ({ default: m.InitOrderOverlay }))) });
registerSheetLayer({ ...TITLE_BLOCK_LAYER, Component: layer(() => chunk().then((m) => ({ default: m.TitleBlockLayer }))) });

const LazyBrowse = lazy(() => chunk().then((m) => ({ default: m.BrowseRecipesDialog })));

function BrowseRecipes(props: DialogComponentProps<"browse-recipes">) {
  return createElement(Suspense, { fallback: null }, createElement(LazyBrowse, props));
}

registerDialog("browse-recipes", BrowseRecipes);
provideInitMark(useChromeInitMark);
