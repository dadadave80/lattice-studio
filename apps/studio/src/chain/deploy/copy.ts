/**
 * The deploy engine's words. Quoted from the spec where it writes them (Flow 12 L559-L580, Flow 14 L586-L606, the
 * banners IR L207); the rest follows its Rules (sentence case, no "please", no exclamation marks) and is listed in
 * the WP report. Light: the commands read it from the entry chunk.
 */
import { formatAddress, plural } from "@lattice-studio/core";
import type { Address } from "@lattice-studio/core";

export { CANCELED_IN_WALLET, CONNECT_A_WALLET, walletOn } from "../infra/copy";

/** "9,123,456": digits grouped by threes, as the console lines write block numbers (spec L721). */
export function groupDigits(value: number | bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** "0x1234…abcd": a hash or address shortened as the console lines write them (spec L722). */
export function truncateHex6(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 6)}…${value.slice(-4)}`;
}

/** IR L207: the banner while a deploy is in flight, and its action. */
export const DEPLOYING_BANNER = "Deploying the recipe as reviewed. Edits made now aren't part of it.";
export const DEPLOY_BANNER_ID = "deploy-in-flight";

/** Flow 14: the review while its inputs change. */
export const CHANGED_SINCE_REVIEW = "Changed since review. Simulating again.";

/** Flow 12 step 7 / Flow 14: a deploy whose `facets()` differs from the plan. Saved as Mismatch, never Live. */
export const MISMATCH = "Deployed, but `facets()` doesn't match the plan.";

/** Flow 14: offline mid-deploy. */
export const OFFLINE_TRACKING = "Offline. Tracking resumes when you reconnect.";

/** Flow 14: Deploy disabled offline. */
export const DEPLOY_NEEDS_CONNECTION = "Deploy needs a connection.";

/** Flow 12 step 6: no receipt after the timeout (180 s by default). */
export function notSeenFor(seconds: number): string {
  const span = seconds >= 60 && seconds % 60 === 0 ? plural(seconds / 60, "minute") : plural(seconds, "second");
  return `Not seen for ${span}. It may have been dropped.`;
}

/** Flow 12 step 6: canceled in the wallet (the nonce went to a transaction to self). */
export const CANCELED_TRANSACTION = "The transaction was canceled in your wallet.";

/** A different transaction took the deploy's nonce (not a speed-up, not a cancel). */
export const REPLACED_TRANSACTION = "Your wallet replaced the transaction with a different one, so nothing was deployed.";

/** Flow 12 step 6: sped up, Studio follows the new hash. */
export function spedUp(hash: string): string {
  return `Sped up in your wallet. Following ${hash}.`;
}

/** Review again found the first transaction landed after all (Flow 12 step 6). */
export function landedAfterAll(address: Address, chain: string): string {
  return `The first transaction landed after all: the diamond is at ${formatAddress(address)} on ${chain}.`;
}

/** Sign refused: the predicted address already has code and no pending record explains it (NET-05). */
export function addressTaken(address: Address, chain: string): string {
  return `${formatAddress(address)} already has code on ${chain}. Use a new salt.`;
}

/** Sign refused: the inputs changed since the last simulation. */
export const SIMULATE_FIRST = "The review changed since the last simulation. Simulating again.";

/** `eth_call` succeeded where `eth_simulateV1` isn't available (NET-07): no event count. */
export function simulatedWithCall(block: string): string {
  return `Simulated at block ${block} with eth_call: succeeded.`;
}

/** The Simulation section's summary (Flow 12 step 2). */
export function simulationSummary(args: { block: string; address: Address; facets: number; selectors: number; events?: number }): string {
  const events = args.events === undefined ? "" : `, ${plural(args.events, "event")}`;
  return `Simulated at block ${args.block}: diamond at ${formatAddress(args.address)} with ${plural(args.facets, "facet")}, ${plural(args.selectors, "selector")}${events}.`;
}

/** Discard proposal. */
export function discardedProposal(safe: Address, chain: string): string {
  return `Discarded the proposal to Safe ${formatAddress(safe)} on ${chain}.`;
}

/** A proposal's Safe executed the batch. */
export function proposalExecuted(address: Address, chain: string): string {
  return `The Safe executed the batch: the diamond is at ${formatAddress(address)} on ${chain}.`;
}

/** A From file record re-read on-chain (spec L501, L857). */
export function fileRecordConfirmed(address: Address, chain: string): string {
  return `Re-read ${formatAddress(address)} on ${chain}: it matches its record.`;
}
export function fileRecordMismatch(address: Address, chain: string): string {
  return `Re-read ${formatAddress(address)} on ${chain}: \`facets()\` doesn't match its record. Saved as Mismatch.`;
}

