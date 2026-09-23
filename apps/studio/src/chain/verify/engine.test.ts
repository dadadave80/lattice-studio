/**
 * The verify engine against recorded Sourcify v2 responses for every outcome (exact match, match, a compilation
 * error, a completed job with no match, a submit rejection, a network failure and a timeout), the write-merge
 * rule (a concurrent write to the same record keeps its own fields), retry, and the shared in-flight set that
 * keeps the watcher and a retry from submitting the same record twice.
 */
import { describe, expect, test } from "bun:test";
import type { Address, Deployment, Result } from "@lattice-studio/core";
import { bufferedServices, clearServiceBuffers } from "@/contracts/services";
import { retryVerification, verifyIfNeeded, verifyingNow, verifyRecord } from "./engine";
import type { ProxyBuild, VerifyDeps, VerifyFetch } from "./ports";
import { flush, manualClock, memoryRecords, type FakeRecords, type ManualClock } from "./testing";

const CHAIN_ID = 11155111;
const ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as Address;
const BASE = "https://sourcify.test";

function confirmed(overrides: Partial<Deployment> = {}): Deployment {
  return {
    projectId: "p1",
    chainId: CHAIN_ID,
    address: ADDRESS,
    path: "factory",
    deployer: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address,
    salt: "0x0102030405060708090a0b0c0d0e0f10111213" as `0x${string}`,
    status: "confirmed",
    tx: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`,
    recipeHash: "0x01" as `0x${string}`,
    catalogHash: "0x02" as `0x${string}`,
    at: "2026-09-23T12:00:00.000Z",
    verification: "pending",
    revision: 1,
    ...overrides,
  };
}

const OK_BUILD: Result<ProxyBuild, string> = { ok: true, value: { stdJsonInput: { language: "Solidity" }, compilerVersion: "0.8.36" } };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** POST always accepted; each GET call advances through `pollBodies`, repeating the last one. */
function scriptedFetch(pollBodies: (() => Response)[]): { fetchImpl: VerifyFetch; posts(): number } {
  let posts = 0;
  let polls = 0;
  const fetchImpl: VerifyFetch = async (input, init) => {
    if (init?.method === "POST") {
      posts += 1;
      return json(202, { verificationId: "job-1" });
    }
    void input;
    const body = pollBodies[Math.min(polls, pollBodies.length - 1)];
    polls += 1;
    return body ? body() : json(200, { isJobCompleted: false });
  };
  return { fetchImpl, posts: () => posts };
}

function deps(fetchImpl: VerifyFetch, records: FakeRecords, clock: ManualClock, build: Result<ProxyBuild, string> = OK_BUILD): VerifyDeps {
  return { fetchImpl, clock, records, baseUrl: BASE, projectId: () => "p1", proxyBuild: async () => build };
}

/** Drives `verifyRecord` to completion, advancing the manual clock between polls. */
async function run(promise: Promise<void>, clock: ManualClock, ticks: number[]): Promise<void> {
  await flush();
  for (const ms of ticks) {
    clock.advance(ms);
    await flush();
  }
  await promise;
}

describe("verifyRecord", () => {
  test("an exact match writes exact_match and logs Verified", async () => {
    clearServiceBuffers();
    const { fetchImpl } = scriptedFetch([
      () => json(200, { isJobCompleted: false }),
      () => json(200, { isJobCompleted: true, contract: { runtimeMatch: "exact_match" } }),
    ]);
    const records = memoryRecords([confirmed()]);
    const clock = manualClock();
    await run(verifyRecord(deps(fetchImpl, records, clock), confirmed()), clock, [2_000]);
    expect(records.all()[0]?.verification).toBe("exact_match");
    expect(bufferedServices().log.at(-1)).toMatchObject({ tag: "Verify", text: "Verified on Sourcify (exact match)." });
  });

  test("a partial runtime match writes match, not exact_match", async () => {
    clearServiceBuffers();
    const { fetchImpl } = scriptedFetch([() => json(200, { isJobCompleted: true, contract: { runtimeMatch: "match" } })]);
    const records = memoryRecords([confirmed()]);
    const clock = manualClock();
    await run(verifyRecord(deps(fetchImpl, records, clock), confirmed()), clock, []);
    expect(records.all()[0]?.verification).toBe("match");
    expect(bufferedServices().log.at(-1)).toMatchObject({ text: "Verified on Sourcify (match)." });
  });

  test("a compilation error is written as failed, with Sourcify's reason logged", async () => {
    clearServiceBuffers();
    const { fetchImpl } = scriptedFetch([
      () => json(200, { isJobCompleted: true, error: { customCode: "compilation_error", message: "Compilation failed." } }),
    ]);
    const records = memoryRecords([confirmed()]);
    const clock = manualClock();
    await run(verifyRecord(deps(fetchImpl, records, clock), confirmed()), clock, []);
    expect(records.all()[0]?.verification).toBe("failed");
    expect(bufferedServices().log.at(-1)).toMatchObject({ tag: "Verify", text: "Couldn't verify: Compilation failed." });
  });

  test("a completed job with no match at all is failed with our own reason", async () => {
    clearServiceBuffers();
    const { fetchImpl } = scriptedFetch([() => json(200, { isJobCompleted: true, contract: { runtimeMatch: null } })]);
    const records = memoryRecords([confirmed()]);
    const clock = manualClock();
    await run(verifyRecord(deps(fetchImpl, records, clock), confirmed()), clock, []);
    expect(records.all()[0]?.verification).toBe("failed");
    expect(bufferedServices().log.at(-1)?.text).toBe("Couldn't verify: Sourcify found no match for this contract.");
  });

  test("a rejected submission never polls, and is written as failed", async () => {
    clearServiceBuffers();
    let posts = 0;
    const fetchImpl: VerifyFetch = async (_input, init) => {
      if (init?.method === "POST") {
        posts += 1;
        return json(400, { error: { message: "compilerVersion is not a valid version." } });
      }
      throw new Error("shouldn't poll after a rejected submission");
    };
    const records = memoryRecords([confirmed()]);
    const clock = manualClock();
    await verifyRecord(deps(fetchImpl, records, clock), confirmed());
    expect(posts).toBe(1);
    expect(records.all()[0]?.verification).toBe("failed");
    expect(bufferedServices().log.at(-1)?.text).toBe("Couldn't verify: compilerVersion is not a valid version.");
  });

  test("the proxy's standard JSON not loading fails without ever calling Sourcify", async () => {
    clearServiceBuffers();
    const fetchImpl: VerifyFetch = async () => {
      throw new Error("shouldn't call Sourcify");
    };
    const records = memoryRecords([confirmed()]);
    const clock = manualClock();
    const failing = deps(fetchImpl, records, clock, { ok: false, error: "The catalog hasn't loaded." });
    await verifyRecord(failing, confirmed());
    expect(records.all()[0]?.verification).toBe("failed");
    expect(bufferedServices().log.at(-1)?.text).toBe("Couldn't verify: The catalog hasn't loaded.");
  });

  test("a network failure on poll is terminal, not a spin loop", async () => {
    clearServiceBuffers();
    let posts = 0;
    let polls = 0;
    const fetchImpl: VerifyFetch = async (_input, init) => {
      if (init?.method === "POST") {
        posts += 1;
        return json(202, { verificationId: "job-1" });
      }
      polls += 1;
      throw new Error("offline");
    };
    const records = memoryRecords([confirmed()]);
    const clock = manualClock();
    await verifyRecord(deps(fetchImpl, records, clock), confirmed());
    expect(polls).toBe(1);
    expect(records.all()[0]?.verification).toBe("failed");
    expect(bufferedServices().log.at(-1)?.text).toBe("Couldn't verify: offline.");
  });

  test("gives up after its poll timeout, rather than polling forever", async () => {
    clearServiceBuffers();
    const { fetchImpl } = scriptedFetch([() => json(200, { isJobCompleted: false })]);
    const records = memoryRecords([confirmed()]);
    const clock = manualClock();
    // Six backoff steps (2s..21s, the last repeating) comfortably clear the 5-minute timeout.
    await run(verifyRecord(deps(fetchImpl, records, clock), confirmed()), clock, Array(20).fill(21_000));
    expect(records.all()[0]?.verification).toBe("failed");
    expect(bufferedServices().log.at(-1)?.text).toBe("Couldn't verify: Sourcify didn't finish in time.");
  });

  test("write-merge: a concurrent write to the record's other fields survives the verification write", async () => {
    clearServiceBuffers();
    const { fetchImpl } = scriptedFetch([() => json(200, { isJobCompleted: true, contract: { runtimeMatch: "exact_match" } })]);
    const records = memoryRecords([confirmed()]);
    const clock = manualClock();
    // S8c updates `block` on the same record while our job is in flight.
    records.set({ ...confirmed(), block: 9_123_460 });
    await run(verifyRecord(deps(fetchImpl, records, clock), confirmed()), clock, []);
    const written = records.all()[0];
    expect(written?.verification).toBe("exact_match");
    expect(written?.block).toBe(9_123_460);
  });

  test("a record that moved off confirmed (mismatch, a new deploy) is left untouched, and nothing is logged", async () => {
    clearServiceBuffers();
    const { fetchImpl } = scriptedFetch([() => json(200, { isJobCompleted: true, contract: { runtimeMatch: "exact_match" } })]);
    const records = memoryRecords([confirmed({ status: "mismatch" })]);
    const clock = manualClock();
    await run(verifyRecord(deps(fetchImpl, records, clock), confirmed()), clock, []);
    expect(records.all()[0]?.verification).toBe("pending");
    expect(bufferedServices().log.length).toBe(0);
  });

  test("a discarded record (gone from the store) is left alone", async () => {
    clearServiceBuffers();
    const { fetchImpl } = scriptedFetch([() => json(200, { isJobCompleted: true, contract: { runtimeMatch: "match" } })]);
    const records = memoryRecords([]);
    const clock = manualClock();
    await run(verifyRecord(deps(fetchImpl, records, clock), confirmed()), clock, []);
    expect(records.all()).toEqual([]);
    expect(bufferedServices().log.length).toBe(0);
  });
});

describe("verifyIfNeeded", () => {
  test("skips a record whose job is already running", async () => {
    clearServiceBuffers();
    const { fetchImpl, posts } = scriptedFetch([
      () => json(200, { isJobCompleted: false }),
      () => json(200, { isJobCompleted: true, contract: { runtimeMatch: "exact_match" } }),
    ]);
    const records = memoryRecords([confirmed()]);
    const clock = manualClock();
    const first = verifyIfNeeded(deps(fetchImpl, records, clock), confirmed());
    await flush();
    expect(verifyingNow(confirmed())).toBe(true);
    // A second call while the first is in flight (the watcher's subscription firing again) does nothing new.
    await verifyIfNeeded(deps(fetchImpl, records, clock), confirmed());
    expect(posts()).toBe(1);
    await run(first, clock, [2_000]);
    expect(verifyingNow(confirmed())).toBe(false);
    expect(records.all()[0]?.verification).toBe("exact_match");
  });
});

describe("retryVerification", () => {
  test("writes verification back to pending and starts a fresh job for it", async () => {
    clearServiceBuffers();
    const failedRecord = confirmed({ verification: "failed" });
    const { fetchImpl } = scriptedFetch([() => json(200, { isJobCompleted: true, contract: { runtimeMatch: "exact_match" } })]);
    const records = memoryRecords([failedRecord]);
    const clock = manualClock();
    const target = { chainId: CHAIN_ID, address: ADDRESS };
    await retryVerification(target, deps(fetchImpl, records, clock));
    await flush();
    // retryVerification writes "pending" itself (so "Verifying" shows at once) before the job's own write.
    expect(records.writes()).toEqual(["pending", "exact_match"]);
    expect(records.all()[0]?.verification).toBe("exact_match");
  });

  test("says so, without writing anything, when the record isn't confirmed", async () => {
    clearServiceBuffers();
    const records = memoryRecords([confirmed({ status: "pending", verification: "pending" })]);
    const clock = manualClock();
    const fetchImpl: VerifyFetch = async () => {
      throw new Error("shouldn't call Sourcify");
    };
    await retryVerification({ chainId: CHAIN_ID, address: ADDRESS }, deps(fetchImpl, records, clock));
    expect(records.all()[0]?.verification).toBe("pending");
    expect(bufferedServices().log.at(-1)?.text).toBe("Only a confirmed deployment can be verified.");
  });
});
