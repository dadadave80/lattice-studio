/**
 * A problem's fixes as its note words them (spec L309-L343, "Fixes offered"), for fix commands whose owner
 * hasn't registered them yet: a placeholder's title is its id, which no menu should show. Real commands title
 * themselves ("Keep AxelarGatewayAdapter", "Edit field", "Keep example values"), so only commands still
 * unregistered on dev are listed; an entry is dead once its owner lands and can be dropped then.
 */
import type { CommandRef, ProblemCode } from "@lattice-studio/core";

const BY_ID: Record<string, string> = {
  "inspector.focusSelectors": "Show selectors",
  "collision.choosePerSelector": "Choose per selector…",
  "dependency.compare": "Compare options…",
  "chain.focusPicker": "Choose another chain",
  "deploy.missingContracts": "Deploy missing contracts…",
  "deploy.newSalt": "Use a new salt",
  "deploy.removeFacets": "Remove facets…",
};

/** The words for a fix whose command is still a placeholder; undefined leaves the registry's title. */
export function placeholderFixLabel(code: ProblemCode, ref: CommandRef): string | undefined {
  return BY_ID[ref.id];
}
