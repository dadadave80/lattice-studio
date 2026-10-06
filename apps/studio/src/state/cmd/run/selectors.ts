/** What the selector commands do (`../selectors.ts` defines them): choose or clear an owner, leave out, bring back. */
import { clearOwner as clearOwnerOp, excludeSelector, includeSelector, routeSelector } from "@lattice-studio/core";
import type { CommandArgsOf, CommandContext } from "@/contracts";
import { edit, summaryLine } from "../shared";

type RouteArgs = CommandArgsOf<"selector.route">;
type ClearOwnerArgs = CommandArgsOf<"selector.clearOwner">;
type ExcludeArgs = CommandArgsOf<"selector.exclude">;
type IncludeArgs = CommandArgsOf<"selector.include">;

export function route(ctx: CommandContext, { selector, facet }: RouteArgs): void {
  const catalog = ctx.catalog;
  if (!catalog) return;
  // Settling a collision narrates "Resolved: … routes to {facet}." (spec L713); anything else says the summary.
  edit((p) => routeSelector(p, catalog, selector, facet), { fallback: summaryLine });
}

export function clearOwner(ctx: CommandContext, { selector }: ClearOwnerArgs): void {
  const catalog = ctx.catalog;
  if (!catalog) return;
  edit((p) => clearOwnerOp(p, catalog, selector));
}

export function exclude(ctx: CommandContext, { selector }: ExcludeArgs): void {
  const catalog = ctx.catalog;
  if (!catalog) return;
  edit((p) => excludeSelector(p, catalog, selector));
}

export function include(ctx: CommandContext, { selector, facet }: IncludeArgs): void {
  const catalog = ctx.catalog;
  if (!catalog) return;
  edit((p) => includeSelector(p, catalog, selector, facet));
}
