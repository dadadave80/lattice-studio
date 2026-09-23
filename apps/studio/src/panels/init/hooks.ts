/**
 * What the init editor and the mechanism dialog read besides the document: the addresses "This diamond" and
 * "Deploying account" resolve to, the problems anchored at a field, and the chain's code checks.
 */
import type { Address, Arg, ChainState, Problem } from "@lattice-studio/core";
import { isAddress, isNotImplemented, toChecksum } from "@lattice-studio/core";
import { chainService, isOnline, session, useAnalysis } from "@/contracts";
import { usePrediction } from "@/state";
import type { Ref } from "./field-value";

export type RefAddresses = {
  self: Address | null;
  deployer: Address | null;
  /** Why they don't resolve yet ("Connect a wallet to see the deploy address (it depends on the deploying account)"). */
  reason: string | null;
};

/**
 * What the references resolve to for the selected chain, path, salt and wallet (spec L462): the predicted
 * address and the account the salt is built from. Reads S1's prediction only, so opening the plan never loads
 * the wallet stack (spec L822).
 */
export function useRefAddresses(): RefAddresses {
  const prediction = usePrediction();
  if (prediction.status === "ready") return { self: prediction.address, deployer: prediction.from, reason: null };
  return { self: null, deployer: null, reason: prediction.reason };
}

export function resolvedRef(refs: RefAddresses, ref: Ref): Address | null {
  return ref === "self" ? refs.self : refs.deployer;
}

function sameProblems(a: readonly Problem[], b: readonly Problem[]): boolean {
  return a.length === b.length && a.every((p, i) => p === b[i]);
}

function anchoredAt(problem: Problem, path: string): boolean {
  return problem.where.some((w) => w.kind === "init" && w.path === path);
}

/** The analysis' problems anchored at an init path: INIT-01, AUTH-02 and LINK-01 on a field, INIT-02 on a step. */
export function usePathProblems(path: string): Problem[] {
  return useAnalysis((analysis) => analysis.problems.filter((p) => anchoredAt(p, path)), sameProblems);
}

/** A literal address worth probing: checksummed, or null for references and anything that isn't an address. */
export function literalAddress(value: Arg | undefined): Address | null {
  return isAddress(value) ? toChecksum(value) : null;
}

/**
 * Reads the code at `address` on the selected chain, through the chain service's probe, so the readiness it
 * caches (and the analysis' INIT-01 chain rules, spec L462) see it too. Null when there's nothing to check:
 * no chain selected, offline, or the chain module not built yet. Never throws.
 */
export async function probeCode(address: Address): Promise<ChainState | null> {
  const chainId = session.get().chainId;
  if (chainId === null || !isOnline()) return null;
  try {
    const service = await chainService();
    const probed = await service.probe(chainId, { codeAt: [address] });
    return probed.ok ? probed.value : null;
  } catch (error) {
    if (isNotImplemented(error)) return null;
    throw error;
  }
}
