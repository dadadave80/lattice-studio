/**
 * The sheet chrome's words, quoted from the spec where it writes them. Plain strings, so the commands (entry
 * chunk) and the lazy layers share one source, and tests assert against the same text.
 */
import { plural } from "@lattice-studio/core";

/** Spec L378: the empty sheet's Deploy reason. */
export const PLACE_FACETS_FIRST = "Place facets first";
/** Spec L378: the empty title block's address. */
export const NO_ADDRESS = "—";
/** Spec L386: the last prediction while offline. */
export const OFFLINE_MARK = "offline";
/** Spec L378, IR L108: the Start block. */
export const START_A_DIAMOND = "Start a diamond";
export const BLANK_DIAMOND_LABEL = "Blank diamond (core only)";
export const BROWSE_ALL_RECIPES = "Browse all recipes";
/** Spec L378: the hint under the Start block; the keys follow the platform. */
export function startHint(paletteKeys: string): string {
  return `Drag from the catalog, or press ${paletteKeys}`;
}
/** Spec L400: the tour line under the Start block. */
export const TOUR_PROMPT = "New here?";
export const TOUR_LINK = "Take the 60-second tour";
/** Spec L405: what each of v1's recipe cards is. */
export const RECIPE_BLURBS: Readonly<Record<string, string>> = {
  GovernedVault: "Self-governed ERC-4626 vault",
  ERC20: "A fixed token, immutable by default",
  SafeDiamondCut: "A diamond only your Safe can upgrade",
};
/** Spec L405: v1's three recipe cards, in order. */
export const START_RECIPES = ["GovernedVault", "ERC20", "SafeDiamondCut"] as const;
/** Spec L383: the chip while init order mode is on. */
export const INIT_ORDER_CHIP = "Init order · Esc";
/** Spec L408 (the v1.1 note) for Auto-layout (spec L477). */
export const ARRIVES_V11 = "Arrives in v1.1";
/** Why init order mode can't open. */
export const NO_INIT_STEPS = "The init plan has no steps";
/** Flow 7 step 5: a bundle shows its fixed order and no controls. */
export function bundleFixed(bundle: string): string {
  return `${bundle} is a bundle: its order is fixed.`;
}
export const DRAG_TO_REORDER = "Drag a badge to reorder.";
/** Flow 2 step 5: "1 parameter to fill". */
export function toFill(count: number): string {
  return `${plural(count, "parameter")} to fill`;
}
/** Deploy {chain}: "Confirm in MetaMask" (spec L384). */
export function confirmIn(wallet: string): string {
  return `Confirm in ${wallet}`;
}
export const YOUR_WALLET = "your wallet";
/** Spec L362: the picker's chain before one is chosen. */
export const NO_CHAIN = "Choose a chain";
