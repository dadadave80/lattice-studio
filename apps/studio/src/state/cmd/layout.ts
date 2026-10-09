/**
 * Layout commands (Flow 8, spec L471-L487): flip pins (F), expand or collapse a card (pushing the cards below it
 * down in the same step, spec L479), Tidy (T) and Tidy selection. Layout sits outside the recipe hash, so these
 * narrate no problems; each says what it did. What they do is in `run/layout.ts`, loaded after the first paint.
 */
import { isCoreOnly } from "@lattice-studio/core";
import { command, doc, type CommandArgsOf, type CommandContext } from "@/contracts";
import { lazyRun } from "./lazy";
import { disabled, guard, isString, notOnSheet, OK } from "./shared";

type FlipArgs = CommandArgsOf<"layout.flipPins">;
type ExpandArgs = CommandArgsOf<"layout.toggleExpand">;

const SELECT_TWO = "Select two or more cards";

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
  run: lazyRun("flipPins"),
});

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
  run: lazyRun("toggleExpand"),
});

/** The selected cards on the sheet. */
export function selectedCards(ctx: CommandContext): string[] {
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
    if (isCoreOnly(ctx.project.recipe) && Object.keys(ctx.project.layout).length === 0) return disabled("Place facets first");
    return OK;
  },
  run: lazyRun("tidyAll"),
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
  run: lazyRun("tidySelection"),
});
