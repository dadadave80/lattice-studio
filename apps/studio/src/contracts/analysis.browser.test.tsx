import type { AnalyzeFn } from "@lattice-studio/core";
import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { onCleanup, renderWithStudio } from "../../test/harness";
import { emptyAnalysis, getAnalysis, provideAnalysis, useAnalysis } from "./analysis";
import { createFallbackAnalysisProvider } from "./analysis-fallback";
import { getCatalog, subscribeCatalog } from "./catalog";
import { doc } from "./stores";

function pendingFallback() {
  let finish!: (analyze: AnalyzeFn) => void;
  const pending = new Promise<AnalyzeFn>((resolve) => { finish = resolve; });
  const provider = createFallbackAnalysisProvider({
    empty: emptyAnalysis(), recipe: () => doc.get().recipe, catalog: getCatalog,
    subscribeRecipe: (listener) => doc.subscribe((state, previous) => { if (state.project.recipe !== previous.project.recipe) listener(); }),
    subscribeCatalog, load: () => pending,
  });
  onCleanup(provideAnalysis(provider));
  return { finish };
}
function Hash() { return <output>{useAnalysis((analysis) => analysis.recipeHash)}</output>; }

test("a mounted fallback starts empty and updates to its cached warm analysis", async () => {
  const fallback = pendingFallback();
  await renderWithStudio(<Hash />);
  await expect.element(page.getByText("0x", { exact: true })).toBeVisible();
  let computations = 0;
  const value = { ...emptyAnalysis(), recipeHash: "0x01" as const };
  fallback.finish(() => { computations++; return value; });
  await expect.element(page.getByText("0x01", { exact: true })).toBeVisible();
  expect(getAnalysis()).toBe(value);
  expect(getAnalysis()).toBe(value);
  expect(computations).toBe(1);
});

test("a late fallback import cannot replace S1 and its warm value survives provider disposal", async () => {
  const fallback = pendingFallback();
  await renderWithStudio(<Hash />);
  await expect.element(page.getByText("0x", { exact: true })).toBeVisible();
  const live = { ...emptyAnalysis(), recipeHash: "0x02" as const };
  const restore = provideAnalysis({ getAnalysis: () => live, subscribe: () => () => {} });
  onCleanup(restore);
  await expect.element(page.getByText("0x02", { exact: true })).toBeVisible();
  const warm = { ...emptyAnalysis(), recipeHash: "0x03" as const };
  fallback.finish(() => warm);
  await expect.poll(() => getAnalysis()).toBe(live);
  restore();
  await expect.element(page.getByText("0x03", { exact: true })).toBeVisible();
  expect(getAnalysis()).toBe(warm);
});

test("disposing S1 during an import reconnects the fallback until its analysis arrives", async () => {
  const fallback = pendingFallback();
  await renderWithStudio(<Hash />);
  const live = { ...emptyAnalysis(), recipeHash: "0x04" as const };
  const restore = provideAnalysis({ getAnalysis: () => live, subscribe: () => () => {} });
  onCleanup(restore);
  await expect.element(page.getByText("0x04", { exact: true })).toBeVisible();
  restore();
  await expect.element(page.getByText("0x", { exact: true })).toBeVisible();
  fallback.finish(() => ({ ...emptyAnalysis(), recipeHash: "0x05" }));
  await expect.element(page.getByText("0x05", { exact: true })).toBeVisible();
});
