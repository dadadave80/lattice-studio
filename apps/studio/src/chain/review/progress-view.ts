/**
 * The deploy's progress in words (spec L574-L580): the pending timer, the stale sentence, and the plain-text report
 * Copy details puts on the clipboard when the simulation reverts (Flow 14). Pure: callers pass the clock's time.
 */
import { plural } from "@lattice-studio/core";

/** Milliseconds as "m:ss" ("0:12", "1:05", "60:00"); never below zero. */
export function timerText(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** How long a transaction has been pending since `since` (ISO), as "m:ss", or null when `since` isn't a time. */
export function elapsedText(since: string | undefined, nowMs: number): string | null {
  if (since === undefined) return null;
  const start = Date.parse(since);
  return Number.isNaN(start) ? null : timerText(nowMs - start);
}

/** The receipt timeout in whole minutes, at least one: 180 s → 3. */
export function staleMinutes(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60));
}

/** Spec L575: "Not seen for 3 minutes. It may have been dropped." */
export function staleText(timeoutSeconds: number): string {
  return `Not seen for ${plural(staleMinutes(timeoutSeconds), "minute")}. It may have been dropped.`;
}

/** Spec L576: "Diamond matches the sheet: 14 facets, 120 selectors." */
export function matchesText(facets: number, selectors: number): string {
  return `Diamond matches the sheet: ${plural(facets, "facet")}, ${plural(selectors, "selector")}.`;
}

/** What Copy details puts on the clipboard for a bug report (Flow 14, simulation reverts). */
export function simulationReport(args: {
  revert: string;
  recipeHash: string;
  chainName: string;
  chainId: number | null;
  path: string;
  catalog: string;
  block?: number;
}): string {
  const chain = args.chainId === null ? args.chainName : `${args.chainName} (${args.chainId})`;
  return [
    "Simulation reverted",
    args.revert,
    "",
    `Recipe: ${args.recipeHash}`,
    `Chain: ${chain}`,
    `Path: ${args.path}`,
    `Catalog: ${args.catalog}`,
    ...(args.block === undefined ? [] : [`Block: ${args.block}`]),
  ].join("\n");
}
