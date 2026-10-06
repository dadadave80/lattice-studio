/**
 * What the facet commands do (`../facets.ts` defines them): place, remove, and route a facet's contested selectors
 * to it.
 */
import type { EditResult, Hex4, Project } from "@lattice-studio/core";
import { isCoreFacet, lines, placeFacet, plural, removeFacets, routeSelector } from "@lattice-studio/core";
import { isPlaceholder, runCommand, session, toast, type CommandArgsOf, type CommandContext } from "@/contracts";
import { panToPlaced } from "@/sheet/canvas/sheet-view";
import { landing } from "../geometry";
import { combined, edit, facetOf, isPlaced, sayNote, summaryLine } from "../shared";

type PlaceArgs = CommandArgsOf<"facet.place">;
type RemoveArgs = CommandArgsOf<"facet.remove">;
type RouteContestedArgs = CommandArgsOf<"facet.routeContested">;

/** Selects and locates a card (S4b's `sheet.locate`, when it's built). */
function locate(facet: string): void {
  session.set({ selection: [facet] });
  if (!isPlaceholder("sheet.locate")) void runCommand({ id: "sheet.locate", args: { facet } }, "api");
}

export function place(ctx: CommandContext, { facet, at }: PlaceArgs): void {
  const catalog = ctx.catalog;
  const detail = catalog ? facetOf(catalog, facet) : undefined;
  if (!catalog || !detail) return;
  if (isCoreFacet(facet)) {
    // The core is in every diamond, never as a card: say so and select the core instead (S4b's `core.select`).
    sayNote(`${facet} is part of every diamond's core.`);
    if (!isPlaceholder("core.select")) void runCommand({ id: "core.select" }, "api");
    return;
  }
  if (isPlaced(ctx.project, facet)) {
    // Already placed: select and locate it (spec L427).
    locate(facet);
    sayNote(`${facet} is already on the sheet.`);
    return;
  }
  const spot = landing({
    project: ctx.project, catalog, analysis: ctx.analysis, session: ctx.session, facet, ...(at ? { at } : {}),
  });
  const result = edit((p) => placeFacet(p, catalog, facet, spot), {
    say: () => [lines.placed({
      facet, selectors: detail.selectors.length, ...(detail.storage ? { namespace: detail.storage.id } : {}),
    })],
  });
  if (!result.changed) return;
  session.set({ selection: [facet] });
  // The view pans only if the new card would be off-screen (spec L426).
  panToPlaced(facet);
}

export function remove(ctx: CommandContext, { facets }: RemoveArgs): void {
  const catalog = ctx.catalog;
  if (!catalog) return;
  const removed = [...new Set(facets)].filter((name) => !isCoreFacet(name) && isPlaced(ctx.project, name));
  const result = edit((p) => removeFacets(p, catalog, facets), { say: () => [lines.removed({ facets: removed })] });
  if (!result.changed) return;
  const selection = session.get().selection.filter((name) => !removed.includes(name));
  if (selection.length !== session.get().selection.length) session.set({ selection });
  // Several at once: a toast with Undo, since they may be outside the view (spec L733).
  if (removed.length >= 2) toast({ text: `Removed ${plural(removed.length, "facet")}`, action: { id: "history.undo" } });
}

/** The facet's selectors that another placed facet also exports and that it doesn't serve now. */
function contestedFor(ctx: CommandContext, facet: string, own: readonly Hex4[]): Hex4[] {
  return own.filter((hex) => {
    const route = ctx.analysis.routing[hex];
    return route !== undefined && route.contenders.length >= 2 && route.contenders.includes(facet) && route.owner !== facet;
  });
}

export function routeContested(ctx: CommandContext, { facet }: RouteContestedArgs): void {
  const catalog = ctx.catalog;
  const detail = catalog ? facetOf(catalog, facet) : undefined;
  if (!catalog || !detail) return;
  const selectors = contestedFor(ctx, facet, detail.selectors.map((s) => s.hex));
  if (selectors.length === 0) {
    sayNote(`${facet} has no contested selectors to take.`);
    return;
  }
  const refusals: string[] = [];
  edit(
    (p: Project): EditResult => {
      let next = p;
      let routed = 0;
      for (const selector of selectors) {
        const r = routeSelector(next, catalog, selector, facet);
        if (r.changed) {
          next = r.project;
          routed += 1;
        } else {
          refusals.push(r.summary);
        }
      }
      return combined(p, next, routed > 0, routed > 0 ? `Routed ${plural(routed, "selector")} to ${facet}` : (refusals[0] ?? `${facet} has no contested selectors to take.`));
    },
    // A seam that can't move says why (IR L144), even when the others moved.
    {
      say: (r) => (r.changed ? refusals.map((text) => ({ tag: "Note" as const, text })) : []),
      fallback: summaryLine,
      announce: (r) => `${r.summary}.`,
    },
  );
}
