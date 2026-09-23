/**
 * S14's loader against the real dev server: `seedStudio`'s default catalog is K3's fixture at `id: "fixture"`,
 * served at `/catalog/fixture/…`, exactly where the real loader (registered by `contracts/discover.ts`,
 * imported by the harness's `setup.ts`) reads it. `useFacetDetail` here exercises the whole path: fetch,
 * hash check, parse, cache.
 */
import { makeProject, makeRecipe } from "@lattice-studio/core/testing";
import { describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { useFacetDetail } from "@/contracts";
import { fixtureCatalog, renderWithStudio } from "../../test/harness";

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
