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
 *
 * Etherscan is a second, independent leg (`verifyOnEtherscan`): it runs beside Sourcify's whenever there's an API
 * key, has its own in-flight entry, and keeps its outcome in `etherscan-outcomes.ts`, never on the record. Neither
 * leg waits for, blocks or fails the other, and the record's `verification` stays Sourcify's alone.
 */
import type { Address, Deployment, LineDraft } from "@lattice-studio/core";
import { sameAddress } from "@lattice-studio/core";
import { announce, log, settings } from "@/contracts";
import { appVerifyDeps } from "./app-deps";
import { etherscanServes, sourcifyServes, unverifiableChainName } from "./chains";
import { couldntVerifyLine, couldntVerifyOnEtherscanLine, ETHERSCAN_NOT_SET_UP, etherscanVerifiedLine, verifiedLine } from "./copy";
import { ETHERSCAN_BASE, etherscanCompilerVersion, pollEtherscan, scrub, submitToEtherscan } from "./etherscan";
import { etherscanOutcomes } from "./etherscan-outcomes";
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

/** Etherscan's backoff, between submissions it can't take yet and between polls; the last interval repeats. */
const ETHERSCAN_INTERVALS_MS = [5_000, 5_000, 10_000, 15_000, 20_000, 30_000];

type Leg = "sourcify" | "etherscan";

/** Jobs already running, one entry per record and leg, so the watcher and a retry never submit the same one twice. */
const inFlight = new Set<string>();

function legKey(d: Pick<Deployment, "chainId" | "address">, leg: Leg): string {
  return `${recordKey(d)}:${leg}`;
}

