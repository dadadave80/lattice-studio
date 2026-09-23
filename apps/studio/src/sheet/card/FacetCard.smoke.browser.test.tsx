/**
 * 30 cards (brief S4a "fast at 30 cards"; spec L823-L825): every card renders with its rows and handles, the
 * first render stays under budget, and a pin edit re-renders only what it touches, so its commit is a small
 * fraction of the mount.
 */
import { Profiler, type ProfilerOnRenderCallback } from "react";
import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { doc } from "@/contracts";
import { fixtureCatalog, renderWithStudio } from "../../../test/harness";
import { CardSheet } from "./testing/CardSheet";
import { cardProject } from "./testing/projects";

/** Generous for a dev build in headless Chromium; the real budget is Q4's perf suite on a production build. */
const MOUNT_BUDGET_MS = 1500;

test("30 cards render under budget, and a pin edit re-renders a fraction of the sheet", async () => {
  const catalog = fixtureCatalog();
  const facets = catalog.facets.slice(0, 30).map((f) => f.name);
  const commits: { phase: string; ms: number }[] = [];
  const onRender: ProfilerOnRenderCallback = (_id, phase, actualDuration) => {
    commits.push({ phase, ms: actualDuration });
  };
  const started = performance.now();
  await renderWithStudio(
    <Profiler id="sheet" onRender={onRender}>
      <CardSheet />
    </Profiler>,
    { project: cardProject(catalog, facets, { columns: 6, rowPitch: 256 }) },
  );
  await expect.poll(() => document.querySelectorAll("[data-facet]").length).toBe(30);
  const visible = performance.now() - started;

  for (const name of facets) {
    await expect.element(page.getByRole("group", { name: new RegExp(`^${name}, `) })).toBeInTheDocument();
  }
  expect(document.querySelectorAll("[data-facet] [data-selector]").length).toBeGreaterThan(150);
  expect(document.querySelectorAll("[data-facet] .react-flow__handle").length).toBeGreaterThan(300);
  const mount = commits.reduce((sum, c) => sum + c.ms, 0);
  expect(visible).toBeLessThan(MOUNT_BUDGET_MS);

  // One pin on the first card (a selector no other card exports): only that card's words and rows change.
  commits.length = 0;
  const first = facets[0] ?? "";
  const facet = catalog.facets.find((f) => f.name === first);
  const own = facet?.selectors.find((s) => !catalog.facets.some((o) => o.name !== first && facets.includes(o.name) && o.selectors.some((x) => x.hex === s.hex)));
  if (!own) throw new Error(`${first} has no selector of its own.`);
  const pin = document.querySelector<HTMLElement>(`[data-facet="${first}"] [data-selector="${own.hex}"]`);
  if (!pin) throw new Error("No pin.");
  await userEvent.click(pin);
  await expect.poll(() => pin.dataset.state).toBe("excluded");
  expect(doc.get().recipe.exclude).toContain(own.hex);
  const update = commits.reduce((sum, c) => sum + c.ms, 0);
  expect(update).toBeLessThan(mount / 4);
});
