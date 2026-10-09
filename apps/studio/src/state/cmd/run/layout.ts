/** What the layout commands do (`../layout.ts` defines them): flip pins, expand or collapse, Tidy, Tidy selection. */
import type { EditResult, Project } from "@lattice-studio/core";
import { applyLayout, flipPins as flipPinsOp, lines, plural, pushBelow, setExpanded, tidy } from "@lattice-studio/core";
import { isPlaceholder, layoutMetrics, runCommand, type CommandArgsOf, type CommandContext } from "@/contracts";
import { cardSizes, sizeOf } from "../geometry";
import { selectedCards } from "../layout";
import { edit } from "../shared";

type FlipArgs = CommandArgsOf<"layout.flipPins">;
type ExpandArgs = CommandArgsOf<"layout.toggleExpand">;

/** After Tidy the view fits (spec L476): S4b's Fit, once it's built. */
function fitView(): void {
  if (!isPlaceholder("sheet.zoomFit")) void runCommand({ id: "sheet.zoomFit" }, "api");
}

export function flipPins(ctx: CommandContext, args: FlipArgs): void {
  const facets = Array.isArray(args.facets) ? args.facets : ctx.session.selection;
  edit((p) => flipPinsOp(p, facets));
}

/** Expanding grows the card; the cards below it in its column move down by as much, in the same step. */
function toggle(project: Project, ctx: CommandContext, facet: string): EditResult {
  const catalog = ctx.catalog;
  const entry = project.layout[facet];
  if (!catalog || !entry) return setExpanded(project, facet, true);
  const expand = entry.expanded !== true;
  const flagged = setExpanded(project, facet, expand);
  if (!flagged.changed || !expand) return flagged;
  const sizes = cardSizes(project, catalog, ctx.analysis);
  const before = sizes[facet] ?? sizeOf(facet, catalog, ctx.analysis, false, entry.pins);
  const after = sizeOf(facet, catalog, ctx.analysis, true, entry.pins);
  const pushed = pushBelow(flagged.project.layout, sizes, facet, after.height - before.height, layoutMetrics);
  if (pushed === flagged.project.layout) return flagged;
  const moved = applyLayout(flagged.project, pushed);
  return moved.changed ? { ...moved, summary: flagged.summary } : flagged;
}

export function toggleExpand(ctx: CommandContext, { facet }: ExpandArgs): void {
  edit((p) => toggle(p, ctx, facet));
}

/**
 * The facets Tidy placed: the selection, or (the whole sheet) every card the tidied layout ends up with, which
 * includes a recipe facet Tidy is giving its first layout entry (spec L476; an imported recipe can be missing
 * one). The undo label and the console line count the same thing (S1 review, WP-FX6).
 */
function tidiedCount(selection: readonly string[] | undefined, result: EditResult): number {
  return selection ? selection.length : Object.keys(result.project.layout).length;
}

function tidyLayout(ctx: CommandContext, selection?: readonly string[]): EditResult | null {
  const catalog = ctx.catalog;
  if (!catalog) return null;
  return edit(
    (p) => applyLayout(p, tidy(p, catalog, ctx.analysis, layoutMetrics, selection)),
    {
      label: (r) => `Tidied ${plural(tidiedCount(selection, r), "facet")}`,
      say: (r) => [lines.tidied({ facets: tidiedCount(selection, r) })],
    },
  );
}

export function tidyAll(ctx: CommandContext): void {
  // T with two or more cards selected is Tidy selection (IR L28).
  const selected = selectedCards(ctx);
  const result = tidyLayout(ctx, ctx.source === "keys" && selected.length >= 2 ? selected : undefined);
  if (result?.changed) fitView();
}

export function tidySelection(ctx: CommandContext): void {
  tidyLayout(ctx, selectedCards(ctx));
}
