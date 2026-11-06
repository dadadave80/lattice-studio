import { expect, test } from "bun:test";
import type { Analysis, AnalyzeFn, Catalog } from "@lattice-studio/core";
import { NotImplemented } from "@lattice-studio/core";
import { makeCatalog, makeRecipe } from "@lattice-studio/core/testing";
import { createFallbackAnalysisProvider } from "./analysis-fallback";

const empty: Analysis = { recipeHash: "0x", routing: {}, problems: [], plan: [], init: null, stats: { facets: 0, routed: 0, exported: 0, excluded: 0, namespaces: 0 } };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(load: () => Promise<AnalyzeFn>) {
  let recipe = makeRecipe();
  let catalog: Catalog | null = makeCatalog();
  const changes = new Set<() => void>();
  const subscribe = (listener: () => void) => { changes.add(listener); return () => { changes.delete(listener); }; };
  const provider = createFallbackAnalysisProvider({ empty, recipe: () => recipe, catalog: () => catalog, subscribeRecipe: subscribe, subscribeCatalog: subscribe, load });
  return { provider, setRecipe() { recipe = { ...recipe, name: "Edited" }; for (const listener of changes) listener(); }, setCatalog(next: Catalog | null) { catalog = next; for (const listener of changes) listener(); } };
}

test("cold reads stay stable, share one import, and notify subscribers when analysis becomes available", async () => {
  const pending = deferred<AnalyzeFn>(); let loads = 0; let computations = 0;
  const value = { ...empty, recipeHash: "0x01" as const };
  const { provider } = fixture(() => { loads++; return pending.promise; });
  let notifications = 0;
  const stop = provider.subscribe(() => { notifications++; });
  expect(provider.getAnalysis()).toBe(empty);
  expect(provider.getAnalysis()).toBe(empty);
  await Bun.sleep(0);
  expect(loads).toBe(1);
  pending.resolve(() => { computations++; return value; });
  await Bun.sleep(0);
  expect(notifications).toBe(1);
  expect(provider.getAnalysis()).toBe(value);
  expect(provider.getAnalysis()).toBe(value);
  expect(computations).toBe(1);
  stop();
});

test("the resolved analyzer uses current inputs and recomputes only after recipe/catalog changes", async () => {
  const pending = deferred<AnalyzeFn>(); const seen: unknown[] = [];
  const state = fixture(() => pending.promise);
  expect(state.provider.getAnalysis()).toBe(empty);
  state.setRecipe();
  pending.resolve((...args) => { seen.push(args); return { ...empty }; });
  await Bun.sleep(0);
  const first = state.provider.getAnalysis();
  expect(state.provider.getAnalysis()).toBe(first);
  expect((seen[0] as unknown[])[0]).toMatchObject({ name: "Edited" });
  state.setCatalog(makeCatalog());
  expect(state.provider.getAnalysis()).not.toBe(first);
  expect(seen).toHaveLength(2);
  state.setCatalog(null);
  expect(state.provider.getAnalysis()).toBe(empty);
});

test("unsubscribed consumers cannot receive a late completion", async () => {
  const pending = deferred<AnalyzeFn>(); const { provider } = fixture(() => pending.promise);
  let notifications = 0; const stop = provider.subscribe(() => { notifications++; });
  provider.getAnalysis(); stop();
  pending.resolve(() => empty);
  await Bun.sleep(0);
  expect(notifications).toBe(0);
  expect(provider.getAnalysis()).toBe(empty);
});

test("failed imports stay empty without an automatic retry loop, then retry on a later read", async () => {
  let loads = 0; let notifications = 0;
  const value = { ...empty, recipeHash: "0x02" as const };
  const { provider } = fixture(async () => { if (++loads === 1) throw new Error("Chunk unavailable"); return () => value; });
  const stop = provider.subscribe(() => { notifications++; });
  expect(provider.getAnalysis()).toBe(empty);
  await Bun.sleep(0);
  expect(loads).toBe(1); expect(notifications).toBe(0);
  expect(provider.getAnalysis()).toBe(empty);
  await Bun.sleep(0);
  expect(provider.getAnalysis()).toBe(value);
  expect(loads).toBe(2); expect(notifications).toBe(1);
  stop();
});

test("missing catalogs do not import; programmer errors still throw and NotImplemented stays empty", async () => {
  let loads = 0; let failure: Error = new NotImplemented("C2", "analyze");
  const state = fixture(async () => { loads++; return () => { throw failure; }; });
  state.setCatalog(null);
  expect(state.provider.getAnalysis()).toBe(empty);
  await Bun.sleep(0); expect(loads).toBe(0);
  state.setCatalog(makeCatalog()); state.provider.getAnalysis();
  await Bun.sleep(0);
  expect(state.provider.getAnalysis()).toBe(empty);
  failure = new Error("Invalid internal analysis"); state.setRecipe();
  expect(() => state.provider.getAnalysis()).toThrow("Invalid internal analysis");
});
