import { makeCatalog, makeFacet } from "@lattice-studio/core/testing";
import { buildPassport, err, identifyFacets, ok, type FacetDetail, type Result } from "@lattice-studio/core";
import { parseAbi } from "viem";
import { expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { doc } from "@/contracts";
import { renderWithStudio } from "../../../test/harness";
import { FacetFunctions } from "./FacetFunctions";
import type { ReadyInspection } from "./engine";
import type { DiamondSnapshot } from "./snapshot";
import { createCallController } from "./calls";

const ADDRESS = "0x00000000000000000000000000000000000000aa";
const metadata = makeFacet({ name: "Token", selectors: ["read(uint256)", "read(address)", "write(uint256)"] });
const catalog = makeCatalog({ facets: [metadata] });
const selectors = [metadata.selectors[0]!.hex, metadata.selectors[2]!.hex, "0xdeadbeef" as const];
const snapshot: DiamondSnapshot = { block: 123, blockHash: `0x${"12".repeat(32)}`, code: "0x6000", facets: [{ facetAddress: metadata.release.address, functionSelectors: selectors }], codehashes: { [metadata.release.address.toLowerCase()]: metadata.release.codehash }, ownerRouted: false, owner: null };
const facet = identifyFacets(snapshot.facets!, snapshot.codehashes, [catalog], ADDRESS)[0]!;
const value: ReadyInspection = {
  target: { chainId: 11155111, address: ADDRESS }, chainName: "Sepolia", snapshot, facets: [facet], primaryName: null, identity: "snapshot1:abi1",
  passport: buildPassport({ chainId: 11155111, chainName: "Sepolia", address: ADDRESS, block: 123, hasCode: true, loupe: snapshot.facets, codehashes: snapshot.codehashes, ownerRouted: false, owner: null, history: null, historySource: null, deployment: null }, [facet], null, { tag: catalog.lattice.tag, hash: catalog.hash }),
};
const detail: FacetDetail = { name: "Token", abi: [...parseAbi(["function read(uint256 amount) view returns (uint256)", "function read(address account) view returns (address)", "function write(uint256 amount)"])], natspec: { functions: {} }, source: { path: "Token.sol", url: "https://example.com/Token.sol" } };

test("lists only routed full signatures in Read and Write sections and does no automatic call", async () => {
  const call = vi.fn(async () => ok("0x" as const));
  const controller = createCallController({ call, resolve: async () => ok(null) });
  await renderWithStudio(<FacetFunctions value={value} facet={facet} metadata={metadata} catalog={catalog} controller={controller} loadDetail={async () => ok(detail)} />);
  const before = doc.get();
  await expect.element(page.getByRole("region", { name: "Read functions" })).toBeVisible();
  await expect.element(page.getByText("read(uint256)", { exact: true })).toBeVisible();
  await expect.element(page.getByText("write(uint256)", { exact: true })).toBeVisible();
  expect(page.getByText("read(address)", { exact: true }).elements()).toHaveLength(0);
  await expect.element(page.getByText("1 routed selector has no function in this verified ABI. They are shown as raw selectors above.", { exact: true })).toBeVisible();
  await page.getByText("read(uint256)", { exact: true }).click();
  await expect.element(page.getByRole("textbox", { name: "amount (uint256)" })).toBeVisible();
  expect(call).not.toHaveBeenCalled();
  expect(doc.get()).toBe(before);
});

test("failed verified detail loading is explicit and retryable", async () => {
  let attempts = 0;
  const loadDetail = async (): Promise<Result<FacetDetail, string>> => ++attempts === 1 ? err("The ABI shard couldn't be verified.") : ok(detail);
  await renderWithStudio(<FacetFunctions value={value} facet={facet} metadata={metadata} catalog={catalog} loadDetail={loadDetail} />);
  await expect.element(page.getByText("The ABI shard couldn't be verified.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Retry loading functions" }).click();
  await expect.element(page.getByRole("region", { name: "Read functions" })).toBeVisible();
});

test("a detail response arriving after replacement cannot publish old functions", async () => {
  let finish!: (result: Result<FacetDetail, string>) => void;
  const pending = () => new Promise<Result<FacetDetail, string>>((resolve) => { finish = resolve; });
  const screen = await renderWithStudio(<FacetFunctions value={value} facet={facet} metadata={metadata} catalog={catalog} loadDetail={pending} />);
  await expect.element(page.getByText("Loading the verified ABI…", { exact: true })).toBeVisible();
  await screen.rerender(<p>Another target</p>);
  finish(ok(detail));
  await expect.element(page.getByText("Another target", { exact: true })).toBeVisible();
  expect(page.getByRole("region", { name: "Read functions" }).elements()).toHaveLength(0);
});
