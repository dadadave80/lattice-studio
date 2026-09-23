/**
 * L728's line through C10's builder, with the chain's name, loaded only when an edit leaves what's live: the entry
 * chunk carries neither the console-line builders nor the chain table for a watch that rarely fires.
 */
import type { LineDraft } from "@lattice-studio/core";
import { lines } from "@lattice-studio/core";
import { env } from "@/contracts";
import { chainName } from "../infra/chains";

export function divergedLine(chainId: number, revision: number): LineDraft {
  return lines.diverged({ chain: chainName(chainId, env.e2e), revision });
}
