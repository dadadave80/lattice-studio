import { describe, expect, test } from "bun:test";
import type { Result } from "@lattice-studio/core";
import type { DiamondCutHistory, HistoryReadError } from "@/contracts/chain";
import { createHistoryController, type HistoryTarget } from "./history-state";
import { getHyperRpcToken, setHyperRpcToken } from "./history-runtime";
import { settings } from "@/contracts";
import { exportProjectFile } from "@lattice-studio/core";
import { makeProject } from "@lattice-studio/core/testing";

const target: HistoryTarget = { chainId: 11155111, address: "0x00000000000000000000000000000000000000AA", block: 5, blockHash: `0x${"05".repeat(32)}`, identity: "observed-facts" };
const data = (): DiamondCutHistory => ({ chainId: target.chainId, address: target.address, history: [], source: "rpc", fromBlock: 1, toBlock: 5, blockHash: target.blockHash, coverage: "range", deployment: null });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }

describe("history session state", () => {
  test("stable snapshots are lazy, and partial or unverified history never attaches claims", async () => {
    let reads = 0; let attached = 0;
    let result = data();
    const controller = createHistoryController({ read: async () => { reads++; return { ok: true, value: result }; }, attach: () => { attached++; return true; } });
    expect(controller.get(target)).toBe(controller.get(target));
    expect(reads).toBe(0);
    await controller.read(target, { fromBlock: 1 });
    expect(controller.get(target).status).toBe("ready");
    expect(attached).toBe(0);
    result = { ...data(), coverage: "full", fromBlock: 0 };
    await controller.read(target);
    expect(attached).toBe(0);
    controller.dispose();
  });

  test("explicit retry supersedes old work and cancellation drops late results", async () => {
    const reads = [deferred<Result<DiamondCutHistory, HistoryReadError>>(), deferred<Result<DiamondCutHistory, HistoryReadError>>()];
    let index = 0;
    const controller = createHistoryController({ read: () => reads[index++]!.promise, attach: () => true });
    const first = controller.read(target);
    const second = controller.read(target);
    reads[1]!.resolve({ ok: true, value: data() }); await second;
    reads[0]!.resolve({ ok: false, error: { kind: "rpc", reason: "Old failure." } }); await first;
    expect(controller.get(target).status).toBe("ready");
    const held = deferred<Result<DiamondCutHistory, HistoryReadError>>();
    const canceled = createHistoryController({ read: () => held.promise, attach: () => true });
    const running = canceled.read(target);
    canceled.cancel(target);
    held.resolve({ ok: true, value: data() }); await running;
    expect(canceled.get(target).status).toBe("not-read");
    controller.dispose(); canceled.dispose();
  });

  test("provider exception details and stale snapshot results never become ready", async () => {
    const controller = createHistoryController({ read: async () => { throw new Error("https://private.example/secret-token"); }, attach: () => true });
    await controller.read(target);
    expect(JSON.stringify(controller.get(target))).not.toContain("secret-token");
    controller.dispose();
    const stale = createHistoryController({ read: async () => ({ ok: true, value: { ...data(), blockHash: `0x${"ab".repeat(32)}` } }), attach: () => true });
    await stale.read(target);
    expect(stale.get(target).status).toBe("error");
    stale.dispose();
  });

  test("the HyperRPC token stays out of settings and project exports", () => {
    const previous = getHyperRpcToken();
    const secret = "session-only-history-test-token";
    try {
      expect(setHyperRpcToken(secret).ok).toBe(true);
      expect(getHyperRpcToken()).toBe(secret);
      expect(JSON.stringify(settings.get())).not.toContain(secret);
      expect(exportProjectFile(makeProject(), []).text).not.toContain(secret);
      const invalid = setHyperRpcToken(`${secret}\nembedded`);
      expect(invalid.ok).toBe(false);
      expect(JSON.stringify(invalid)).not.toContain(secret);
    } finally { setHyperRpcToken(previous); }
  });
});
