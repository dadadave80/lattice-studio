import { describe, expect, test } from "bun:test";
import { encodeAbiParameters, encodeErrorResult, parseAbi } from "viem";
import { err, ok, type Address, type Hex } from "@lattice-studio/core";
import { routedFunctions } from "./abi";
import { createCallController, type CallContext, type CallPorts } from "./calls";

const ADDRESS: Address = "0x00000000000000000000000000000000000000aa";
const USER: Address = "0x00000000000000000000000000000000000000bb";
const abi = parseAbi(["function balanceOf(address account) view returns (uint256 balance)", "error Denied(address caller)"]);
const context: CallContext = {
  chainId: 11155111, address: ADDRESS, block: 123, blockHash: `0x${"12".repeat(32)}`, identity: "snapshot1:abi1",
  fn: routedFunctions(abi, ["0x70a08231"])[0]!, abi,
};
const output = encodeAbiParameters([{ type: "uint256" }], [9007199254740993n]);
const ports = (patch: Partial<CallPorts> = {}): CallPorts => ({
  call: async () => ok(output), resolve: async () => ok(USER), ...patch,
});

describe("independent call session", () => {
  test("resolves addresses on the inspected chain and pins the call to the observed hash", async () => {
    const called: unknown[] = [];
    const names: unknown[] = [];
    const calls = createCallController(ports({
      resolve: async (...args) => { names.push(args); return ok(USER); },
      call: async (...args) => { called.push(args); return ok(output); },
    }));
    calls.patch(context, { args: ["alice.eth"], caller: "bob.eth" });
    await calls.run(context);
    expect(names).toEqual([["alice.eth", 11155111], ["bob.eth", 11155111]]);
    expect(called).toEqual([[11155111, ADDRESS, `0x70a0823100000000000000000000000000000000000000000000000000000000000000bb`, { blockHash: context.blockHash, from: USER, value: 0n }]]);
    expect(calls.get(context)).toMatchObject({ phase: "success", result: { outputs: [{ name: "balance", value: "9007199254740993" }], raw: output } });
  });
  test("validates before calling and reports a field or ENS failure without leaking provider text", async () => {
    let called = 0;
    const calls = createCallController(ports({ call: async () => { called++; return ok(output); }, resolve: async () => ok(null) }));
    calls.patch(context, { args: ["not an address"] });
    await calls.run(context);
    expect(calls.get(context).fieldErrors[0]).toBeDefined();
    calls.patch(context, { args: ["alice.eth"] });
    await calls.run(context);
    expect(calls.get(context).fieldErrors[0]).toContain("No address");
    expect(called).toBe(0);
  });
  test("edits discard delayed call and ENS completions", async () => {
    let finish!: (value: Awaited<ReturnType<CallPorts["call"]>>) => void;
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => { started = resolve; });
    const calls = createCallController(ports({ call: () => new Promise((resolve) => { finish = resolve; started(); }) }));
    calls.patch(context, { args: [USER] });
    const running = calls.run(context);
    await waiting;
    calls.patch(context, { args: [ADDRESS] });
    finish(ok(output));
    await running;
    expect(calls.get(context).phase).toBe("idle");
    expect(calls.get(context).draft.args).toEqual([ADDRESS]);
  });
  test("refresh invalidates results while retaining drafts; caller and args isolate cache", async () => {
    let reads = 0;
    const calls = createCallController(ports({ call: async () => { reads++; return ok(output); } }));
    calls.patch(context, { args: [USER] });
    await calls.run(context);
    await calls.run(context);
    expect(reads).toBe(1);
    const refreshed = { ...context, identity: "snapshot2:abi1", blockHash: `0x${"23".repeat(32)}` as Hex };
    expect(calls.get(refreshed)).toMatchObject({ phase: "idle", draft: { args: [USER] } });
    await calls.run(refreshed);
    calls.patch(refreshed, { caller: USER });
    await calls.run(refreshed);
    calls.patch(refreshed, { args: [ADDRESS] });
    await calls.run(refreshed);
    expect(reads).toBe(4);
  });
  test("keeps exact custom revert data and distinguishes undecodable results", async () => {
    const data = encodeErrorResult({ abi, errorName: "Denied", args: [USER] });
    const calls = createCallController(ports({ call: async () => err({ reason: "Reverted", data }) }));
    calls.patch(context, { args: [USER] });
    await calls.run(context);
    expect(calls.get(context)).toMatchObject({ phase: "revert", revert: { raw: data, errorName: "Denied" } });
    const broken = createCallController(ports({ call: async () => ok("0x01") }));
    broken.patch(context, { args: [USER] });
    await broken.run(context);
    expect(broken.get(context)).toMatchObject({ phase: "error", raw: "0x01" });
  });
  test("different chain/diamond/function sessions preserve separate drafts", () => {
    const calls = createCallController(ports());
    calls.patch(context, { args: [USER] });
    expect(calls.get({ ...context, chainId: 84532 }).draft.args).toEqual([""]);
    expect(calls.get({ ...context, address: USER }).draft.args).toEqual([""]);
    expect(calls.get(context).draft.args).toEqual([USER]);
  });
});
