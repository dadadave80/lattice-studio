/**
 * Selecting and locating what a console line or a `find` names (IR L134, L152): its facet, or the pin of a
 * selector on its facet. Selection goes straight into the session; the pan goes through `sheet.locate`, which
 * S4b owns. While that command can't run, the selection still changes and the sheet stays where it is. A core
 * facet (DiamondLoupeFacet, ERC165Facet) is never a card: locating it selects the core instead.
 */
import type { Analysis, Anchor, Hex4 } from "@lattice-studio/core";
import { isCoreFacet } from "@lattice-studio/core";
import { commandRef, commandState, runCommand, session, type CommandSource } from "@/contracts";

export type Located = { facet: string; selector?: Hex4 };

/** The facet (and pin) an anchor points at on the sheet, or null for anchors that aren't on it. */
export function locatable(anchor: Anchor | undefined, analysis: Pick<Analysis, "routing">): Located | null {
  if (!anchor) return null;
  if (anchor.kind === "facet") return { facet: anchor.facet };
  if (anchor.kind === "selector") {
    const facet = anchor.facet ?? analysis.routing[anchor.selector]?.owner;
    return facet ? { facet, selector: anchor.selector } : null;
  }
  return null;
}

/** Selects `facets` and locates `target` (the first of them when not given). A core target selects the core. */
export function selectAndLocate(facets: readonly string[], target: Located | null, source: CommandSource): void {
  if (facets.length) session.set({ selection: [...facets] });
  if (!target) return;
  if (isCoreFacet(target.facet)) {
    // The core and the cards are never selected together: with cards selected, the core stays as it is.
    if (facets.length === 0) void runCommand(commandRef("core.select"), "api");
    return;
  }
  const ref = commandRef("sheet.locate", target.selector ? { facet: target.facet, selector: target.selector } : { facet: target.facet });
  if (commandState(ref, source).ok) void runCommand(ref, source);
}
