/**
 * The deploy review's words (Flow 12-14, spec L530-L606, IR L221-L243), quoted from the spec where it writes
 * them. Where the spec is silent the wording follows its voice rules (spec L667-L676) and is listed in S8b's
 * report. Only the review's lazy chunk imports it; the commands' few words are in `entry-copy.ts`.
 */
import type { AccountKind } from "@/contracts";

export { DEPLOY_NEEDS_CONNECTION, WAITING_FOR_SAFE, resolveBlockers } from "./entry-copy";

/** Spec L562, L601: any edit, account switch or chain switch while the review is open. */
export const CHANGED_SINCE_REVIEW = "Changed since review. Simulating again.";

/** Flow 13 (spec L584): the review of a deploy after a live one. */
export function deployAgainNote(live: string): string {
  return `This deploys a new diamond at a new address. The live one at ${live} stays as it is. Upgrading it in place arrives in v2.`;
}

/** Spec L573: the collapsed hardware-wallet note. */
export const HARDWARE_SUMMARY = "Using a hardware wallet?";
export const HARDWARE_BODY =
  "Your device shows a transaction hash that depends on the nonce and fees your wallet picks, so Studio can't show it in advance. Compare the calldata hash with your wallet software's data view instead.";
export const BLIND_SIGNING =
  "Blind signing must be on: no ERC-7730 descriptors exist yet for LatticeFactory, CreateX or diamond deploys.";

/** Spec L580: in v1 a Safe deploys through a Transaction Builder batch, never through Sign & deploy. */
export const SAFE_SIGNS_BY_BATCH = "In v1 a Safe deploys through a Transaction Builder batch: download it under Deployer";

/** Spec L573: the RPC can't simulate at all, so Studio asks for one extra tick. */
export const NO_SIMULATION_TICK = "Deploy without a simulation";
export const NO_SIMULATION_NOTE = "This RPC couldn't simulate the deploy, so nothing checked it before you sign.";

export const SIMULATING = "Simulating…";

/** Spec L573, L792: the typed confirmation on mainnets. */
export function typeToConfirm(name: string): string {
  return `Type ${name} to confirm`;
}
export function confirmMismatch(name: string): string {
  return `That doesn't match. Type the project name exactly as shown: ${name}`;
}
/** Spec L864: mainnet deploys carry a notice naming the unaudited code. */
export const UNAUDITED_NOTICE = "This deploys unaudited code: Lattice's README says it's unaudited, and so does CreateX's.";

/** Why Sign & deploy waits on the acknowledgements (spec L573). */
export { tickFirst } from "./entry-copy";

export const TYPE_THE_NAME = "Type the project name to confirm";

/** Spec L564: the account's kind. */
export const ACCOUNT_KINDS: Record<AccountKind, string> = {
  eoa: "account",
  delegated: "EIP-7702 account",
  smart: "smart account",
  safe: "Safe",
};

/** Section status words: each mark says it in words, never by color alone. */
export const STATUS_WORDS = {
  ok: "Ready",
  tick: "Needs a tick",
  blocked: "Blocks deploy",
  waiting: "Waiting",
} as const;

export type SectionStatus = keyof typeof STATUS_WORDS;

/** The nine sections of spec L562-L572, in order. */
export const SECTION_TITLES = {
  network: "Network",
  deployer: "Deployer",
  address: "Address",
  cut: "What gets cut",
  init: "Init",
  authority: "Authority after deploy",
  checks: "Checks",
  cost: "Cost",
  simulation: "Simulation",
} as const;

export type SectionId = keyof typeof SECTION_TITLES;

export const SECTION_IDS = Object.keys(SECTION_TITLES) as SectionId[];

/**
 * What a fix button says while its command's owner hasn't landed (a placeholder's title is its id), quoted from
 * the checks table (spec L309-L343) and IR L221-L243.
 */
export const FIX_TITLES: Readonly<Record<string, string>> = {
  "deploy.missingContracts": "Deploy missing contracts…",
  "inspector.focusSelectors": "Show selectors",
  "dependency.compare": "Compare options…",
  "collision.choosePerSelector": "Choose per selector…",
  "deploy.compare": "Compare with the sheet…",
  "deploy.keepWaiting": "Keep waiting",
  "deploy.checkWallet": "Check wallet",
  "deploy.reviewAgain": "Review again",
  "deploy.discardProposal": "Discard proposal",
  "deploy.retryVerification": "Retry verification",
  "problem.next": "Next problem",
};

/** Remove facets (IR L177). */
export function removeTitle(count: number): string {
  return count === 1 ? "Remove 1 facet" : `Remove ${count} facets`;
}
