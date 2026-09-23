/**
 * Layout commands (Flow 8, spec L471-L487): flip pins (F), expand or collapse a card (pushing the cards below it
 * down in the same step, spec L479), Tidy (T) and Tidy selection. Layout sits outside the recipe hash, so these
 * narrate no problems; each says what it did.
 */
import type { EditResult, Project } from "@lattice-studio/core";
import { applyLayout, flipPins, lines, plural, pushBelow, setExpanded, tidy } from "@lattice-studio/core";
import { command, doc, isPlaceholder, layoutMetrics, runCommand, type CommandArgsOf, type CommandContext } from "@/contracts";
import { cardSizes, sizeOf } from "./geometry";
import { disabled, edit, guard, isString, notOnSheet, OK } from "./shared";

type FlipArgs = CommandArgsOf<"layout.flipPins">;
type ExpandArgs = CommandArgsOf<"layout.toggleExpand">;

const SELECT_TWO = "Select two or more cards";

/** After Tidy the view fits (spec L476): S4b's Fit, once it's built. */
function fitView(): void {
  if (!isPlaceholder("sheet.zoomFit")) void runCommand({ id: "sheet.zoomFit" }, "api");
}

export const flipPinsCommand = command<FlipArgs>({
  id: "layout.flipPins",
  title: () => "Flip pins",
  category: "Sheet",
  keys: ["f"],
  keyContext: ["sheet"],
  palette: true,
  enabled(ctx, args) {
    const blocked = guard(ctx, false);
    if (blocked) return blocked;
    const facets = Array.isArray(args.facets) ? args.facets : ctx.session.selection;
    if (facets.length === 0) return disabled("Select a card to flip its pins");
    return OK;
  },
  run(ctx, args) {
    const facets = Array.isArray(args.facets) ? args.facets : ctx.session.selection;
    edit((p) => flipPins(p, facets));
  },
});

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

export const toggleExpandCommand = command<ExpandArgs>({
  id: "layout.toggleExpand",
  title: ({ facet }) => (doc.get().layout[facet]?.expanded === true ? `Collapse ${facet}` : `Expand ${facet}`),
  category: "Sheet",
  enabled(ctx, args) {
    const blocked = guard(ctx);
    if (blocked) return blocked;
    if (!isString(args.facet)) return disabled("Name the card to expand");
    if (!ctx.project.layout[args.facet]) return disabled(notOnSheet([args.facet]));
    return OK;
  },
  run(ctx, { facet }) {
    edit((p) => toggle(p, ctx, facet));
  },
});

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

/** The selected cards on the sheet. */
function selectedCards(ctx: CommandContext): string[] {
  return ctx.session.selection.filter((name) => ctx.project.layout[name] !== undefined);
}

export const tidyCommand = command({
  id: "layout.tidy",
  title: () => "Tidy",
  category: "Sheet",
  keys: ["t"],
  keyContext: ["sheet"],
  palette: true,
  console: { verb: "tidy", syntax: "tidy", parse: (argv) => (argv.length === 0 ? { ok: true, value: {} } : { ok: false, error: "tidy takes no arguments." }) },
  enabled(ctx) {
    const blocked = guard(ctx);
    if (blocked) return blocked;
    if (ctx.project.recipe.facets.length === 0 && Object.keys(ctx.project.layout).length === 0) return disabled("Place facets first");
    return OK;
  },
  run(ctx) {
    // T with two or more cards selected is Tidy selection (IR L28).
    const selected = selectedCards(ctx);
    const result = tidyLayout(ctx, ctx.source === "keys" && selected.length >= 2 ? selected : undefined);
    if (result?.changed) fitView();
  },
});

export const tidySelectionCommand = command({
  id: "layout.tidySelection",
  title: () => "Tidy selection",
  category: "Sheet",
  palette: true,
  enabled(ctx) {
    const blocked = guard(ctx);
    if (blocked) return blocked;
    if (selectedCards(ctx).length < 2) return disabled(SELECT_TWO);
    return OK;
  },
  run(ctx) {
    tidyLayout(ctx, selectedCards(ctx));
  },
});
