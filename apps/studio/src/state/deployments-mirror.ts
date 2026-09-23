/**
 * The open project's deployment records, read synchronously for the analysis context (AUTH-02's `known`,
 * spec L333). Records live in their own store (contracts §5.2 "deployments"); this reads them when the open
 * project changes and again after every write to its records. Nothing is read until `start()`, so module
 * evaluation never opens IndexedDB.
 */
import type { Deployment } from "@lattice-studio/core";
import { doc, listDeployments, subscribeDeployments } from "@/contracts";

export type DeploymentsMirror = {
  /** The open project's records as last read; empty until the first read returns. */
  list(): readonly Deployment[];
  subscribe(listener: () => void): () => void;
  start(): () => void;
};

const NONE: readonly Deployment[] = Object.freeze([]);

export function createDeploymentsMirror(): DeploymentsMirror {
  let projectId: string | null = null;
  let records: readonly Deployment[] = NONE;
  /** Bumped per read, so a slow read for an earlier project never lands after a later one. */
  let generation = 0;
  let started = false;
  const listeners = new Set<() => void>();
  const stops: (() => void)[] = [];

  const emit = (): void => {
    for (const listener of Array.from(listeners)) listener();
  };

  const read = (id: string): void => {
    generation += 1;
    const mine = generation;
    listDeployments(id).then(
      (list) => {
        if (!started || mine !== generation || id !== projectId) return;
        records = list;
        emit();
      },
      () => {
        if (!started || mine !== generation || id !== projectId) return;
        records = NONE;
        emit();
      },
    );
  };

  const follow = (id: string): void => {
    if (id === projectId) return;
    projectId = id;
    if (records.length > 0) {
      records = NONE;
      emit();
    }
    read(id);
  };

  return {
    list: () => records,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      if (started) return () => {};
      started = true;
      stops.push(
        doc.subscribe((state) => follow(state.project.id)),
        subscribeDeployments((changed) => {
          if (changed === projectId) read(changed);
        }),
      );
      // Only once a project has loaded: never a read at module evaluation (contracts/discover.ts).
      if (doc.state().lastChange !== null) follow(doc.get().id);
      return () => {
        started = false;
        projectId = null;
        records = NONE;
        for (const stop of stops.splice(0)) stop();
      };
    },
  };
}
