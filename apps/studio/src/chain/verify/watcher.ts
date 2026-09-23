/**
 * The background watcher (spec Flow 12 step 8): verifies every confirmed record of the open project whose
 * `verification` is still "pending", and follows the project as it changes. Mirrors S8c's `tracking.ts` (light,
 * own chunk); `services.ts` starts it right after startup. A record imported From file has never been submitted
 * from here (it carries no creation transaction of ours to trust yet), so it's left alone until S8c's own re-read
 * clears the flag on a confirmed match.
 */
import type { Deployment } from "@lattice-studio/core";
import { doc, listDeployments, subscribeDeployments } from "@/contracts";
import { appVerifyDeps } from "./app-deps";
import { verifyIfNeeded } from "./engine";
import type { VerifyDeps } from "./ports";

function eligible(records: readonly Deployment[]): Deployment[] {
  return records.filter((d) => d.status === "confirmed" && d.verification === "pending" && d.fromFile !== true);
}

/** Starts watching the open project's records. Returns a disposer. */
export function startVerifying(deps: VerifyDeps = appVerifyDeps()): () => void {
  let stopped = false;
  const check = (projectId: string): void => {
    if (stopped) return;
    listDeployments(projectId).then(
      (records) => {
        if (stopped || projectId !== doc.get().id) return;
        for (const record of eligible(records)) void verifyIfNeeded(deps, record);
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
  queueMicrotask(() => check(doc.get().id));
  return () => {
    stopped = true;
    stopDoc();
    stopRecords();
  };
}
