/**
 * The console header's summary (spec L376-L389, the Console summary column): one short line and its square.
 * Pure, so every state of the table is one input here.
 *
 * Precedence, first match wins:
 * 1. Offline: "Offline. Composing works; deploy needs a connection."
 * 2. A deploy in flight (signature, pending, stale, confirmed, verifying, failed): the latest deploy line
 *    ("Deploy lines stream in").
 * 3. The deploy's outcome for the recipe on the sheet: Proposed, Live, Mismatch. Once the sheet differs from
 *    the recipe the deploy was reviewed with, the outcome no longer describes it and the rows below apply.
 * 4. Empty sheet.
 * 5. Problems: "No problems", "2 blockers", "2 blockers · 1 warning"; the accent while blockers remain.
 */
import type { Address, Hex } from "@lattice-studio/core";
import { formatAddress, formatProblemSummary } from "@lattice-studio/core";
import type { DeployPhase, DeployState } from "@/contracts";

export type SummaryKind = "offline" | "deploying" | "proposed" | "live" | "mismatch" | "empty" | "clear" | "problems";

export type Summary = {
  kind: SummaryKind;
  text: string;
  /** The accent on the square and the words: blockers, Live, Mismatch (spec L675: what needs a decision or is live). */
  accent: boolean;
};

export type SummaryInput = {
  facets: number;
  blockers: number;
  warnings: number;
  online: boolean;
  /** The analysis's recipe hash, to tell whether the deploy state describes this sheet. */
  recipeHash: Hex;
  deploy: Pick<DeployState, "phase" | "snapshot" | "chainId" | "safe" | "address">;
  /** The newest Deploy, Verify or Error line's text, while a deploy streams. */
  latestDeployLine: string | null;
  chainName: (chainId: number) => string;
};

export const OFFLINE_SUMMARY = "Offline. Composing works; deploy needs a connection.";
export const EMPTY_SUMMARY = "Empty sheet";
export const MISMATCH_SUMMARY = "Deployed, but doesn't match the sheet";
export const LIVE_SUMMARY = "Live";

/** Phases whose lines stream into the summary (spec L384). */
export const STREAMING: ReadonlySet<DeployPhase> = new Set<DeployPhase>([
  "awaitingSignature", "pending", "stale", "confirmed", "verifying", "failed",
]);

/** Words for a streaming phase before its first line arrives. */
const PHASE_WORDS: Partial<Record<DeployPhase, string>> = {
  awaitingSignature: "Confirm in your wallet",
  pending: "Pending",
  stale: "Pending",
  confirmed: "Deployed; checking the diamond",
  verifying: "Verifying",
  failed: "Deploy failed",
};

function sameHash(a: Hex | undefined, b: Hex): boolean {
  return a === undefined || b === "0x" || a.toLowerCase() === b.toLowerCase();
}

export function proposedText(safe: Address | undefined, chain: string | undefined): string {
  const who = safe ? `Safe ${formatAddress(safe)}` : "the Safe";
  return chain ? `Proposed to ${who} on ${chain}` : `Proposed to ${who}`;
}

export function consoleSummary(input: SummaryInput): Summary {
  const { deploy } = input;
  if (!input.online) return { kind: "offline", text: OFFLINE_SUMMARY, accent: false };
  if (STREAMING.has(deploy.phase)) {
    return { kind: "deploying", text: input.latestDeployLine ?? PHASE_WORDS[deploy.phase] ?? "Deploying", accent: false };
  }
  if (sameHash(deploy.snapshot, input.recipeHash)) {
    const chain = deploy.chainId === undefined ? undefined : input.chainName(deploy.chainId);
    if (deploy.phase === "proposed") return { kind: "proposed", text: proposedText(deploy.safe, chain), accent: false };
    if (deploy.phase === "live") return { kind: "live", text: LIVE_SUMMARY, accent: true };
    if (deploy.phase === "mismatch") return { kind: "mismatch", text: MISMATCH_SUMMARY, accent: true };
  }
  if (input.facets === 0) return { kind: "empty", text: EMPTY_SUMMARY, accent: false };
  const text = formatProblemSummary({ blockers: input.blockers, warnings: input.warnings });
  if (input.blockers === 0 && input.warnings === 0) return { kind: "clear", text, accent: false };
  return { kind: "problems", text, accent: input.blockers > 0 };
}
