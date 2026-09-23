import { describe, expect, test, vi } from "vitest";
import type { Result } from "@lattice-studio/core";
import { warmShards, type WarmDeps } from "./warm";

function setup(options: { controlled?: boolean; catalog?: string | null; fail?: string[] } = {}) {
  let facets: string[] = [];
  let catalog = options.catalog === undefined ? "v0.4.0" : options.catalog;
  let controlled = options.controlled ?? true;
  const fail = new Set(options.fail ?? []);
  const docListeners = new Set<() => void>();
  const catalogListeners = new Set<() => void>();
  const controlListeners = new Set<() => void>();
  const load = vi.fn(async (name: string): Promise<Result<unknown, string>> =>
    fail.has(name) ? { ok: false, error: "Failed to fetch" } : { ok: true, value: {} },
  );
  const reportFailure = vi.fn();
  const listen = (set: Set<() => void>) => (fn: () => void) => {
    set.add(fn);
    return () => void set.delete(fn);
  };
  const deps: WarmDeps = {
    facets: () => facets,
    subscribeDocument: listen(docListeners),
    catalogId: () => catalog,
    subscribeCatalog: listen(catalogListeners),
    load,
    controlled: () => controlled,
    subscribeControl: listen(controlListeners),
    reportFailure,
  };
  const emit = (set: Set<() => void>) => {
    for (const fn of Array.from(set)) fn();
  };
  return {
    load,
    reportFailure,
    stop: warmShards(deps),
    place(...names: string[]) {
      facets = [...facets, ...names];
      emit(docListeners);
    },
    edit: () => emit(docListeners),
    setCatalog(id: string | null) {
      catalog = id;
      emit(catalogListeners);
    },
    control() {
      controlled = true;
      emit(controlListeners);
    },
    fail,
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("warmShards", () => {
  test("requests the shard of each facet placed, once", () => {
    const s = setup();
    s.place("ERC20", "Ownable");
    s.edit();
    s.place("ERC4626");
    expect(s.load.mock.calls.map(([name]) => name)).toEqual(["ERC20", "Ownable", "ERC4626"]);
  });

  test("warms again for another catalog, and not before one is ready", () => {
    const s = setup({ catalog: null });
    s.place("ERC20");
    expect(s.load).not.toHaveBeenCalled();
    s.setCatalog("v0.4.0");
    s.setCatalog("v0.4.1");
    expect(s.load).toHaveBeenCalledTimes(2);
  });

  test("waits until a service worker controls the page", () => {
    const s = setup({ controlled: false });
    s.place("ERC20");
    expect(s.load).not.toHaveBeenCalled();
    s.control();
    expect(s.load).toHaveBeenCalledTimes(1);
  });

  test("edits that keep the facet set request nothing (a drag is sixty edits a second)", () => {
    const s = setup();
    s.place("ERC20");
    for (let i = 0; i < 60; i += 1) s.edit();
    expect(s.load).toHaveBeenCalledTimes(1);
  });

  test("a failed shard asks the connection to probe and is tried again when the set changes", async () => {
    const s = setup({ fail: ["ERC20"] });
    s.place("ERC20");
    await settle();
    expect(s.reportFailure).toHaveBeenCalledTimes(1);
    s.fail.clear();
    s.place("Ownable");
    expect(s.load.mock.calls.map(([name]) => name)).toEqual(["ERC20", "ERC20", "Ownable"]);
  });

  test("stops when disposed", () => {
    const s = setup();
    s.stop();
    s.place("ERC20");
    expect(s.load).not.toHaveBeenCalled();
  });
});
