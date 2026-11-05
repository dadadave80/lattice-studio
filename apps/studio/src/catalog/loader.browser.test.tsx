/**
 * S14's loader against the real dev server: `seedStudio`'s default catalog is K3's fixture at `id: "fixture"`,
 * served at `/catalog/fixture/…`, exactly where the real loader (registered by `contracts/discover.ts`,
 * imported by the harness's `setup.ts`) reads it. `useFacetDetail` here exercises the whole path: fetch,
 * hash check, parse, cache.
 */
import { makeProject, makeRecipe } from "@lattice-studio/core/testing";
import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { useFacetDetail } from "@/contracts";
import { fixtureCatalog, onCleanup, renderWithStudio } from "../../test/harness";
import { createCatalogLoader } from "./loader";

for (const secondFails of [false, true]) {
  test(`detail retry is explicit and deduplicated (${secondFails ? "repeated failure" : "recovery"})`, async () => {
    const loader = createCatalogLoader();
    const original = globalThis.fetch.bind(globalThis);
    let requests = 0;
    let release: (() => void) | undefined;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (!String(input).includes("shards/AccessControl.json")) return original(input, init);
      requests += 1;
      if (requests === 1) return new Response("Unavailable", { status: 503 });
      await new Promise<void>((resolve) => { release = resolve; });
      if (secondFails && requests === 2) return new Response("Still unavailable", { status: 503 });
      return original(input, init);
    });
    onCleanup(() => fetchSpy.mockRestore());
    function Probe() {
      const detail = loader.useFacetDetail("AccessControl");
      const [render, setRender] = useState(0);
      return <>
        <p>{detail.status}</p>
        <button onClick={() => setRender(render + 1)}>Rerender {render}</button>
      </>;
    }
    await renderWithStudio(<Probe />);
    await expect.element(page.getByText("error", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Rerender 0" }).click();
    await page.getByRole("button", { name: "Rerender 1" }).click();
    expect(requests).toBe(1);
    loader.retryDetail("AccessControl");
    loader.retryDetail("AccessControl");
    await expect.element(page.getByText("loading", { exact: true })).toBeVisible();
    expect(requests).toBe(2);
    release?.();
    if (secondFails) {
      await expect.element(page.getByText("error", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Rerender 2" }).click();
      expect(requests).toBe(2);
      loader.retryDetail("AccessControl");
      await expect.element(page.getByText("loading", { exact: true })).toBeVisible();
      release?.();
    }
    await expect.element(page.getByText("ready", { exact: true })).toBeVisible();
    loader.retryDetail("AccessControl");
    expect(requests).toBe(secondFails ? 3 : 2);
  });
}

function DetailProbe({ name }: { name: string }) {
  const detail = useFacetDetail(name);
  if (detail.status === "loading") return <p>Loading…</p>;
  if (detail.status === "error") return <p>{`Error: ${detail.reason}`}</p>;
  return <p>{`Ready: ${detail.detail.name} · ${detail.detail.abi.length} ABI entries`}</p>;
}

describe("useFacetDetail against the real fixture catalog", () => {
  test("fetches, checks its hash and renders the parsed shard", async () => {
    await renderWithStudio(<DetailProbe name="AccessControl" />);
    await expect.element(page.getByText("Loading…")).toBeVisible();
    await expect.element(page.getByText(/^Ready: AccessControl · \d+ ABI entries$/)).toBeVisible();
  });

  test("an unknown name reports an error, not a stuck loading state", async () => {
    await renderWithStudio(<DetailProbe name="NoSuchFacet" />);
    await expect.element(page.getByText("Error: NoSuchFacet has no ABI shard in this catalog.")).toBeVisible();
  });
});

describe("warming placed facets", () => {
  // A facet no other test in this file touches, so a cache hit from an earlier test can't mask a missing fetch.
  test("a project's placed facets are fetched without anything calling useFacetDetail", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const catalog = fixtureCatalog();
    const recipe = makeRecipe({ facets: ["ERC20"] }, catalog);
    await renderWithStudio(<p>No facet detail hook mounted.</p>, { project: makeProject({ recipe }) });

    await vi.waitFor(() => {
      const asked = fetchSpy.mock.calls.some((call) => String(call[0]).includes("shards/ERC20.json"));
      expect(asked).toBe(true);
    });
  });
});