/** Resolves after `ms`, or at once when `signal` was already aborted, or as soon as it aborts meanwhile. */
function wait(deps: VerifyDeps, ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = deps.clock.setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        deps.clock.clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * Re-reads the record and writes `verification` (and, only while it's "failed", `verificationReason`, spec L606,
 * FX21's inspector) onto whatever's freshest; null when there's nothing left to write to (discarded, or the record
 * moved off `confirmed` since, e.g. Deploy again started a new one at this key), or when the write itself failed
 * (the caller then knows not to log an outcome that never landed).
 */
async function writeVerification(
  deps: VerifyDeps,
  target: Pick<Deployment, "projectId" | "chainId" | "address">,
  verification: Deployment["verification"],
  reason?: string,
): Promise<Deployment | null> {
  let fresh: Deployment | undefined;
  try {
    fresh = (await deps.records.list(target.projectId)).find((d) => recordKey(d) === recordKey(target));
  } catch {
    fresh = undefined;
  }
  if (!fresh || fresh.status !== "confirmed") return null;
  const nextReason = verification === "failed" ? reason : undefined;
  if (fresh.verification === verification && fresh.verificationReason === nextReason) return fresh;
  const { verificationReason: _staleReason, ...rest } = fresh;
  const next: Deployment = { ...rest, verification, ...(nextReason !== undefined ? { verificationReason: nextReason } : {}) };
  try {
    await deps.records.put(next);
  } catch (error) {
    const text = `The verification result wasn't saved: ${error instanceof Error ? error.message : String(error)}`;
    log({ tag: "Error", text });
    // A plain "Error" line the console wouldn't otherwise announce (its own text doesn't start with "Deploy",
    // and nothing here is "streaming"): announce it directly, an interrupt unless announcements are off
    // (spec L785), mirroring `chain/deploy/machine.ts`'s `save()` for the same kind of write failure.
    if (settings.get().deployAnnouncements !== "none") announce(text, { politeness: "assertive" });
    return null;
  }
  return next;
}

/**
 * Writes `verification` and, only when the write actually landed (the record hadn't moved on), logs `line`.
 * `reason` is the same text `line` was built from (`couldntVerifyLine`'s argument); it's stored as
 * `verificationReason` while `verification` is "failed", and dropped otherwise.
 */
async function settle(
  deps: VerifyDeps, record: Deployment, verification: Deployment["verification"], line: LineDraft, reason?: string,
): Promise<void> {
  const written = await writeVerification(deps, record, verification, reason);
  if (written) log(line);
}

/** `settle`'s "failed" case: writes `verification: "failed"` and `verificationReason: reason`, logs Sourcify's line. */
function fail(deps: VerifyDeps, record: Deployment, reason: string): Promise<void> {
  return settle(deps, record, "failed", couldntVerifyLine(reason), reason);
}

/**
 * Submits and polls one record to a terminal outcome, writing it as it settles. Never throws, and never calls
 * `fetchImpl` for a chain Sourcify doesn't serve (a local or ephemeral test network, e.g. Anvil under `test:chain`
 * or e2e) or once `signal` aborts (the watcher stopped, or another job for this project no longer wants it):
 * an aborted run leaves the record's `verification` exactly where it found it, still "pending", so whoever
 * starts the next watcher (a reload, a focus event) resumes it.
 */
export async function verifyRecord(deps: VerifyDeps, record: Deployment, signal?: AbortSignal): Promise<void> {
  if (!sourcifyServes(record.chainId)) {
    return fail(deps, record, `Sourcify doesn't verify contracts on ${unverifiableChainName(record.chainId)}.`);
  }
  if (signal?.aborted) return;
  const base = deps.baseUrl ?? SOURCIFY_BASE;
  const build = await deps.proxyBuild(record.chainId, record.path);
  if (signal?.aborted) return;
  if (!build.ok) return fail(deps, record, build.error);
  const submitted = await submitToSourcify(deps.fetchImpl, base, record.chainId, record.address, {
    stdJsonInput: build.value.stdJsonInput,
    compilerVersion: build.value.compilerVersion,
    contractIdentifier: CONTRACT_IDENTIFIER,
    ...(record.tx ? { creationTransactionHash: record.tx } : {}),
  });
  if (signal?.aborted) return;
  if (!submitted.ok) return fail(deps, record, submitted.error);
  const startedAt = deps.clock.now();
  for (let attempt = 0; ; attempt += 1) {
    if (signal?.aborted) return;
    const verdict = await pollSourcify(deps.fetchImpl, base, submitted.value);
    if (signal?.aborted) return;
    if (!verdict.ok) return fail(deps, record, verdict.error);
    if (verdict.value.kind === "verified") return settle(deps, record, verdict.value.match, verifiedLine(verdict.value.match));
    if (verdict.value.kind === "failed") return fail(deps, record, verdict.value.reason);
    if (deps.clock.now() - startedAt >= POLL_TIMEOUT_MS) {
      return fail(deps, record, "Sourcify didn't finish in time.");
    }
    const delay = POLL_INTERVALS_MS[Math.min(attempt, POLL_INTERVALS_MS.length - 1)] ?? 21_000;
    await wait(deps, delay, signal);
  }
}

/** Whether the record is still there and still `confirmed`: an outcome for one that moved on is dropped unsaid. */
async function stillConfirmed(deps: VerifyDeps, target: Pick<Deployment, "projectId" | "chainId" | "address">): Promise<boolean> {
  try {
    return (await deps.records.list(target.projectId)).some((d) => recordKey(d) === recordKey(target) && d.status === "confirmed");
  } catch {
    return false;
  }
}

async function etherscanJob(deps: VerifyDeps, record: Deployment, key: string, signal?: AbortSignal): Promise<void> {
  const settle = async (): Promise<void> => {
    if (!(await stillConfirmed(deps, record))) return;
    etherscanOutcomes.set(record, { outcome: "verified" });
    log(etherscanVerifiedLine());
  };
  const fail = async (failure: { reason: string; keyed?: boolean; transient?: true }): Promise<void> => {
    if (!(await stillConfirmed(deps, record))) return;
    // Every reason is fixed copy or already scrubbed by the client; this is the last gate before it's kept and said.
    const reason = scrub(failure.reason, key);
    etherscanOutcomes.set(record, {
      outcome: "failed", reason, keyed: failure.keyed === true, ...(failure.transient ? { transient: true } : {}),
    });
    log(couldntVerifyOnEtherscanLine(reason));
  };

  const build = await deps.proxyBuild(record.chainId, record.path);
  if (signal?.aborted) return;
  // Not Etherscan's answer: the build didn't load (offline, the catalog not ready), so it's worth another try unasked.
  if (!build.ok) return fail({ reason: build.error, transient: true });
  const compilerVersion = etherscanCompilerVersion(build.value.compilerVersion);
  if (compilerVersion === null) return fail({ reason: "This catalog doesn't carry the full compiler version Etherscan needs." });
  const base = deps.etherscanBaseUrl ?? ETHERSCAN_BASE;
  const startedAt = deps.clock.now();
  const timedOut = (): boolean => deps.clock.now() - startedAt >= POLL_TIMEOUT_MS;
  let waits = 0;
  const pause = (): Promise<void> => {
    const delay = ETHERSCAN_INTERVALS_MS[Math.min(waits, ETHERSCAN_INTERVALS_MS.length - 1)] ?? 30_000;
    waits += 1;
    return wait(deps, delay, signal);
  };

  let guid: string;
  for (;;) {
    const submitted = await submitToEtherscan(deps.fetchImpl, base, key, record.chainId, record.address, {
      stdJsonInput: build.value.stdJsonInput,
      compilerVersion,
      contractName: CONTRACT_IDENTIFIER,
    });
    if (signal?.aborted) return;
    if (submitted.kind === "verified") return settle();
    if (submitted.kind === "failed") return fail(submitted);
    if (submitted.kind === "queued") {
      guid = submitted.guid;
      break;
    }
    if (timedOut()) return fail({ reason: "Etherscan hasn't indexed this contract yet. Retry in a minute." });
    await pause();
    if (signal?.aborted) return;
  }
  for (;;) {
    await pause();
    if (signal?.aborted) return;
    const verdict = await pollEtherscan(deps.fetchImpl, base, key, record.chainId, guid);
    if (signal?.aborted) return;
    if (verdict.kind === "verified") return settle();
    if (verdict.kind === "failed") return fail(verdict);
    if (timedOut()) return fail({ reason: "Etherscan didn't finish in time." });
  }
}

/**
 * Etherscan's leg for one record: submits the same standard JSON Sourcify gets, polls the GUID to a terminal
 * outcome and keeps it in `etherscanOutcomes`. Never throws, whatever the job hits. Never calls `fetchImpl` for a
 * chain Etherscan doesn't serve (Anvil, HSKChain Testnet, Hedera Testnet), or once `signal` aborts: an aborted run
 * keeps no outcome, so the next watcher starts it again. A failure that wasn't Etherscan's answer (the request never
 * got there, the proxy's build didn't load) is kept as `transient`, which the watcher drops when it starts and when
 * the browser comes back online. `key` goes to Etherscan's API and nowhere else.
 */
export async function verifyOnEtherscan(deps: VerifyDeps, record: Deployment, key: string, signal?: AbortSignal): Promise<void> {
  if (!etherscanServes(record.chainId) || signal?.aborted) return;
  try {
    await etherscanJob(deps, record, key, signal);
  } catch {
    // Fixed words: whatever was thrown might quote a request.
    try {
      if (!(await stillConfirmed(deps, record))) return;
      const reason = "Etherscan verification stopped unexpectedly.";
      etherscanOutcomes.set(record, { outcome: "failed", reason, keyed: false });
      log(couldntVerifyOnEtherscanLine(reason));
    } catch {
      // Nothing left to say it with.
    }
  }
}

async function sourcifyIfNeeded(deps: VerifyDeps, record: Deployment, signal?: AbortSignal): Promise<void> {
  if (record.verification !== "pending") return;
  const key = legKey(record, "sourcify");
  if (inFlight.has(key)) return;
  inFlight.add(key);
  try {
    await verifyRecord(deps, record, signal);
  } finally {
    inFlight.delete(key);
  }
}

async function etherscanIfNeeded(deps: VerifyDeps, record: Deployment, signal?: AbortSignal): Promise<void> {
  const leg = legKey(record, "etherscan");
  if (inFlight.has(leg)) return;
  inFlight.add(leg);
  try {
    for (;;) {
      const key = deps.etherscanKey();
      if (key === undefined || etherscanOutcomes.get(record) !== undefined) return;
      await verifyOnEtherscan(deps, record, key, signal);
      if (signal?.aborted || deps.etherscanKey() === key) return;
      // The key changed while this job ran: a failure the old key caused says nothing about the new one.
      const outcome = etherscanOutcomes.get(record);
      if (outcome?.outcome !== "failed" || !outcome.keyed) return;
      etherscanOutcomes.clear(record);
    }
  } finally {
    inFlight.delete(leg);
  }
}

/**
 * Runs whichever legs the record still needs, skipping one whose job is already running: Sourcify's while
 * `verification` is "pending", Etherscan's while there's a key and no outcome yet. Each leg settles on its own.
 */
export async function verifyIfNeeded(deps: VerifyDeps, record: Deployment, signal?: AbortSignal): Promise<void> {
  const [sourcify] = await Promise.allSettled([sourcifyIfNeeded(deps, record, signal), etherscanIfNeeded(deps, record, signal)]);
  if (sourcify.status === "rejected") throw sourcify.reason;
}

/** @internal Tests: whether a job for this record is running now. */
export function verifyingNow(target: Pick<Deployment, "chainId" | "address">, leg: Leg = "sourcify"): boolean {
  return inFlight.has(legKey(target, leg));
}

/**
 * Retry verification (contracts §5.3 `deploy.retryVerification`): reopens whichever verifier failed for another
 * job. Sourcify's and Etherscan's are decided separately, and it refuses only when neither has anything to do.
 */
export async function retryVerification(target: { chainId: number; address: Address }, deps: VerifyDeps = appVerifyDeps()): Promise<void> {
  const found = (await deps.records.list(deps.projectId())).find((d) => d.chainId === target.chainId && sameAddress(d.address, target.address));
  // Plain refusals (contracts §5.3): a "Verify" line, like the deploy machine's own "Deploy" notes, so the
  // console decides whether to announce it (the deployAnnouncements setting), rather than this module deciding.
  if (!found) {
    log({ tag: "Verify", text: "Couldn't find that deployment record to retry." });
    return;
  }
  if (found.status !== "confirmed") {
    log({ tag: "Verify", text: "Only a confirmed deployment can be verified." });
    return;
  }
  // Only a settled failure is retried: a "pending" record is already verifying (or already resumed the
  // watcher's own job), and a matched one is already verified. Neither the deploy machine's own phase ("live"
  // for either) nor a second job on the same record would follow taking this back to "pending".
  const retrySourcify = found.verification === "failed";
  const outcome = etherscanOutcomes.get(found);
  const etherscanRunning = inFlight.has(legKey(found, "etherscan"));
  const etherscanOpen = etherscanServes(found.chainId) && outcome?.outcome !== "verified" && !etherscanRunning;
  const retryEtherscan = etherscanOpen && deps.etherscanKey() !== undefined;
  if (!retrySourcify && !retryEtherscan) {
    let text = "This deployment is already verified.";
    if (found.verification === "pending" || etherscanRunning) text = "This deployment is already being verified.";
    else if (etherscanOpen && outcome !== undefined) text = ETHERSCAN_NOT_SET_UP;
    log({ tag: "Verify", text });
    return;
  }
  let next = found;
  if (retrySourcify) {
    const { verificationReason: _staleReason, ...rest } = found;
    next = { ...rest, verification: "pending" };
    try {
      await deps.records.put(next);
    } catch (error) {
      log({ tag: "Verify", text: `Couldn't start verification again: ${error instanceof Error ? error.message : String(error)}` });
      return;
    }
  }
  if (retryEtherscan) etherscanOutcomes.clear(found);
  void verifyIfNeeded(deps, next);
}
