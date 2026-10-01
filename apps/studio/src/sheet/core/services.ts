/**
 * The core's registrations (contracts `sheet.ts`, found by `discover.ts`): the core cell and its traces as one
 * sheet layer at order 32, after the title block, so the cell is the last Tab stop on the sheet. A thin Suspense
 * wrapper around the core's own chunk, so the entry grows by this file only. `commands.ts` beside it registers
 * `core.select`.
 */
import { createElement, lazy, Suspense } from "react";
import { registerSheetLayer } from "@/contracts";

const LazyCoreLayer = lazy(() => import("./CoreLayer").then((m) => ({ default: m.CoreLayer })));

function Layer() {
  return createElement(Suspense, { fallback: null }, createElement(LazyCoreLayer));
}

export const CORE_LAYER = { id: "core", order: 32 } as const;

registerSheetLayer({ ...CORE_LAYER, Component: Layer });
