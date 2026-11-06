import { encodeFunctionData, parseAbi } from "viem";
import { ok, toChecksum, type ExportFile, type Hex } from "@lattice-studio/core";
import { afterEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { doc, runCommand, session } from "@/contracts";
import { setDownloader } from "@/panels/console/download";
import { DialogHost } from "@/ui/overlays/DialogHost";
import { axeViolations } from "@/ui/testing/axe";
import { onCleanup, renderWithStudio } from "../../../test/harness";
import type { DiamondSnapshot } from "./snapshot";
import type { TransactionController, TransactionIntent, TransactionReview, TransactionState } from "./transaction";
import { openTransactionReview } from "./transaction-review-actions";
import { getTransactionReview, invalidateTransactionReview, setTransactionReview } from "./transaction-review-state";

const ADDRESS = "0x00000000000000000000000000000000000000aa";
const USER = "0x00000000000000000000000000000000000000bb";
const SAFE = "0x00000000000000000000000000000000000000cc";
const abi = parseAbi(["function set(uint256 amount)"]);
const data = encodeFunctionData({ abi, functionName: "set", args: [9007199254740993n] });
const snapshot: DiamondSnapshot = { block: 123, blockHash: `0x${"12".repeat(32)}`, code: "0x6000", facets: [], codehashes: {}, ownerRouted: false, owner: null };
const intent: TransactionIntent = { chainId: 11155111, tx: { to: ADDRESS, data, value: 0n }, snapshot, contextKey: "captured-context" };

function fakeController(initial: TransactionState["phase"] = "ready") {
  const review: TransactionReview = { ...intent, contextKey: "captured-context", from: USER, gas: 123456n, simulation: { kind: "ok", block: 124, gas: 123456n, method: "call" } };
  let state: TransactionState = { phase: initial, review };
  const listeners = new Set<() => void>();
  const publish = (next: TransactionState) => { state = next; for (const listener of listeners) listener(); };
  const controller: TransactionController = {
    get: () => state, subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    review: vi.fn(async () => publish({ phase: "ready", review })),
    sign: vi.fn(async () => publish({ phase: "pending", review, hash: `0x${"ab".repeat(32)}` as Hex })),
    keepWaiting: vi.fn(() => publish({ ...state, phase: "pending" })), checkWallet: vi.fn(async () => {}),
    cancel: vi.fn(() => publish({ phase: "cancelled", review })), dispose: () => { listeners.clear(); },
  };
  onCleanup(() => controller.dispose());
  return { controller, publish };
}

async function open(controller: TransactionController) {
  await renderWithStudio(<DialogHost />);
  const before = doc.get();
  await openTransactionReview({ intent, label: "set(uint256)", fn: abi[0], abi, controller, beforeSafeExport: async () => ok(undefined) });
  const dialog = page.getByRole("dialog", { name: "Review transaction", exact: true });
  await expect.element(dialog).toBeVisible();
  return { dialog, before };
}

afterEach(async () => {
  setTransactionReview(null);
  await page.viewport(1440, 900);
});

test("review shows captured destination/value/arguments and sends only after explicit Sign", async () => {
  const { controller } = fakeController();
  const { dialog, before } = await open(controller);
  expect(controller.sign).not.toHaveBeenCalled();
  await expect.element(dialog.getByText(ADDRESS, { exact: true })).toBeVisible();
  await expect.element(dialog.getByText("9007199254740993", { exact: true })).toBeVisible();
  await expect.element(dialog.getByText("eth_call at block 124", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Sign transaction", exact: true }).click();
  await expect.poll(() => controller.sign).toHaveBeenCalledTimes(1);
  await expect.element(dialog.getByRole("status")).toHaveTextContent("Waiting for confirmation…");
  expect(dialog.element().contains(document.activeElement)).toBe(true);
  expect(doc.get()).toBe(before);
});

test("closing pending progress preserves tracking and the palette command reopens it", async () => {
  const { controller, publish } = fakeController();
  const { dialog } = await open(controller);
  publish({ ...controller.get(), phase: "pending", hash: `0x${"ab".repeat(32)}` });
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  expect(controller.cancel).not.toHaveBeenCalled();
  expect(controller.get().phase).toBe("pending");
  await runCommand({ id: "inspect.showProgress" }, "palette");
  await expect.element(page.getByRole("dialog", { name: "Review transaction", exact: true })).toBeVisible();
});

test("input changes invalidate the unsent request and remove the signing action", async () => {
  const { controller } = fakeController();
  const { dialog } = await open(controller);
  invalidateTransactionReview();
  await expect.element(dialog.getByText("The call inputs changed. Close this review and review the call again.", { exact: true })).toBeVisible();
  expect(dialog.getByRole("button", { name: "Sign transaction", exact: true }).elements()).toHaveLength(0);
  expect(getTransactionReview()?.invalidated).toBe(true);
});

test("Safe export downloads one exact call proposal and does not sign or alter chain status", async () => {
  const { controller } = fakeController();
  const { dialog } = await open(controller);
  const files: ExportFile[] = [];
  onCleanup(setDownloader((file) => { files.push(file); }));
  await dialog.getByRole("textbox", { name: "Safe address" }).fill(SAFE);
  await dialog.getByRole("button", { name: "Export Safe call", exact: true }).click();
  await expect.poll(() => files.length).toBe(1);
  const file = JSON.parse(files[0]!.text) as { transactions: { to: string; value: string; data: string }[] };
  expect(file.transactions).toEqual([{ to: toChecksum(ADDRESS), value: "0", data }]);
  expect(controller.sign).not.toHaveBeenCalled();
  expect(controller.get().phase).toBe("ready");
});

test("closing while a Safe preflight is pending prevents a late download", async () => {
  const { controller } = fakeController();
  await renderWithStudio(<DialogHost />);
  let finish!: () => void;
  const waiting = new Promise<void>((resolve) => { finish = resolve; });
  await openTransactionReview({ intent, label: "set(uint256)", controller, beforeSafeExport: async () => { await waiting; return ok(undefined); } });
  const dialog = page.getByRole("dialog", { name: "Review transaction", exact: true });
  const files: ExportFile[] = [];
  onCleanup(setDownloader((file) => { files.push(file); }));
  await dialog.getByRole("textbox", { name: "Safe address" }).fill(SAFE);
  await dialog.getByRole("button", { name: "Export Safe call", exact: true }).click();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  finish();
  await expect.element(dialog).not.toBeInTheDocument();
  expect(files).toHaveLength(0);
});

test("a proposal record failure reports the completed download truthfully", async () => {
  const { controller } = fakeController();
  await renderWithStudio(<DialogHost />);
  await openTransactionReview({ intent, label: "set(uint256)", controller, beforeSafeExport: async () => ok(undefined), onSafeExport: async () => { throw new Error("Storage failure"); } });
  const dialog = page.getByRole("dialog", { name: "Review transaction", exact: true });
  const files: ExportFile[] = [];
  onCleanup(setDownloader((file) => { files.push(file); }));
  await dialog.getByRole("textbox", { name: "Safe address" }).fill(SAFE);
  await dialog.getByRole("button", { name: "Export Safe call", exact: true }).click();
  await expect.element(dialog.getByRole("textbox", { name: "Safe address" })).toHaveAccessibleDescription("The Safe call was downloaded, but Studio couldn't save its proposal record.");
  expect(files).toHaveLength(1);
  expect(controller.sign).not.toHaveBeenCalled();
});

test("stale progress offers keep waiting and wallet checks; confirmation keeps receipt truth", async () => {
  const { controller, publish } = fakeController();
  const { dialog } = await open(controller);
  publish({ ...controller.get(), phase: "stale" });
  await dialog.getByRole("button", { name: "Check wallet", exact: true }).click();
  expect(controller.checkWallet).toHaveBeenCalledTimes(1);
  await dialog.getByRole("button", { name: "Keep waiting", exact: true }).click();
  expect(controller.keepWaiting).toHaveBeenCalledTimes(1);
  publish({ ...controller.get(), phase: "confirmed", verificationPending: true });
  await expect.element(dialog.getByRole("status")).toHaveTextContent("A success receipt was observed. Studio couldn't finish verification. Keep the transaction hash and check its progress.");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  invalidateTransactionReview();
  expect(controller.get().phase).toBe("confirmed");
});

test("phone review traps keyboard focus, returns focus on Escape and passes axe", async () => {
  await page.viewport(320, 740);
  const { controller } = fakeController();
  const { dialog } = await open(controller);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
  expect(await axeViolations(dialog.element())).toEqual([]);
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => session.get().dialogs.length).toBe(0);
  expect(controller.cancel).toHaveBeenCalledTimes(1);
});
