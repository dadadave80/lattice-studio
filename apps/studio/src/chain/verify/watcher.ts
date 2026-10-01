/**
 * The background watcher (spec Flow 12 step 8): verifies every confirmed record of the open project whose
 * `verification` is still "pending" and, once there's an Etherscan API key, every one Etherscan hasn't answered
 * for yet (so a key added later picks up diamonds already deployed), and follows the project as it changes.
 * It waits for the catalog (the proxy's build is read from it), and gives what Etherscan never answered (offline)
 * another try when it starts and when the browser comes back online.
 * Mirrors S8c's `tracking.ts` (light, own chunk); `services.ts` starts it right after startup. A record imported From file has never been submitted
 * from here (it carries no creation transaction of ours to trust yet), so it's left alone until S8c's own re-read
 * clears the flag on a confirmed match.
 */
import type { Deployment } from "@lattice-studio/core";
import { doc, getCatalogStatus, listDeployments, settings, subscribeCatalog, subscribeDeployments } from "@/contracts";
import { appVerifyDeps } from "./app-deps";
import { etherscanServes } from "./chains";
import { verifyIfNeeded } from "./engine";
import { etherscanOutcomes } from "./etherscan-outcomes";
import type { VerifyDeps } from "./ports";

/** Still pending on Sourcify, or, with an Etherscan key, not yet tried there: the engine runs only the leg that's due. */
function eligible(records: readonly Deployment[], etherscanSetUp: boolean): Deployment[] {
  return records.filter(
    (d) =>
      d.status === "confirmed" &&
      d.fromFile !== true &&
      (d.verification === "pending" || (etherscanSetUp && etherscanServes(d.chainId) && etherscanOutcomes.get(d) === undefined)),
  );
}

/**
 * Starts watching the open project's records. Returns a disposer that also aborts every job this watcher
 * started: without it, a job already inside its poll loop (up to five minutes of backoff) would keep calling
 * `fetchImpl` after the watcher that started it was told to stop.
 */
export function startVerifying(deps: VerifyDeps = appVerifyDeps()): () => void {
  let stopped = false;
  const abort = new AbortController();
  const check = (projectId: string): void => {
    // The catalog is still loading: a job now would fail on the proxy's build. `stopCatalog` checks again.
    if (stopped || getCatalogStatus().status === "loading") return;
    listDeployments(projectId).then(
      (records) => {
        if (stopped || projectId !== doc.get().id) return;
        for (const record of eligible(records, deps.etherscanKey() !== undefined)) void verifyIfNeeded(deps, record, abort.signal);
      },
      () => {},
    );
  };
  const stopDoc = doc.subscribe((state, previous) => {
    if (state.project.id !== previous.project.id) check(state.project.id);
  });
  const stopRecords = subscribeDeployments((projectId) => {
    if (projectId === doc.get().id) check(projectId);
  });
  // A new Etherscan key (typed in Settings, committed whole): what the old one failed at is worth another try,
  // and records it never reached get their first.
  const stopSettings = settings.subscribe((state, previous) => {
    if (state.etherscanApiKey === previous.etherscanApiKey) return;
    etherscanOutcomes.clearKeyed();
    check(doc.get().id);
  });
  const stopCatalog = subscribeCatalog(() => check(doc.get().id));
  const retryUnanswered = (): void => {
    etherscanOutcomes.clearTransient();
    check(doc.get().id);
  };
  if (typeof window !== "undefined") window.addEventListener("online", retryUnanswered);
  queueMicrotask(retryUnanswered);
  return () => {
    stopped = true;
    abort.abort();
    stopDoc();
    stopRecords();
    stopSettings();
    stopCatalog();
    if (typeof window !== "undefined") window.removeEventListener("online", retryUnanswered);
  };
}
