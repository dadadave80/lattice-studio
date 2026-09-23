import type { Address, Hex, Hex4 } from "./hex";
import type { Anchor } from "./problems";

/** Console line tags (contracts §3.1, spec L705-L729). */
export type ConsoleTag = "Note" | "Placed" | "Resolved" | "Collision" | "Missing" | "Init" | "Deploy" | "Verify" | "Error";

/** A console line (contracts §3.1). `at` is an ISO time the caller stamps. */
export type ConsoleLine = { tag: ConsoleTag; text: string; dim?: true; anchor?: Anchor; at: string };

/**
 * A console line before it's stamped. Core has no clock (spec L102), so `narrate` and the `lines.*`
 * builders return drafts and the caller adds `at`.
 */
export type LineDraft = Omit<ConsoleLine, "at">;

/** Why the analysis changed, for `narrate`. A load resets the baseline (`prev = null`, spec L304). */
export type NarrateCause = { kind: "edit" | "undo" | "redo" | "chain"; label?: string };

/** A selector with its signature: formats and lines never show hex alone (spec L670). */
export type SelectorRef = { hex: Hex4; signature: string };

/**
 * One builder per console line of spec L707-L729, plus L410 (recipe loaded) and L652 (mechanism changed).
 * Each doc comment names the work package that emits it.
 */
export type ConsoleLineBuilders = {
  /** S14 · L707 "Catalog: Lattice 0.4.0 · 100 facets." */
  catalogLoaded(args: { version: string; facets: number; provisional?: string }): LineDraft;
  /** S7b · L708 "Opened GovernedVault · 14 facets · saved 2 min ago." */
  projectOpened(args: { name: string; facets: number; savedAt: string; now: string }): LineDraft;
  /** S13 · L709 "Opened a shared link · recipe 0x3f2a…a1c4 · 2 addresses to confirm." */
  linkOpened(args: { recipeHash: Hex; toConfirm: number }): LineDraft;
  /** S1 · L410 "Loaded GovernedVault · 14 facets · 120 selectors · from script/base/defi/DeployGovernedVault.s.sol." */
  recipeLoaded(args: { name: string; facets: number; selectors: number; script?: string }): LineDraft;
  /** S1 · L710 "Placed ERC20 · 9 selectors · erc7201:lattice.storage.ERC20" */
  placed(args: { facet: string; selectors: number; namespace?: string }): LineDraft;
  /** S1 · L711 "Removed ERC20 and ERC4626." */
  removed(args: { facets: string[] }): LineDraft;
  /** S1 · L712 "AxelarGatewayAdapter and HyperlaneGatewayAdapter both export `sendMessage · 0xcdfe7f5c` and …. Choose an owner." */
  collision(args: { contenders: string[]; selectors: SelectorRef[] }): LineDraft;
  /** S1 · L713 "Resolved: `sendMessage · 0xcdfe7f5c` and … route to HyperlaneGatewayAdapter." */
  resolved(args: { selectors: SelectorRef[]; owner: string }): LineDraft;
  /** S1 · L714 "VaultCore requires ERC4626: it runs the assets behind ERC4626's shares." */
  missing(args: { facet: string; requires: string; reason: string }): LineDraft;
  /** S1 · L715 "Dependency met: VaultCore." */
  dependencyMet(args: { facet: string }): LineDraft;
  /** S1 · L716 "Set Governor quorum to 4%." (`value` already formatted with its unit). */
  fieldSet(args: { label: string; value: string }): LineDraft;
  /** S1 · L717 "Moved VaultCore to step 3, after ERC4626." (`step` counts from 1). */
  stepMoved(args: { spec: string; step: number; after?: string }): LineDraft;
  /** S1 · L718 "Tidied 14 facets." */
  tidied(args: { facets: number }): LineDraft;
  /** S1 · L719 "Undid: Placed ERC20." (dim). */
  undid(args: { label: string }): LineDraft;
  /** S5d · L652 "Upgrade mechanism: SafeDiamondCut · Safe 0x71C7…976F." */
  mechanismChanged(args: { facet: string; holder?: string }): LineDraft;
  /** S8c · L720 "Review: Sepolia · LatticeFactory · 14 facets." */
  reviewOpened(args: { chain: string; path: "factory" | "createx"; facets: number }): LineDraft;
  /** S8c · L721 "Simulated at block 9,123,456: succeeded, 7 events." */
  simulated(args: { block: number; events: number }): LineDraft;
  /** S8c · L722 "Submitted 0x1234…abcd on Sepolia." */
  submitted(args: { tx: Hex; chain: string }): LineDraft;
  /** S8c · L723 "Proposed to Safe 0x71C7…976F on Sepolia. Waiting for the Safe to execute the batch." */
  proposed(args: { safe: Address; chain: string }): LineDraft;
  /** S8c · L724 "Deployed at 0x5FbD…0aa3 in block 9,123,460. Matches the sheet." */
  confirmed(args: { address: Address; block: number }): LineDraft;
  /** S8c · L725 "Deployed at 0x5FbD…0aa3, but `facets()` doesn't match the sheet: 2 selectors differ." */
  mismatch(args: { address: Address; differing: number }): LineDraft;
  /** S8d · L726 "Verified on Sourcify (exact match); forwarded to Etherscan and Blockscout." */
  verified(args: { status: "match" | "exact_match"; forwardedTo: string[] }): LineDraft;
  /** S8c · L727 "Deploy reverted in LatticeRegistry: `LatticeRegistry__RecordNotFound(lattice.ERC20, 0.4.0)`. …" */
  reverted(args: { module: string | null; error: string; args: string; note?: string }): LineDraft;
  /** S8c · L728 "The sheet now differs from what's live on Sepolia (r1)." */
  diverged(args: { chain: string; revision: number }): LineDraft;
  /** S5e · L729 "Exported DeployGovernedVault.s.sol · recipe 0x3f2a…a1c4" */
  exported(args: { filename: string; recipeHash: Hex }): LineDraft;
};

/** Key labels per platform: ⌘C on macOS, Ctrl+C elsewhere (spec L689). */
export type Platform = "mac" | "other";

/** C10 `formatTime`: relative text and the absolute tooltip (spec L687). */
export type RelativeTime = { text: string; title: string };

/** One finding of C10 `lintCopy` (spec L667-L676). */
export type CopyIssue = {
  rule: "please" | "oops" | "exclamation" | "ok-yes" | "title-case" | "british";
  /** The offending text. */
  match: string;
  index: number;
  message: string;
};
