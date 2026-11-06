import type { Deployment, Hex } from "@lattice-studio/core";
import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { session } from "@/contracts";
import { axeViolations } from "@/ui/testing/axe";
import { renderWithStudio } from "../../../../test/harness";
import type { UpgradeTrackingState } from "../upgrade-tracking";
import { UpgradeRecovery } from "./UpgradeRecovery";

const ADDRESS = "0x00000000000000000000000000000000000000aa";
const HASH: Hex = `0x${"12".repeat(32)}`;
function record(phase: NonNullable<Deployment["pendingUpgrade"]>["phase"] = "signing", tx?: Hex): Deployment {
  return { kind: "imported", projectId: "original-project", chainId: 11155111, address: ADDRESS, status: "confirmed", recipeHash: HASH, catalogHash: HASH, at: "2026-11-06T00:00:00Z", revision: 3, verification: "failed",
    pendingUpgrade: { phase, desiredRecipeHash: HASH, catalogHash: HASH, baseline: { block: 123, blockHash: HASH, facets: [], codehashes: {} }, expectedFacets: [], expectedCodehashes: {}, from: ADDRESS, call: { data: "0x12345678", value: "0" }, since: "2026-11-06T00:00:00Z", ...(tx ? { tx } : {}) } };
}
function runtime() {
  let state: UpgradeTrackingState = { status: "idle" };
  const listeners = new Set<() => void>();
  const publish = (next: UpgradeTrackingState) => { state = next; for (const listener of listeners) listener(); };
  const resumeUpgrade = vi.fn(async () => { publish({ status: "watching", hash: HASH }); return { ok: true as const, value: undefined }; });
  const stopUpgradeObservation = vi.fn(() => publish({ status: "idle", reason: "Observation stopped. The unresolved upgrade is still saved." }));
  const discardUpgradeProposal = vi.fn(async () => ({ ok: true as const, value: undefined }));
  return { api: { getUpgradeTracking: () => state, subscribeUpgradeTracking: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, resumeUpgrade, stopUpgradeObservation, discardUpgradeProposal }, resumeUpgrade, stopUpgradeObservation, discardUpgradeProposal, publish };
}
afterEach(async () => { await page.viewport(1440, 900); });

test("unknown wallet outcomes require an explicit valid hash and never offer discard", async () => {
  const r = runtime();
  await renderWithStudio(<UpgradeRecovery record={record()} online runtime={r.api} />);
  await expect.element(page.getByText("Wallet outcome unknown", { exact: true })).toBeVisible();
  expect(r.resumeUpgrade).not.toHaveBeenCalled();
  expect(page.getByRole("button", { name: /Discard/ }).elements()).toHaveLength(0);
  await page.getByRole("button", { name: "Observe transaction", exact: true }).click();
  await expect.element(page.getByRole("textbox", { name: "Executed transaction hash" })).toHaveAccessibleDescription(/32-byte transaction hash/);
  expect(r.resumeUpgrade).not.toHaveBeenCalled();
  await page.getByRole("textbox", { name: "Executed transaction hash" }).fill(HASH);
  await page.getByRole("button", { name: "Observe transaction", exact: true }).click();
  expect(r.resumeUpgrade).toHaveBeenCalledWith(11155111, ADDRESS, { txHash: HASH });
  await page.getByRole("button", { name: "Stop observation", exact: true }).click();
  expect(r.stopUpgradeObservation).toHaveBeenCalledWith(11155111, ADDRESS);
});

test("a saved hash resumes observation without asking for a new hash or stopping when the view closes", async () => {
  const r = runtime();
  const view = await renderWithStudio(<UpgradeRecovery record={record("pending", HASH)} online runtime={r.api} />);
  expect(page.getByRole("textbox").elements()).toHaveLength(0);
  await page.getByRole("button", { name: "Resume observation", exact: true }).click();
  expect(r.resumeUpgrade).toHaveBeenCalledWith(11155111, ADDRESS, {});
  await view.unmount();
  expect(r.stopUpgradeObservation).not.toHaveBeenCalled();
});

test("only an unexecuted proposal has an explicit discard action, with runtime errors visible", async () => {
  const r = runtime();
  r.discardUpgradeProposal.mockImplementation(async () => { throw new Error("Storage unavailable"); });
  await renderWithStudio(<UpgradeRecovery record={record("proposed")} online runtime={r.api} />);
  expect(r.discardUpgradeProposal).not.toHaveBeenCalled();
  await page.getByRole("button", { name: "Discard upgrade proposal", exact: true }).click();
  expect(r.discardUpgradeProposal).toHaveBeenCalledWith(11155111, ADDRESS);
  await expect.element(page.getByRole("textbox", { name: "Executed transaction hash" })).toHaveAccessibleDescription(/couldn't be updated/);
});

test("legacy missing intent, read-only and offline states explain why recovery cannot start", async () => {
  const r = runtime();
  const saved = record();
  delete saved.pendingUpgrade!.call;
  await renderWithStudio(<UpgradeRecovery record={saved} online runtime={r.api} />);
  await expect.element(page.getByRole("button", { name: "Observe transaction", exact: true })).toHaveAccessibleDescription(/no exact call to verify/);
  session.set({ readOnly: "Another tab is editing this project." });
  await expect.element(page.getByRole("button", { name: "Observe transaction", exact: true })).toHaveAccessibleDescription("Another tab is editing this project.");
  expect(r.resumeUpgrade).not.toHaveBeenCalled();
});

test("phone recovery retains the saved target without overflow and passes axe", async () => {
  await page.viewport(320, 740);
  const r = runtime();
  await renderWithStudio(<main><UpgradeRecovery record={record("verifying", HASH)} online runtime={r.api} /></main>);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
  expect(await axeViolations(document.querySelector("main")!)).toEqual([]);
});
