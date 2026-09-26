/**
 * A collision note's owner choice for its whole set (spec L435): Keep {A}, Route to {B}, or an owner menu item.
 * The words and the reason it can't run come from `selector.route` for the set's first selector, so the note
 * reads exactly what the command would (and says the read-only reason); one selector runs the command
 * itself, several route as one undo step (`owners.ts`).
 */
import type { CommandRef, Hex4 } from "@lattice-studio/core";
import { runCommand, type CommandSource } from "@/contracts";
import { applyOwners } from "./owners";

export function routeRef(selector: Hex4 | undefined, facet: string, verb?: "keep"): CommandRef {
  return { id: "selector.route", args: { selector: selector ?? "0x00000000", facet, ...(verb ? { verb } : {}) } };
}

/** Routes every selector in the set to `facet`. */
export function routeSet(selectors: readonly Hex4[], facet: string, verb: "keep" | undefined, source: CommandSource): void {
  const [only] = selectors;
  if (selectors.length === 1 && only !== undefined) {
    void runCommand(routeRef(only, facet, verb), source);
    return;
  }
  applyOwners(selectors.map((selector) => ({ selector, facet })));
}
