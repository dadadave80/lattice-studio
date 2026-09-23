/**
 * A problem's fixes as its note words them (spec L309-L343, "Fixes offered"), for fix commands whose owner
 * hasn't registered them yet: a placeholder's title is its id, which no menu should show. Real commands title
 * themselves ("Keep AxelarGatewayAdapter", "Place DiamondLoupeFacet", "Keep example values").
 */
import type { CommandRef, ProblemCode } from "@lattice-studio/core";

/** Where one command is offered by several codes under different words, keyed `<code> <command id>`. */
const BY_CODE: Record<string, string> = {
  "SEL-02 inspector.focusSelectors": "Show selectors",
  "SEL-03 inspector.focusSelectors": "Route a selector…",
  "INIT-02 init.open": "Move step",
  "INIT-05 init.open": "Review fields",
  "NET-01 deploy.usePath": "Use LatticeFactory",
};

const BY_ID: Record<string, string> = {
  "init.focusField": "Edit field",
  "init.confirmAddress": "Confirm address…",
  "authority.chooseMechanism": "Choose an upgrade mechanism…",
  "collision.choosePerSelector": "Choose per selector…",
  "dependency.compare": "Compare options…",
  "chain.focusPicker": "Choose another chain",
  "deploy.missingContracts": "Deploy missing contracts…",
  "deploy.newSalt": "Use a new salt",
  "deploy.removeFacets": "Remove facets…",
  "chain.useAnotherRpc": "Use another RPC…",
  "inspector.focusSelectors": "Show selectors",
};

const PRESETS: Record<string, string> = { safe: "Use a Safe…", governance: "Use governance…" };

/** The words for a fix whose command is still a placeholder; undefined leaves the registry's title. */
export function placeholderFixLabel(code: ProblemCode, ref: CommandRef): string | undefined {
  const preset = ref.args?.["preset"];
  if (ref.id === "authority.chooseMechanism" && typeof preset === "string" && PRESETS[preset]) return PRESETS[preset];
  return BY_CODE[`${code} ${ref.id}`] ?? BY_ID[ref.id];
}
