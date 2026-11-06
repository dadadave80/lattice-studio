import { recipeHash, type UpgradeCut } from "@lattice-studio/core";
import { afterEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { doc, session } from "@/contracts";
import { DialogHost } from "@/ui/overlays/DialogHost";
import { axeViolations } from "@/ui/testing/axe";
import { renderWithStudio } from "../../../../test/harness";
import type { UpgradeReviewDetails } from "../upgrade-review-ports";
import { finishUpgradeReview, openUpgradeReview } from "./review";

const ADDRESS = "0x00000000000000000000000000000000000000aa";
const FACET = "0x00000000000000000000000000000000000000bb";
const ZERO = "0x0000000000000000000000000000000000000000";
const ACK = "I understand retained code has not been checked for storage, initializer or authority compatibility.";

function details(patch: Partial<UpgradeReviewDetails> = {}): UpgradeReviewDetails {
  return {
    projectId: doc.get().id, recipeHash: recipeHash(doc.get().recipe), catalogHash: doc.get().recipe.catalog.hash,
    chainId: 11155111, chainName: "Sepolia", diamond: ADDRESS, from: ADDRESS, baselineBlock: 100, observedBlock: 123,
    cuts: [{ action: 0, facetAddress: FACET, functionSelectors: ["0x12345678"] }, { action: 1, facetAddress: FACET, functionSelectors: ["0xdeadbeef"] }, { action: 2, facetAddress: ZERO, functionSelectors: ["0xffffffff"] }] satisfies UpgradeCut[],
    init: { target: ZERO, data: "0x", steps: [] }, authority: { kind: "safe", explanation: "The stored upgrade authority is a Safe. Export a proposal for that Safe.", canSign: false },
    opaque: [{ kind: "foreign", label: "Foreign facet", address: FACET, codehash: `0x${"12".repeat(32)}`, selectors: ["0x12345678"] }], requiresOpaqueAcknowledgement: true, ...patch,
  };
}

afterEach(async () => { finishUpgradeReview({ accepted: false, opaqueAcknowledged: false }); await page.viewport(1440, 900); });

test("reviews stored target and exact cuts, requiring explicit retained-code acknowledgement", async () => {
  await renderWithStudio(<DialogHost />);
  const before = doc.get();
  const pending = openUpgradeReview(details());
  const dialog = page.getByRole("dialog", { name: "Review upgrade", exact: true });
  await expect.element(dialog).toBeVisible();
  await expect.element(dialog.getByText("1 Add · 1 Replace · 1 Remove", { exact: true })).toBeVisible();
  await expect.element(dialog.getByText("No initializer requested.", { exact: true })).toBeVisible();
  const next = dialog.getByRole("button", { name: "Continue to transaction review", exact: true });
  await expect.element(next).toHaveAttribute("aria-disabled", "true");
  await dialog.getByRole("checkbox", { name: ACK }).click();
  await next.click();
  expect(await pending).toEqual({ accepted: true, opaqueAcknowledged: true });
  expect(doc.get()).toBe(before);
});

test("Escape cancels without accepting and explicit new initializer details remain readable", async () => {
  await renderWithStudio(<DialogHost />);
  const pending = openUpgradeReview(details({ init: { target: FACET, data: "0x12345678", steps: ["NewTokenInit"] } }));
  const dialog = page.getByRole("dialog", { name: "Review upgrade", exact: true });
  await expect.element(dialog.getByText("NewTokenInit", { exact: true })).toBeVisible();
  await userEvent.keyboard("{Escape}");
  expect(await pending).toEqual({ accepted: false, opaqueAcknowledged: false });
});

test("changing project or becoming read-only blocks acceptance", async () => {
  await renderWithStudio(<DialogHost />);
  const pending = openUpgradeReview(details({ requiresOpaqueAcknowledgement: false }));
  const dialog = page.getByRole("dialog", { name: "Review upgrade", exact: true });
  await expect.element(dialog).toBeVisible();
  doc.load({ ...doc.get(), id: "another-project" });
  await expect.element(dialog.getByRole("region", { name: "Plan status" }).getByRole("status")).toHaveTextContent("The plan changed. Close this review and run Upgrade again.");
  session.set({ readOnly: "Another tab is editing this project." });
  await expect.element(dialog.getByRole("button", { name: "Continue to transaction review", exact: true })).toHaveAccessibleDescription("Another tab is editing this project.");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await pending).accepted).toBe(false);
});

test("phone upgrade review fits 320 px and passes axe", async () => {
  await page.viewport(320, 740);
  await renderWithStudio(<DialogHost />);
  const pending = openUpgradeReview(details());
  const dialog = page.getByRole("dialog", { name: "Review upgrade", exact: true });
  await expect.element(dialog).toBeVisible();
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
  expect(await axeViolations(dialog.element())).toEqual([]);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await pending;
});