/**
 * A From file record whose recipe is neither the sheet's nor a Studio recipe: no plan to check it against, so it
 * stays From file, never Confirmed (spec L501, L857).
 */
export function fileRecordUnchecked(address: Address, chain: string): string {
  return `Couldn't check ${formatAddress(address)} on ${chain}: its record is for another recipe than this sheet. It stays From file.`;
}

/** Review again: the node no longer knows the transaction and nothing landed. */
export function droppedRecorded(hash: string, chain: string): string {
  return `${chain} no longer knows ${hash} and nothing landed: it was dropped. Recorded as failed.`;
}

/** Review again, or Sign, while the first transaction with this salt is still known to the node. */
export function stillWaiting(hash: string, chain: string): string {
  return `${hash} is still waiting on ${chain} with this salt. Keep waiting, speed it up in your wallet, or use a new salt.`;
}

/** Sign & deploy's reason while the RPC can't simulate: the review's extra tick is the way on (spec L575). */
export function signNeedsTick(chain: string): string {
  return `${chain}'s RPC can't simulate this deploy. Tick the review's extra box to sign without a simulation.`;
}

/** Spec L575: the RPC can't simulate at all. The review asks for one more tick before signing. */
export function cantSimulate(chain: string): string {
  return `${chain}'s RPC can't simulate this deploy. Signing without a simulation needs one more tick.`;
}

/** The wallet moved to another account between the step's start and a send: nothing was sent. */
export const ACCOUNT_CHANGED = "Your wallet switched accounts, so nothing was sent. Deploy again from this step.";

/** open() or proposed() while a transaction or a proposal is being tracked. */
export const ALREADY_IN_FLIGHT = "A deploy is already in flight. Show deploy progress to follow it.";

/** Spec L697: the Deployments list's error, reused for a record Studio couldn't re-read. */
export function couldntReadRecord(chain: string): string {
  return `Couldn't read ${chain} for this record.`;
}

/** A deployment record the browser refused to write (storage full, a newer Studio). Tracking goes on in memory. */
export function recordNotSaved(reason: string): string {
  return `The deployment record wasn't saved: ${reason} Tracking continues in this tab.`;
}

/** Check wallet (IR L238), by what the node knows of the transaction. */
export function checkWalletText(status: "pending" | "mined" | "unknown", chain: string): string {
  if (status === "pending") return `${chain} still has the transaction waiting to be included. Open your wallet to speed it up or cancel it.`;
  if (status === "mined") return `${chain} has included the transaction. Studio is reading its receipt.`;
  return `${chain} doesn't know this transaction. Open your wallet to see whether it was dropped or replaced.`;
}

// ---------------------------------------------------------------------------------------------------------------
// Missing contracts (Flow 12 step 3)

export const MISSING_TITLE = "Deploy missing contracts";
export const MISSING_DESCRIPTION =
  "Each deploys through Arachnid's proxy at its release address, which depends only on its bytecode, so any connected account can do this.";

export function missingDone(deployed: number, failed: number, chain: string): string {
  if (failed === 0) return `Deployed ${plural(deployed, "missing contract")} on ${chain}.`;
  return `Deployed ${deployed} of ${plural(deployed + failed, "missing contract")} on ${chain}; ${failed} failed.`;
}

/** A contract that isn't at its address after its transaction: diagnosed by `eth_call` replay (spec L572). */
export function missingWouldDeploy(name: string): string {
  return `${name} isn't at its address yet, but its creation succeeds now. Retry.`;
}
export function missingReverts(name: string): string {
  return `Creating ${name} reverts: Arachnid's proxy gives no reason, so check the gas and the chain's code size limit.`;
}
export const NOTHING_MISSING = "Nothing to deploy: every contract is already on this chain.";

export const DEPLOY_NOT_BUILT = "Not built yet · WP-S8b";
