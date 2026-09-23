import { command, provideServices, putDeployment } from "@/contracts";
import type { Address, Deployment, Hex, Hex4, LoupeFacet, Project } from "@lattice-studio/core";
import { analyze, loadTemplate } from "@lattice-studio/core";
import { makeProject } from "@lattice-studio/core/testing";
import { describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import {
  bufferedServices, fakeChainService, fixtureCatalog, onCleanup, overrideCommands, renderWithStudio,
} from "../../../../../test/harness";
import { ComparisonView } from "./ComparisonView";

const SEPOLIA = 11155111;
const DIAMOND = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as Address;
const STRAY = "0x9999999999999999999999999999999999999999" as Address;
const RECORD_HASH = `0x${"cd".repeat(32)}` as Hex;

const catalog = fixtureCatalog();
const template = loadTemplate(catalog, "GovernedVault");
if (!template.ok) throw new Error(template.error);
const recipe = template.value;
const plan = analyze(recipe, catalog, { known: [], unconfirmed: [] }).plan;

/** The loupe of a diamond cut exactly as planned. */
const matching: LoupeFacet[] = plan.map((entry) => ({ facetAddress: entry.address, functionSelectors: [...entry.selectors] }));

const [first, second, third] = plan;
if (!first || !second || !third) throw new Error("GovernedVault plans at least three facets.");
const droppedSelector = first.selectors[0] as Hex4;
const movedSelector = second.selectors[0] as Hex4;
/** One selector dropped from the first facet, one moved from the second to the third, one stray address. */
const mismatching: LoupeFacet[] = [
  ...matching.map((facet, index) => {
    if (index === 0) return { ...facet, functionSelectors: facet.functionSelectors.slice(1) };
    if (index === 1) return { ...facet, functionSelectors: facet.functionSelectors.slice(1) };
    if (index === 2) return { ...facet, functionSelectors: [...facet.functionSelectors, movedSelector] };
    return facet;
  }),
  { facetAddress: STRAY, functionSelectors: ["0xdeadbeef" as Hex4] },
];

function project(id: string): Project {
  return makeProject({ id, recipe });
}

function view() {
  return <ComparisonView view={{ kind: "comparison", chainId: SEPOLIA, address: DIAMOND }} />;
}

function readFacetsCalls(chain: ReturnType<typeof fakeChainService>): number {
  return chain.calls.filter((call) => call.method === "readFacets").length;
}

describe("ComparisonView", () => {
  test("a diamond that matches: the verdict with the plan's counts, and both columns", async () => {
    const chain = fakeChainService({ facets: { [DIAMOND]: matching } });
    await renderWithStudio(view(), { project: project("compare-match"), chain });
    await expect.element(page.getByRole("heading", { name: "Compare with the sheet" })).toBeVisible();
    await expect.element(page.getByText("Mismatch", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Diamond matches the sheet: 14 facets, 120 selectors.")).toBeVisible();
    await expect.element(page.getByText("Sepolia", { exact: true })).toBeVisible();
    await expect.element(page.getByText(DIAMOND, { exact: true })).toBeVisible();
    const planColumn = page.getByRole("region", { name: "Plan" });
    expect(planColumn.getByRole("listitem").elements()).toHaveLength(14);
    expect(page.getByRole("region", { name: "facets()" }).getByRole("listitem").elements()).toHaveLength(14);
    expect(page.getByText("Missing on chain").elements()).toHaveLength(0);
    expect(page.getByText("Not in the plan").elements()).toHaveLength(0);
    expect(readFacetsCalls(chain)).toBe(1);
  });

  test("a diamond that doesn't match: missing, extra and moved selectors marked in words", async () => {
    const chain = fakeChainService({ facets: { [DIAMOND]: mismatching } });
    await renderWithStudio(view(), { project: project("compare-mismatch"), chain });
    await expect.element(page.getByText("Deployed, but doesn't match the sheet")).toBeVisible();

    const planColumn = page.getByRole("region", { name: "Plan" });
    const missingItem = planColumn.getByRole("listitem").filter({ hasText: "Missing on chain" });
    await expect.element(missingItem).toBeVisible();
    expect(missingItem.element().textContent).toContain(first.facet);
    expect(missingItem.element().textContent).toContain(droppedSelector);

    const loupeColumn = page.getByRole("region", { name: "facets()" });
    const extraItem = loupeColumn.getByRole("listitem").filter({ hasText: "Not in the plan" });
    await expect.element(extraItem).toBeVisible();
    expect(extraItem.element().textContent).toContain("0xdeadbeef");

    const moved = page.getByRole("list", { name: "Moved selectors" });
    await expect.element(moved).toBeVisible();
    const movedText = moved.element().textContent ?? "";
    expect(movedText).toContain("Moved");
    expect(movedText).toContain(movedSelector);
    expect(movedText).toContain("Planned at");
    expect(movedText).toContain("on chain at");
  });

  test("offline: says chain checks need a connection and doesn't read", async () => {
    onCleanup(provideServices({ connection: { isOnline: () => false, subscribe: () => () => {} } }));
    const chain = fakeChainService({ facets: { [DIAMOND]: matching } });
    await renderWithStudio(view(), { project: project("compare-offline"), chain });
    await expect.element(page.getByText("Chain checks need a connection.")).toBeVisible();
    expect(readFacetsCalls(chain)).toBe(0);
  });

  test("RPC down: the chain's error, and Retry reads again", async () => {
    const chain = fakeChainService({ facets: { [DIAMOND]: matching }, down: [SEPOLIA] });
    await renderWithStudio(view(), { project: project("compare-down"), chain });
    await expect.element(page.getByText("Sepolia's public RPC isn't answering.")).toBeVisible();
    expect(readFacetsCalls(chain)).toBe(1);
    chain.setDown(SEPOLIA, false);
    await page.getByRole("button", { name: "Retry" }).click();
    await expect.element(page.getByText("Diamond matches the sheet: 14 facets, 120 selectors.")).toBeVisible();
    expect(readFacetsCalls(chain)).toBe(2);
  });

  test("the record's recipe hash beside the sheet's, found case-insensitively; No record without one", async () => {
    const record: Deployment = {
      projectId: "compare-record",
      chainId: SEPOLIA,
      address: DIAMOND.toLowerCase() as Address,
      path: "factory",
      deployer: STRAY,
      salt: `0x${"00".repeat(32)}` as Hex,
      status: "mismatch",
      recipeHash: RECORD_HASH,
      catalogHash: catalog.hash,
      at: "2026-09-01T00:00:00.000Z",
      verification: "pending",
      revision: 1,
    };
    await putDeployment(record);
    const chain = fakeChainService({ facets: { [DIAMOND]: mismatching } });
    await renderWithStudio(view(), { project: project("compare-record"), chain });
    await expect.element(page.getByText(RECORD_HASH, { exact: true })).toBeVisible();
    expect(page.getByText("No record").elements()).toHaveLength(0);
  });

  test("No record when the project has none for this diamond", async () => {
    const chain = fakeChainService({ facets: { [DIAMOND]: matching } });
    await renderWithStudio(view(), { project: project("compare-no-record"), chain });
    await expect.element(page.getByText("No record", { exact: true })).toBeVisible();
  });

  test("Copy details copies a plain-text report and toasts", async () => {
    const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    onCleanup(() => write.mockRestore());
    const chain = fakeChainService({ facets: { [DIAMOND]: mismatching } });
    await renderWithStudio(view(), { project: project("compare-copy"), chain });
    await expect.element(page.getByText("Deployed, but doesn't match the sheet")).toBeVisible();
    await page.getByRole("button", { name: "Copy details" }).click();
    await vi.waitFor(() => expect(bufferedServices().toast.at(-1)?.text).toBe("Copied comparison"));
    const copied = String(write.mock.calls.at(-1)?.[0]);
    expect(copied).toContain("Chain: Sepolia (11155111)");
    expect(copied).toContain(`Address: ${DIAMOND}`);
    expect(copied).toContain("Record's recipe hash: No record");
    expect(copied).toContain("Missing on chain:");
    expect(copied).toContain(`Not in the plan:\n  ${STRAY}: 0xdeadbeef`);
    expect(copied).toContain("Moved:");
  });

  test("Use a new salt runs deploy.newSalt", async () => {
    const run = vi.fn();
    overrideCommands([
      command({ id: "deploy.newSalt", title: () => "Use a new salt", category: "Deploy", enabled: () => ({ ok: true }), run }),
    ]);
    const chain = fakeChainService({ facets: { [DIAMOND]: matching } });
    await renderWithStudio(view(), { project: project("compare-salt"), chain });
    await page.getByRole("button", { name: "Use a new salt" }).click();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
