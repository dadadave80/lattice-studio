/**
 * The sheet chrome's words, quoted from the spec where it writes them. Plain strings, so the commands (entry
 * chunk) and the lazy layers share one source, and tests assert against the same text.
 */
import { plural, type DeployPath } from "@lattice-studio/core";
import type { DeployPhase } from "@/contracts";

/** Spec L378: the empty sheet's Deploy reason. */
export const PLACE_FACETS_FIRST = "Place facets first";
/** Spec L378: the empty title block's address. */
export const NO_ADDRESS = "—";
/** Spec L386: the last prediction while offline. */
export const OFFLINE_MARK = "offline";
/** Spec L378, IR L108: the Start block. */
export const START_A_DIAMOND = "Start a diamond";
/** Every diamond has the core; the Blank diamond adds Receive, AccessControl and AccessControlDiamondCut. */
export const BLANK_DIAMOND_LABEL = "Blank diamond";
/** What Blank diamond adds to a sheet that already holds the core (Receive, AccessControl, AccessControlDiamondCut). */
export const BLANK_DIAMOND_ADDS = "Adds Receive, and an admin role that can upgrade the diamond.";
export const BROWSE_ALL_RECIPES = "Browse all recipes";
/** Spec L378: the hint under the Start block; the keys follow the platform. */
export function startHint(paletteKeys: string): string {
  return `Drag from the catalog, or press ${paletteKeys}`;
}
/** Spec L400: the tour line under the Start block. */
export const TOUR_PROMPT = "New here?";
export const TOUR_LINK = "Take the 60-second tour";
/** Spec L696: the sheet's error state's buttons (its text is persist's `openFailureText`). */
export const OPEN_ANOTHER_PROJECT = "Open another project";
export const COPY_DETAILS = "Copy details";
/** What Copy details' toast names: "Copied details". */
export const DETAILS_LABEL = "details";
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
/** Why a command waits on the catalog (the words S1 and S8b use). */
export const CATALOG_LOADING = "The catalog hasn't loaded yet · Wait for it to finish";
/** Flow 7 step 5: a bundle shows its fixed order and no controls (legend line, no period, like a reason). */
export function bundleFixed(bundle: string): string {
  return `${bundle} is a bundle: its order is fixed`;
}
export const DRAG_TO_REORDER = "Drag a badge to reorder";
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
/** The visually hidden end of a link's name that opens a new tab. */
export const NEW_TAB = " (opens in a new tab)";

// Mirrors of S8b's words and phases (`chain/review/entry-copy.ts`, `progress-view.ts`), so a reshape of S8b's
// internals can't break the chrome. `copy.test.ts` checks they still agree.

/** Deploy's reason while a deploy is on its way. */
export const ON_ITS_WAY = "This deploy is already on its way";
/** A deploy on its way: Deploy… reopens the review at its progress (IR L207). */
export const IN_FLIGHT_PHASES: ReadonlySet<DeployPhase> = new Set<DeployPhase>([
  "awaitingSignature", "pending", "stale", "proposed", "confirmed", "verifying",
]);
/** The path's display name, as S8b writes it. */
export function pathName(path: DeployPath): string {
  return path === "createx" ? "CreateX" : "LatticeFactory";
}
/** How long a transaction has been pending since `since` (ISO), as "m:ss" ("0:12"); null when it isn't a time. */
export function elapsedText(since: string | undefined, nowMs: number): string | null {
  if (since === undefined) return null;
  const start = Date.parse(since);
  if (Number.isNaN(start)) return null;
  const seconds = Math.max(0, Math.floor((nowMs - start) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Phases after the transaction landed: the address is the diamond's, no longer a prediction. */
export const LANDED_PHASES: ReadonlySet<DeployPhase> = new Set<DeployPhase>(["confirmed", "verifying"]);
