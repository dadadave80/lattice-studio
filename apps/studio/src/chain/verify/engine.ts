/**
 * The verify engine (spec Flow 12 steps 8-9, L577-L578): submits a Sourcify v2 job for a confirmed record, polls it
 * to a terminal outcome and writes the result back through `putDeployment`, so the deploy machine's "Verifying"
 * turns "Live" once it sees the record's `verification` leave "pending" (`chain/deploy/machine.ts`'s `onRecords`).
 *
 * One job runs per record at a time (the `inFlight` set), shared between the background watcher (`watcher.ts`) and
 * Retry verification, so a retry's write to "pending" never starts a second job alongside one already running.
 * Every write re-reads the record first and writes only the `verification` field back onto whatever's freshest
 * (S8c may be updating `tx` or `block` on the same record concurrently), and never touches a record that moved on
 * (discarded, or no longer `confirmed`): S8c's rule that a write never takes a record's verification back to
 * "pending" doesn't apply to this module, which is the one thing that does.
 */
import type { Address, Deployment, LineDraft } from "@lattice-studio/core";
import { sameAddress } from "@lattice-studio/core";
import { log } from "@/contracts";
import { appVerifyDeps } from "./app-deps";
import { couldntVerifyLine, verifiedLine } from "./copy";
import type { VerifyDeps } from "./ports";
import { pollSourcify, SOURCIFY_BASE, submitToSourcify } from "./sourcify";

const CONTRACT_IDENTIFIER = "src/Lattice.sol:Lattice";
/** Backoff between polls; the last interval repeats. */
const POLL_INTERVALS_MS = [2_000, 3_000, 5_000, 8_000, 13_000, 21_000];
/** Give up and report Couldn't verify past this, rather than polling forever (Flow 14 has no timeout of its own). */
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

function recordKey(d: Pick<Deployment, "chainId" | "address">): string {
  return `${d.chainId}:${d.address.toLowerCase()}`;
}

/** Jobs already running, so the watcher and a retry never submit the same record twice. */
const inFlight = new Set<string>();

function wait(deps: VerifyDeps, ms: number): Promise<void> {
  return new Promise((resolve) => {
    deps.clock.setTimeout(resolve, ms);
  });
}

/**
 * Re-reads the record and writes `verification` onto whatever's freshest; null when there's nothing left to write
 * to (discarded, or the record moved off `confirmed` since, e.g. Deploy again started a new one at this key).
 */
async function writeVerification(
  deps: VerifyDeps, target: Pick<Deployment, "projectId" | "chainId" | "address">, verification: Deployment["verification"],
): Promise<Deployment | null> {
  let fresh: Deployment | undefined;
  try {
    fresh = (await deps.records.list(target.projectId)).find((d) => recordKey(d) === recordKey(target));
  } catch {
    fresh = undefined;
  }
  if (!fresh || fresh.status !== "confirmed") return null;
  if (fresh.verification === verification) return fresh;
  const next: Deployment = { ...fresh, verification };
  try {
    await deps.records.put(next);
  } catch (error) {
    log({ tag: "Error", text: `Couldn't save the verification result. ${error instanceof Error ? error.message : String(error)}` });
    return fresh;
  }
  return next;
}

/** Writes `verification` and, only when the write actually landed (the record hadn't moved on), logs `line`. */
async function settle(deps: VerifyDeps, record: Deployment, verification: Deployment["verification"], line: LineDraft): Promise<void> {
  const written = await writeVerification(deps, record, verification);
  if (written) log(line);
}

/** Submits and polls one record to a terminal outcome, writing it as it settles. Never throws. */
export async function verifyRecord(deps: VerifyDeps, record: Deployment): Promise<void> {
  const base = deps.baseUrl ?? SOURCIFY_BASE;
  const build = await deps.proxyBuild(record.chainId, record.path);
  if (!build.ok) return settle(deps, record, "failed", couldntVerifyLine(build.error));
  const submitted = await submitToSourcify(deps.fetchImpl, base, record.chainId, record.address, {
    stdJsonInput: build.value.stdJsonInput,
    compilerVersion: build.value.compilerVersion,
    contractIdentifier: CONTRACT_IDENTIFIER,
    ...(record.tx ? { creationTransactionHash: record.tx } : {}),
  });
  if (!submitted.ok) return settle(deps, record, "failed", couldntVerifyLine(submitted.error));
  const startedAt = deps.clock.now();
  for (let attempt = 0; ; attempt += 1) {
    const verdict = await pollSourcify(deps.fetchImpl, base, submitted.value);
    if (!verdict.ok) return settle(deps, record, "failed", couldntVerifyLine(verdict.error));
    if (verdict.value.kind === "verified") return settle(deps, record, verdict.value.match, verifiedLine(verdict.value.match));
    if (verdict.value.kind === "failed") return settle(deps, record, "failed", couldntVerifyLine(verdict.value.reason));
    if (deps.clock.now() - startedAt >= POLL_TIMEOUT_MS) {
      return settle(deps, record, "failed", couldntVerifyLine("Sourcify didn't finish in time."));
    }
    const delay = POLL_INTERVALS_MS[Math.min(attempt, POLL_INTERVALS_MS.length - 1)] ?? 21_000;
    await wait(deps, delay);
  }
}

/** `verifyRecord`, skipping a record whose job is already running. */
export async function verifyIfNeeded(deps: VerifyDeps, record: Deployment): Promise<void> {
  const key = recordKey(record);
  if (inFlight.has(key)) return;
  inFlight.add(key);
  try {
    await verifyRecord(deps, record);
  } finally {
    inFlight.delete(key);
  }
}

/** @internal Tests: whether a job for this record is running now. */
export function verifyingNow(target: Pick<Deployment, "chainId" | "address">): boolean {
  return inFlight.has(recordKey(target));
}

/** Retry verification (contracts §5.3 `deploy.retryVerification`): reopens a failed record for another job. */
export async function retryVerification(target: { chainId: number; address: Address }, deps: VerifyDeps = appVerifyDeps()): Promise<void> {
  const found = (await deps.records.list(deps.projectId())).find((d) => d.chainId === target.chainId && sameAddress(d.address, target.address));
  if (!found) {
    log({ tag: "Error", text: "Couldn't find that deployment record to retry." });
    return;
  }
  if (found.status !== "confirmed") {
    log({ tag: "Error", text: "Only a confirmed deployment can be verified." });
    return;
  }
  const pending: Deployment = { ...found, verification: "pending" };
  try {
    await deps.records.put(pending);
  } catch (error) {
    log({ tag: "Error", text: `Couldn't start verification again. ${error instanceof Error ? error.message : String(error)}` });
    return;
  }
  void verifyIfNeeded(deps, pending);
}
