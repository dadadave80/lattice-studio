/**
 * The layout lengths core's geometry takes (contracts §3.4: `LayoutMetrics`), from the tokens package.
 * Core can't import tokens (spec L102) and only checks a copy, so this is where the real import is held to
 * core's type: if tokens rename or drop a length, the app stops type-checking here.
 */
import type { LayoutMetrics } from "@lattice-studio/core";
import { layoutSizes } from "@lattice-studio/tokens";

export const layoutMetrics: LayoutMetrics = layoutSizes satisfies LayoutMetrics;
