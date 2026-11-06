import { err, ok, type Hex } from "@lattice-studio/core";
import { afterEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { command, doc, session, type InspectorViewProps } from "@/contracts";
import { axeViolations } from "@/ui/testing/axe";
import { fixtureCatalog, onCleanup, overrideCommands, renderWithStudio } from "../../../test/harness";
import { DeployedView } from "./DeployedView";
import { DeployedStructure } from "./DeployedStructure";
import { createInspectionEngine, type InspectionPorts } from "./engine";
import type { DiamondSnapshot } from "./snapshot";

const ADDRESS = "0x00000000000000000000000000000000000000aa";
const KNOWN = "0x00000000000000000000000000000000000000bb";
const UNKNOWN = "0x00000000000000000000000000000000000000cc";
const view: InspectorViewProps<"deployed">["view"] = { kind: "deployed", chainId: 11155111, address: ADDRESS };
const catalog = fixtureCatalog();
const facet = catalog.facets.find((item) => item.name === "ERC20");
if (!facet) throw new Error("No ERC20 fixture.");
const selector = facet.selectors[0]!.hex;

function snapshot(patch: Partial<DiamondSnapshot> = {}): DiamondSnapshot {
  return {
    block: 123, blockHash: `0x${"12".repeat(32)}`, code: "0x6000",
    facets: [
      { facetAddress: KNOWN, functionSelectors: [selector, "0xdeadbeef"] },
      { facetAddress: UNKNOWN, functionSelectors: ["0x12345678"] },
      { facetAddress: ADDRESS, functionSelectors: ["0xffffffff"] },
    ],
    codehashes: { [KNOWN]: facet!.release.codehash, [UNKNOWN]: `0x${"34".repeat(32)}` },
    ownerRouted: false, owner: null, ...patch,
  };
}

function engine(read: InspectionPorts["read"] = async () => ok(snapshot())) {
  const result = createInspectionEngine({ chains: [{ id: 11155111, name: "Sepolia", testnet: true, explorer: "https://sepolia.etherscan.io" }], read, catalogs: async () => ok([catalog]) });
  onCleanup(() => result.dispose());
  return result;
}

afterEach(async () => {
  vi.restoreAllMocks();
  history.replaceState(null, "", location.pathname + location.search);
  await page.viewport(1440, 900);
});

test("shows chain facts and exact loupe counts without changing the composition", async () => {
  const inspected = engine();
  await renderWithStudio(<DeployedView view={view} engine={inspected} />);
  const before = doc.get();
  await expect.element(page.getByRole("heading", { name: "Deployed diamond", exact: true })).toBeVisible();
  await expect.element(page.getByText("3 facets · 4 selectors", { exact: true })).toBeVisible();
  await expect.element(page.getByText("owner() is not routed.", { exact: true })).toBeVisible();
  await expect.element(page.getByText("ERC20", { exact: true })).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Inspect unknown facet" })).toBeVisible();
  const explorer = page.getByRole("link", { name: "View on explorer", exact: true });
  await expect.element(explorer).toHaveAttribute("rel", "noreferrer noopener");
  expect(explorer.element().getAttribute("href")?.toLowerCase()).toBe(`https://sepolia.etherscan.io/address/${ADDRESS}`);
  expect(doc.get()).toBe(before);
  expect(document.querySelector("[data-inspector-plan]")).toBeNull();
});

test("loading and transport failure offer a successful retry", async () => {
  let finish!: (result: Awaited<ReturnType<InspectionPorts["read"]>>) => void;
  let calls = 0;
  const inspected = engine(() => ++calls === 1 ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve(ok(snapshot())));
  await renderWithStudio(<DeployedView view={view} engine={inspected} />);
  await expect.element(page.getByText("Inspecting diamond…", { exact: true })).toBeVisible();
  finish(err({ kind: "rpc", reason: "Sepolia's public RPC isn't answering." }));
  await expect.element(page.getByText("Sepolia's public RPC isn't answering.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect.element(page.getByText("3 facets · 4 selectors", { exact: true })).toBeVisible();
});

test.each([
  ["no code", { code: "0x", facets: null }, "No contract code at this address."],
  ["no loupe", { facets: null }, "This contract doesn't expose a diamond loupe."],
] as const)("distinguishes %s from a read failure", async (_name, patch, text) => {
  await renderWithStudio(<DeployedView view={view} engine={engine(async () => ok(snapshot(patch)))} />);
  await expect.element(page.getByText(text, { exact: true })).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Export passport" })).toBeVisible();
  expect(document.querySelector('[aria-label="Facets"]')).toBeNull();
});

test("known facet details use actual instance address and only routed selectors", async () => {
  await renderWithStudio(<DeployedView view={{ ...view, facetAddress: KNOWN }} engine={engine()} />);
  await expect.element(page.getByRole("heading", { name: "ERC20", exact: true })).toBeVisible();
  const selectors = page.getByRole("region", { name: "Selectors" });
  await expect.element(selectors.getByText("0xdeadbeef", { exact: true })).toBeVisible();
  await expect.element(selectors.getByText(facet!.selectors[0]!.signature, { exact: true })).toBeVisible();
  expect(selectors.element().querySelectorAll("li")).toHaveLength(2);
  await expect.element(page.getByRole("region", { name: "Facet" }).getByText(KNOWN, { exact: true })).toBeVisible();
  await expect.element(page.getByText("Catalog storage layout; storage values have not been read.", { exact: true })).toBeVisible();
});

test.each([[UNKNOWN, "Unknown facet"], [ADDRESS, "Diamond itself"]] as const)("keeps %s raw and avoids invented catalog metadata", async (facetAddress, title) => {
  await renderWithStudio(<DeployedView view={{ ...view, facetAddress }} engine={engine()} />);
  await expect.element(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expect.element(page.getByRole("region", { name: "Selectors" })).toBeVisible();
  expect(document.querySelector('[aria-label="Storage"]')).toBeNull();
});

test("a stale facet selection is explicit", async () => {
  await renderWithStudio(<DeployedView view={{ ...view, facetAddress: "0x00000000000000000000000000000000000000dd" }} engine={engine()} />);
  await expect.element(page.getByText("This facet isn't routed by the observed diamond.", { exact: true })).toBeVisible();
});

test("Back returns to the composition and clears only its diamond route", async () => {
  history.replaceState(null, "", `${location.pathname}${location.search}#d=11155111:${ADDRESS}`);
  await renderWithStudio(<DeployedView view={view} engine={engine()} />, { session: { panes: { ...session.get().panes, inspector: { open: true, size: 316, view } } } });
  const before = doc.get();
  await page.getByRole("button", { name: "Back to composition" }).click();
  await expect.poll(() => session.get().panes.inspector.view).toEqual({ kind: "diamond" });
  expect(location.hash).toBe("");
  expect(doc.get()).toBe(before);
});

test("structure expands actual known, foreign and self selectors without composer actions", async () => {
  const inspected = engine();
  const selected: string[] = [];
  overrideCommands([command({ id: "inspect.selectFacet", title: () => "Inspect facet", category: "Chain", enabled: () => ({ ok: true }), run: (_ctx, args: { facetAddress?: Hex }) => { if (args.facetAddress) selected.push(args.facetAddress); } })]);
  await renderWithStudio(<DeployedStructure view={view} engine={inspected} />);
  const before = doc.get();
  const tree = page.getByRole("tree", { name: "On-chain structure" });
  const row = tree.getByRole("treeitem", { name: /^ERC20/ });
  await row.click();
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(tree.getByRole("treeitem", { name: /0xdeadbeef/ })).toBeVisible();
  expect(selected).toContain(KNOWN);
  expect(doc.get()).toBe(before);
});

test("the phone view fits 320 px and passes axe", async () => {
  await page.viewport(320, 740);
  await renderWithStudio(<main style={{ width: "100%" }}><DeployedView view={{ ...view, facetAddress: KNOWN }} engine={engine()} /></main>);
  await expect.element(page.getByRole("region", { name: "Selectors" })).toBeVisible();
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
  expect(await axeViolations(document.querySelector("main")!)).toEqual([]);
});
