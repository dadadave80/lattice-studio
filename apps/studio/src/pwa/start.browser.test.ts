import { describe, expect, test } from "vitest";
import type { CatalogStatus } from "@/contracts";
import { createConnection } from "./connection";
import { afterCatalogLine, serviceWorkerUrl, startPwa, type CatalogFeed } from "./start";
import { pwaState } from "./state";

describe("startPwa", () => {
  test("the worker and its scope sit under the base: / on Vercel, ./ on IPFS", () => {
    expect(serviceWorkerUrl("/")).toEqual({ url: "/sw.js", scope: "/" });
    expect(serviceWorkerUrl("./")).toEqual({ url: "./sw.js", scope: "./" });
  });

  test("registers nothing outside a production build", () => {
    const connection = createConnection({
      target: new EventTarget(),
      onLine: () => true,
      probe: async () => true,
      setTimeout: () => 0,
      clearTimeout: () => {},
    });
    const stop = startPwa(connection);
    expect(pwaState.updates()).toBeNull();
    stop();
  });
});

/** A catalog status store that, like the loader, logs its line right after it publishes "ready". */
function fakeCatalog(lines: string[]): CatalogFeed & { settle: (status: CatalogStatus) => void } {
  let status: CatalogStatus = { status: "loading" };
  const listeners = new Set<(status: CatalogStatus) => void>();
  return {
    get: () => status,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    settle: (next) => {
      status = next;
      for (const listener of Array.from(listeners)) listener(next);
      if (next.status === "ready") lines.push("Catalog: Lattice 0.4.0 · 100 facets.");
    },
  };
}

const READY = { status: "ready", id: "test", catalog: {}, manifest: null } as unknown as CatalogStatus;

describe("the offline note waits for the catalog line (spec L401)", () => {
  test("a note raised while the catalog loads is logged after the catalog line", async () => {
    const lines: string[] = [];
    const catalog = fakeCatalog(lines);
    afterCatalogLine(() => lines.push("Studio can't work offline in this browser"), catalog);
    await Promise.resolve();
    expect(lines).toEqual([]);
    catalog.settle(READY);
    await Promise.resolve();
    expect(lines).toEqual(["Catalog: Lattice 0.4.0 · 100 facets.", "Studio can't work offline in this browser"]);
  });

  test("a catalog that failed still lets the note through", async () => {
    const lines: string[] = [];
    const catalog = fakeCatalog(lines);
    afterCatalogLine(() => lines.push("note"), catalog);
    catalog.settle({ status: "error", reason: "offline" });
    await Promise.resolve();
    expect(lines).toEqual(["note"]);
  });

  test("once the catalog has settled, the note is logged at once", () => {
    const lines: string[] = [];
    const catalog = fakeCatalog(lines);
    catalog.settle(READY);
    afterCatalogLine(() => lines.push("note"), catalog);
    expect(lines).toEqual(["Catalog: Lattice 0.4.0 · 100 facets.", "note"]);
  });

  test("stopping the PWA drops a note still waiting", async () => {
    const lines: string[] = [];
    const catalog = fakeCatalog(lines);
    const stop = afterCatalogLine(() => lines.push("note"), catalog);
    stop();
    catalog.settle(READY);
    await Promise.resolve();
    expect(lines).toEqual(["Catalog: Lattice 0.4.0 · 100 facets."]);
  });
});
