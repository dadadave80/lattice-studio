/**
 * A problem's fixes as its note words them (spec L309-L343, "Fixes offered"), for fix commands whose owner
 * hasn't registered them yet: a placeholder's title is its id, which no menu should show. Real commands title
 * themselves ("Keep AxelarGatewayAdapter", "Edit field", "Keep example values"), so only commands still
 * unregistered on dev are listed; an entry is dead once its owner lands and can be dropped then.
 */
import type { CommandRef, ProblemCode } from "@lattice-studio/core";

/**
 * Where one command is offered by several codes under different words, keyed `<code> <command id>`.
 * `deploy.usePath` is registered with this exact wording, so its row was dead (FX24). SEL-02 and SEL-03's rows
 * stay until `inspector.focusSelectors` reads its verb (CCR, FX24) and `structure-model.test.ts` L196 goes with them.
 */
const BY_CODE: Record<string, string> = {
  "SEL-02 inspector.focusSelectors": "Show selectors",
  "SEL-03 inspector.focusSelectors": "Route a selector…",
};

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
  return BY_CODE[`${code} ${ref.id}`] ?? BY_ID[ref.id];
}
