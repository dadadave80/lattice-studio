/**
 * S8c's registrations (contracts §5.2 "deploy"): the deploy controller's loader (its own chunk), the missing-contracts
 * sub-step dialog (its own chunk), and a light watcher that loads the controller as soon as the open project has a
 * record to resume or re-read (a pending transaction, a Safe proposal, a From file record), so tracking resumes after
 * a reload without anyone opening the review (spec L558), and the divergence watch that says when an edit leaves what's
 * live (spec L728, `diverged.ts`). Under Vitest both stay off: tests start them.
 * Light: nothing here opens IndexedDB at module evaluation or imports the chain module.
 */
import type { Deployment } from "@lattice-studio/core";
import { deployController, doc, env, listDeployments, provideDeployController, registerDialog, subscribeDeployments } from "@/contracts";
import { startDivergenceWatch } from "./diverged";
import { MissingContractsDialogChunk } from "./MissingContractsDialogChunk";

provideDeployController(() => import("./controller").then((m) => m.loadController()));

registerDialog("missing-contracts", MissingContractsDialogChunk);

/** A record the controller has work for: tracking to resume, a proposal to re-check, a file record to re-read. */
export function needsController(records: readonly Deployment[]): boolean {
  return records.some((d) => (d.fromFile === true && d.status !== "failed") || d.status === "proposed" || (d.status === "pending" && d.tx !== undefined));
}

/**
 * Loads the controller once the open project has a record it has work for. Returns a disposer. The controller then
 * follows the project, its records and window focus itself.
 */
export function startDeployTracking(): () => void {
  let loaded = false;
  let stopped = false;
  const check = (projectId: string): void => {
    if (loaded || stopped) return;
    listDeployments(projectId).then(
      (records) => {
        if (loaded || stopped || !needsController(records)) return;
        loaded = true;
        deployController().catch((error: unknown) => console.error(error));
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

if (!env.test) {
  startDeployTracking();
  startDivergenceWatch();
}
