import { buildPassport, type PassportCutEvent } from "@lattice-studio/core";
import { afterEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { doc } from "@/contracts";
import { axeViolations } from "@/ui/testing/axe";
import { renderWithStudio } from "../../../test/harness";
import type { ReadyInspection } from "./engine";
import { HistorySection } from "./HistorySection";
import { getHyperRpcToken, setHyperRpcToken, type HistoryController, type HistoryState } from "./history-runtime";

const ADDRESS = "0x00000000000000000000000000000000000000aa";
const facts = { chainId: 11155111, chainName: "Sepolia", address: ADDRESS, block: 123, hasCode: true, loupe: [], codehashes: {}, ownerRouted: false, owner: null, history: null, historySource: null, deployment: null } as const;
const value: ReadyInspection = { target: { chainId: 11155111, address: ADDRESS }, chainName: "Sepolia", snapshot: { block: 123, blockHash: `0x${"12".repeat(32)}`, code: "0x6000", facets: [], codehashes: {}, ownerRouted: false, owner: null }, identity: "snapshot1", primaryName: null, facets: [], passport: buildPassport({ ...facts, loupe: [] }, [], null, null) };
const event: PassportCutEvent = { block: 110, logIndex: 1, txHash: `0x${"11".repeat(32)}`, init: ADDRESS, cuts: [{ action: "add", facet: ADDRESS, selectors: ["0x12345678"] }] };

function reader(initial: HistoryState = { status: "not-read" }) {
  let state = initial;
  const listeners = new Set<() => void>();
  const publish = (next: HistoryState) => { state = next; for (const listener of listeners) listener(); };
  const read = vi.fn<HistoryController["read"]>(async () => { publish({ status: "loading" }); });
  const cancel = vi.fn<HistoryController["cancel"]>(() => {});
  return { controller: { get: () => state, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, read, cancel }, publish, read, cancel };
}

afterEach(async () => { setHyperRpcToken(""); await page.viewport(1440, 900); });

test("normal RPC is default and no history is read until a valid explicit range is requested", async () => {
  const { controller, read } = reader();
  await renderWithStudio(<HistorySection value={value} controller={controller} />);
  const before = doc.get();
  await expect.element(page.getByRole("combobox", { name: "History provider" })).toHaveTextContent("Normal RPC");
  expect(read).not.toHaveBeenCalled();
  await page.getByRole("button", { name: "Read history", exact: true }).click();
  await expect.element(page.getByRole("textbox", { name: "First block" })).toHaveAccessibleDescription(/Enter the first block to scan/);
  await page.getByRole("textbox", { name: "First block" }).fill("100");
  await page.getByRole("button", { name: "Read history", exact: true }).click();
  expect(read).toHaveBeenCalledWith({ ...value.target, block: 123, blockHash: value.snapshot.blockHash, identity: value.identity }, { provider: "rpc", fromBlock: 100 });
  expect(doc.get()).toBe(before);
});

test("partial history reports exact coverage and no invented creation transaction", async () => {
  const { controller } = reader({ status: "ready", value: { ...value.target, history: [event], source: "rpc", fromBlock: 100, toBlock: 123, blockHash: value.snapshot.blockHash, coverage: "range", deployment: null } });
  await renderWithStudio(<HistorySection value={value} controller={controller} />);
  await expect.element(page.getByText("Partial history: blocks 100–123. Earlier events were not read.", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Creation transaction not verified.", { exact: true })).toBeVisible();
  await page.getByText("Block 110 · 1 cut", { exact: true }).click();
  await expect.element(page.getByText(event.txHash, { exact: true })).toBeVisible();
});

test("large histories render only the latest 100 events and retain complete facts", async () => {
  const history = Array.from({ length: 150 }, (_, index) => ({ ...event, block: index, logIndex: index }));
  const facts = { ...value.target, history, source: "rpc" as const, fromBlock: 0, toBlock: 200, blockHash: value.snapshot.blockHash, coverage: "range" as const, deployment: null };
  const { controller } = reader({ status: "ready", value: facts });
  await renderWithStudio(<HistorySection value={{ ...value, snapshot: { ...value.snapshot, block: 200 } }} controller={controller} />);
  await expect.element(page.getByText("Showing the latest 100 of 150 cut events.", { exact: true })).toBeVisible();
  const list = page.getByRole("list", { name: "DiamondCut history", exact: true }).element();
  expect(list.children).toHaveLength(100);
  expect(list.firstElementChild?.textContent).toContain("Block 149");
  expect(list.lastElementChild?.textContent).toContain("Block 50");
  expect(facts.history).toBe(history);
  expect(facts.history).toHaveLength(150);
});

test("transport failure remains unread and offers Retry", async () => {
  const { controller, read } = reader({ status: "error", reason: "History not read: the provider couldn't finish the log scan." });
  await renderWithStudio(<HistorySection value={value} controller={controller} />);
  await page.getByRole("textbox", { name: "First block" }).fill("100");
  await page.getByRole("button", { name: "Retry history", exact: true }).click();
  expect(read).toHaveBeenCalledTimes(1);
});

test("the optional provider token is masked, session-only and clearable", async () => {
  const { controller, read } = reader();
  await renderWithStudio(<HistorySection value={value} controller={controller} />);
  await page.getByRole("combobox", { name: "History provider" }).click();
  await page.getByRole("option", { name: "HyperRPC", exact: true }).click();
  const password = page.getByLabelText("HyperRPC token", { exact: true });
  await password.fill("session-test-token");
  expect(getHyperRpcToken()).toBe("");
  await userEvent.keyboard("{Enter}");
  await expect.element(password).toHaveAttribute("type", "password");
  expect(getHyperRpcToken()).toBe("session-test-token");
  expect(document.body.textContent).not.toContain("session-test-token");
  await page.getByRole("button", { name: "Read history", exact: true }).click();
  expect(read.mock.calls[0]?.[1]).toEqual({ provider: "hyperrpc" });
  await page.getByRole("button", { name: "Clear token", exact: true }).click();
  expect(getHyperRpcToken()).toBe("");
});

test("phone history controls fit 320 px and pass axe", async () => {
  await page.viewport(320, 740);
  const { controller } = reader();
  await renderWithStudio(<main><HistorySection value={value} controller={controller} /></main>);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
  expect(await axeViolations(document.querySelector("main")!)).toEqual([]);
});
