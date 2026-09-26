/**
 * A deployment record built for the two-tabs spec: confirmed on Anvil (chain 31337) with a failed verification,
 * so Retry verification is offered (`DeploymentRecord.tsx`) and resolves at once with no network call —
 * `chain/verify/chains.ts`'s `sourcifyServes` refuses 31337 before any fetch, so retrying it needs neither a
 * running Anvil node nor a stubbed Sourcify. It proves records write from a read-only (demoted) tab, because
 * `deploy.retryVerification`'s `enabled` ignores the session's read-only reason (spec L505: "deployment records
 * sit outside the lock").
 */
import type { Deployment, Project } from "@lattice-studio/core";
import { ANVIL_CHAIN_ID } from "../../_support/anvil.ts";
import { deploymentFor } from "../../_support/projects.ts";

/** Why Retry verification's job settles at once (`engine.ts`'s `verifyRecord`, `chains.ts`'s `unverifiableChainName`). */
export const UNVERIFIABLE_REASON = "Sourcify doesn't verify contracts on Anvil.";

/** A confirmed record on Anvil whose last verification attempt failed, ready for Retry verification. */
export function failedVerificationRecord(project: Project): Deployment {
  const base = deploymentFor(project, ANVIL_CHAIN_ID);
  return { ...base, verification: "failed", verificationReason: UNVERIFIABLE_REASON };
}
