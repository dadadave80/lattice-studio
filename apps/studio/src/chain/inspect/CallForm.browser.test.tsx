import { encodeAbiParameters, encodeErrorResult, parseAbi, toFunctionSelector } from "viem";
import { err, ok, type Hex } from "@lattice-studio/core";
import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { doc } from "@/contracts";
import { axeViolations } from "@/ui/testing/axe";
import { onCleanup, renderWithStudio } from "../../../test/harness";
import { routedFunctions } from "./abi";
import { createCallController, type CallContext, type CallPorts } from "./calls";
import { CallForm } from "./CallForm";

const ADDRESS = "0x00000000000000000000000000000000000000aa";
const USER = "0x00000000000000000000000000000000000000bb";
const abi = parseAbi(["function balanceOf(address account) view returns (uint256 balance)", "error Denied(address caller)"]);
const context: CallContext = { chainId: 11155111, address: ADDRESS, identity: "snapshot1:abi1", block: 123, blockHash: `0x${"12".repeat(32)}`, fn: routedFunctions(abi, ["0x70a08231"])[0]!, abi };
const output = encodeAbiParameters([{ type: "uint256" }], [9007199254740993n]);

function controller(patch: Partial<CallPorts> = {}) {
  const call = vi.fn<CallPorts["call"]>(async () => ok(output));
  const resolve = vi.fn<CallPorts["resolve"]>(async () => ok(USER));
  const calls = createCallController({ call, resolve, ...patch });
  onCleanup(() => calls.dispose());
  return { calls, call, resolve };
}

afterEach(async () => { vi.restoreAllMocks(); await page.viewport(1440, 900); });

test("a wallet-free call resolves ENS on the inspected chain and preserves bigint output", async () => {
  const { calls, call, resolve } = controller();
  await renderWithStudio(<CallForm context={context} controller={calls} />);
  const before = doc.get();
  await page.getByRole("textbox", { name: "account (address)" }).fill("alice.eth");
  await page.getByRole("button", { name: "Call", exact: true }).click();
  await expect.element(page.getByText("9007199254740993", { exact: true })).toBeVisible();
  expect(resolve).toHaveBeenCalledWith("alice.eth", 11155111);
  expect(call.mock.calls[0]?.[1]).toBe(ADDRESS);
  expect(call.mock.calls[0]?.[3]).toEqual({ blockHash: context.blockHash, value: 0n });
  expect(doc.get()).toBe(before);
});

test("shows field validation and can retry after fixing an invalid address", async () => {
  const { calls, call } = controller();
  await renderWithStudio(<CallForm context={context} controller={calls} />);
  await page.getByRole("button", { name: "Call", exact: true }).click();
  await expect.element(page.getByRole("textbox", { name: "account (address)" })).toHaveAttribute("aria-invalid", "true");
  expect(call).not.toHaveBeenCalled();
  await page.getByRole("textbox", { name: "account (address)" }).fill(USER);
  await page.getByRole("button", { name: "Call", exact: true }).click();
  await expect.element(page.getByText("9007199254740993", { exact: true })).toBeVisible();
});

test("changing fields discards a delayed result and keeps the edited draft", async () => {
  let finish!: (result: Awaited<ReturnType<CallPorts["call"]>>) => void;
  const { calls } = controller({ call: () => new Promise((resolve) => { finish = resolve; }) });
  await renderWithStudio(<CallForm context={context} controller={calls} />);
  await page.getByRole("textbox", { name: "account (address)" }).fill(USER);
  await page.getByRole("button", { name: "Call", exact: true }).click();
  await expect.element(page.getByRole("status")).toHaveTextContent("Calling the diamond…");
  await page.getByRole("textbox", { name: "account (address)" }).fill(ADDRESS);
  finish(ok(output));
  await expect.poll(() => calls.get(context).phase).toBe("idle");
  expect(calls.get(context).result).toBeNull();
});

test("decodes a custom revert and retains its complete raw bytes", async () => {
  const data = encodeErrorResult({ abi, errorName: "Denied", args: [USER] });
  const { calls } = controller({ call: async () => err({ reason: "The call reverted.", data }) });
  await renderWithStudio(<CallForm context={context} controller={calls} />);
  await page.getByRole("textbox", { name: "account (address)" }).fill(USER);
  await page.getByRole("button", { name: "Call", exact: true }).click();
  await expect.element(page.getByText("Denied", { exact: true })).toBeVisible();
  await page.getByText("Raw revert data", { exact: true }).click();
  await expect.element(page.getByText(data, { exact: true })).toBeVisible();
});

test("write preparation validates exact payable wei and hands off immutable calldata", async () => {
  const payableAbi = parseAbi(["function deposit(uint256) payable"]);
  const item = payableAbi[0]!;
  const write: CallContext = { ...context, abi: payableAbi, fn: routedFunctions(payableAbi, [toFunctionSelector(item) as Hex])[0]! };
  const { calls, call } = controller();
  const review = vi.fn();
  await renderWithStudio(<CallForm context={write} controller={calls} onReview={review} />);
  const before = doc.get();
  await page.getByRole("textbox", { name: "Argument 1 (uint256)" }).fill("9007199254740993");
  await page.getByRole("textbox", { name: "Value (wei)" }).fill("1.5");
  await page.getByRole("button", { name: "Review transaction", exact: true }).click();
  await expect.element(page.getByRole("textbox", { name: "Value (wei)" })).toHaveAttribute("aria-invalid", "true");
  expect(review).not.toHaveBeenCalled();
  await page.getByRole("textbox", { name: "Value (wei)" }).fill("9007199254740993");
  await page.getByRole("button", { name: "Review transaction", exact: true }).click();
  await expect.poll(() => review.mock.calls.length).toBe(1);
  expect(review.mock.calls[0]?.[0].value).toBe(9007199254740993n);
  expect(call).not.toHaveBeenCalled();
  expect(doc.get()).toBe(before);
});

test("phone form and long results fit 320 px and pass axe", async () => {
  await page.viewport(320, 740);
  const { calls } = controller();
  await renderWithStudio(<main><CallForm context={context} controller={calls} /></main>);
  await page.getByRole("textbox", { name: "account (address)" }).fill(USER);
  await page.getByRole("button", { name: "Call", exact: true }).click();
  await expect.element(page.getByText("9007199254740993", { exact: true })).toBeVisible();
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
  expect(await axeViolations(document.querySelector("main")!)).toEqual([]);
});
