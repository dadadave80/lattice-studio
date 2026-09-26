/**
 * S8d's words: the console's Verify lines (spec L726 "Verified…"; "Couldn't verify: …" extends the same tag to
 * the other outcome, spec L579, since the console table names no separate tag for it) and the standalone
 * `forge verify-contract` command in C7a's wording (`packages/core/src/export/foundry/render.ts`).
 */
import type { Address, LineDraft } from "@lattice-studio/core";
import { lines } from "@lattice-studio/core";

function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** "Verified on Sourcify (exact match)." (spec L726). Sourcify's v2 job carries no forwarded-explorer list. */
export function verifiedLine(match: "match" | "exact_match"): LineDraft {
  return lines.verified({ status: match, forwardedTo: [] });
}

/** "Couldn't verify: {reason}." (spec L579, Flow 14 "Verification failed"). */
export function couldntVerifyLine(reason: string): LineDraft {
  return { tag: "Verify", text: `Couldn't verify: ${sentence(reason)}` };
}

/** The equivalent standalone command (spec L577), in C7a's wording. */
export function forgeVerifyCommand(address: Address, chainId: number): string {
  return `FOUNDRY_PROFILE=ci forge verify-contract ${address} src/Lattice.sol:Lattice --verifier sourcify --chain ${chainId}`;
}
