/**
 * A new project starts with the zero placeholder as its catalog hash (K2's untitled project, S7b's New). As soon
 * as a catalog is loaded, the open project is pinned to it (spec L290: a project opens against the catalog it
 * names), so nothing is saved as if it named a catalog it doesn't. A read-only tab leaves it to the tab that
 * edits.
 */
import { doc, getCatalog, session, subscribeCatalog } from "@/contracts";
import { isUnpinned, type HistoryDocumentStore } from "./document-store";

export function startPinning(document: HistoryDocumentStore): () => void {
  let queued = false;
  let stopped = false;
  const pin = (): void => {
    queued = false;
    const catalog = getCatalog();
    if (stopped || !catalog || session.get().readOnly !== null) return;
    document.pinCatalog({ tag: catalog.lattice.tag, hash: catalog.hash });
  };
  // A microtask later: never a document write from inside another store's listener.
  const check = (): void => {
    if (queued || !isUnpinned(doc.get().recipe) || !getCatalog()) return;
    queued = true;
    queueMicrotask(pin);
  };
  const stops = [
    doc.subscribe(check),
    subscribeCatalog(check),
    session.subscribe((state, previous) => {
      if (state.readOnly !== previous.readOnly) check();
    }),
  ];
  check();
  return () => {
    stopped = true;
    for (const stop of stops) stop();
  };
}
