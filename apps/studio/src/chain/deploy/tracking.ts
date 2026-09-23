/**
 * The light watcher that loads the deploy controller as soon as the open project has a record to resume or re-read
 * (a pending transaction, a Safe proposal, a From file record), so tracking resumes after a reload without anyone
 * opening the review (spec L558). `services.ts` starts it, with the divergence watch, right after startup; it's its
 * own small chunk so the first load doesn't carry it.
 */
import type { Deployment } from "@lattice-studio/core";
import { deployController, doc, listDeployments, subscribeDeployments } from "@/contracts";
import { startDivergenceWatch } from "./diverged";

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

/** Both watchers: resume tracking, and say when an edit leaves what's live (spec L728). */
export function startWatching(): () => void {
  const stops = [startDeployTracking(), startDivergenceWatch()];
  return () => {
    for (const stop of stops) stop();
  };
}
