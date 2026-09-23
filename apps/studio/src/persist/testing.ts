/**
 * For browser tests (this module's and S7b's, S13's, S10's): a persistence instance on its own database,
 * provided as the app's persistence and services for one test, closed and deleted afterwards. Browser tests
 * otherwise run on K2's in-memory services (`services.ts`).
 *
 *   const store = testPersistence();          // this tab; follows the contracts' document
 *   const other = testPersistence({ dbName: store.dbName, doc: fakeDoc(project), provide: false });  // a second tab
 */
import type { Project } from "@lattice-studio/core";
import { deleteDB } from "idb";
import { provideServices, type DocumentChange, type DocumentState } from "@/contracts";
import { onCleanup } from "../../test/harness/cleanup";
import { deploymentsService, projectsService, providePersistence } from "./current";
import { createPersistence, type DocPort, type Persistence, type PersistenceOptions } from "./persistence";

let count = 0;

export type TestPersistenceOptions = PersistenceOptions & {
  /** Provide it as the app's persistence and the contracts' services. Default true. */
  provide?: boolean;
  /** Call `start()`. Default true. */
  start?: boolean;
};

export function testPersistence(options: TestPersistenceOptions = {}): Persistence {
  const { provide = true, start = true, ...rest } = options;
  count += 1;
  const dbName = rest.dbName ?? `lattice-studio-test-${count}-${crypto.randomUUID()}`;
  const instance = createPersistence({ ...rest, dbName });
  if (provide) {
    onCleanup(providePersistence(instance));
    onCleanup(provideServices({ projects: projectsService, deployments: deploymentsService }));
  }
  onCleanup(async () => {
    await instance.close();
    await deleteDB(dbName).catch(() => {});
  });
  if (start) instance.start();
  return instance;
}

/** A document store stand-in for a second tab: `load` replaces the project, `edit` changes it like an edit. */
export type FakeDoc = DocPort & { edit(label: string, change: (project: Project) => Project): void };

export function fakeDoc(project: Project): FakeDoc {
  let state: DocumentState = {
    project, canUndo: false, canRedo: false, undoLabel: null, redoLabel: null, lastChange: null,
  };
  let revision = 0;
  const listeners = new Set<(state: DocumentState, previous: DocumentState) => void>();
  const set = (next: Project, kind: DocumentChange["kind"], label: string) => {
    const previous = state;
    revision += 1;
    state = { ...state, project: next, lastChange: { kind, label, revision } };
    for (const listener of Array.from(listeners)) listener(state, previous);
  };
  return {
    get: () => state.project,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    load: (next, reason) => set(next, "load", reason ?? `Opened ${next.name}`),
    edit: (label, change) => set(change(state.project), "edit", label),
  };
}
