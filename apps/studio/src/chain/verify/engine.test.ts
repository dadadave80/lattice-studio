/**
 * The verify engine against recorded Sourcify v2 responses for every outcome (exact match, match, a compilation
 * error, a completed job with no match, a submit rejection, a network failure and a timeout), the write-merge
 * rule (a concurrent write to the same record keeps its own fields), retry, and the shared in-flight set that
 * keeps the watcher and a retry from submitting the same record twice. Then the Etherscan leg beside it: every
 * outcome, that neither verifier blocks or fails the other, and that the API key reaches nothing but the request.
 */
import { describe, expect, test } from "bun:test";
import type { Address, Deployment, Result } from "@lattice-studio/core";
import { bufferedServices, clearServiceBuffers } from "@/contracts/services";
import { retryVerification, verifyIfNeeded, verifyingNow, verifyRecord } from "./engine";
import { etherscanOutcomes } from "./etherscan-outcomes";
import type { ProxyBuild, VerifyDeps, VerifyFetch } from "./ports";
import { flush, manualClock, memoryRecords, type FakeRecords, type ManualClock } from "./testing";

const CHAIN_ID = 11155111;
const ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as Address;
const BASE = "https://sourcify.test";
const ETHERSCAN = "https://etherscan.test/v2/api";
const KEY = "TESTKEY-abc123XYZ";

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
  return {
    fetchImpl, clock, records, baseUrl: BASE, projectId: () => "p1", proxyBuild: async () => build,
    etherscanKey: () => undefined, etherscanBaseUrl: ETHERSCAN,
  };
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

  test("a compilation error is written as failed, with Sourcify's reason logged and stored (FX20 follow-up)", async () => {
    clearServiceBuffers();
    const { fetchImpl } = scriptedFetch([
      () => json(200, { isJobCompleted: true, error: { customCode: "compilation_error", message: "Compilation failed." } }),
    ]);
    const records = memoryRecords([confirmed()]);
    const clock = manualClock();
    await run(verifyRecord(deps(fetchImpl, records, clock), confirmed()), clock, []);
    expect(records.all()[0]?.verification).toBe("failed");
    // `verificationReason` (spec L606) carries the same text as the logged line, for FX21's inspector.
    expect(records.all()[0]?.verificationReason).toBe("Compilation failed.");
    expect(bufferedServices().log.at(-1)).toMatchObject({ tag: "Verify", text: "Couldn't verify: Compilation failed." });
  });

  test("a later match clears a previously stored verificationReason (FX20 follow-up)", async () => {
    clearServiceBuffers();
    const { fetchImpl } = scriptedFetch([() => json(200, { isJobCompleted: true, contract: { runtimeMatch: "exact_match" } })]);
    const records = memoryRecords([confirmed({ verification: "failed", verificationReason: "Compilation failed." })]);
    const clock = manualClock();
    await run(verifyRecord(deps(fetchImpl, records, clock), confirmed({ verification: "failed", verificationReason: "Compilation failed." })), clock, []);
    expect(records.all()[0]?.verification).toBe("exact_match");
    expect(records.all()[0]?.verificationReason).toBeUndefined();
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

  test("never calls Sourcify for a chain it doesn't serve (Anvil, e2e's own chain)", async () => {
    clearServiceBuffers();
    const fetchImpl: VerifyFetch = async () => {
      throw new Error("shouldn't call Sourcify");
    };
    const records = memoryRecords([confirmed({ chainId: 31337 })]);
    const clock = manualClock();
    await verifyRecord(deps(fetchImpl, records, clock), confirmed({ chainId: 31337 }));
    expect(records.all()[0]?.verification).toBe("failed");
    expect(bufferedServices().log.at(-1)?.text).toBe("Couldn't verify: Sourcify doesn't verify contracts on Anvil.");
  });

  test("a dispose mid-poll stops the calls, and leaves the record pending for the next watcher", async () => {
    clearServiceBuffers();
    let polls = 0;
    const fetchImpl: VerifyFetch = async (_input, init) => {
      if (init?.method === "POST") return json(202, { verificationId: "job-1" });
      polls += 1;
      return json(200, { isJobCompleted: false });
    };
    const records = memoryRecords([confirmed()]);
    const clock = manualClock();
    const controller = new AbortController();
    const promise = verifyRecord(deps(fetchImpl, records, clock), confirmed(), controller.signal);
    await flush(); // submit, then the first poll, then it's waiting out the backoff
    expect(polls).toBe(1);
    controller.abort();
    clock.advance(2_000); // the backoff `wait()` resolves at once on abort
    await flush();
    await promise;
    expect(polls).toBe(1); // no second poll after the abort
    expect(records.all()[0]?.verification).toBe("pending"); // untouched: the next watcher resumes it
    expect(bufferedServices().log.length).toBe(0);
  });

  test("a write the browser refuses is logged and announced, an interrupt (spec L785)", async () => {
    clearServiceBuffers();
    const { fetchImpl } = scriptedFetch([() => json(200, { isJobCompleted: true, contract: { runtimeMatch: "exact_match" } })]);
    const base = memoryRecords([confirmed()]);
    const records = { ...base, put: async () => { throw new Error("storage full"); } };
    const clock = manualClock();
    await run(verifyRecord(deps(fetchImpl, records, clock), confirmed()), clock, []);
    expect(bufferedServices().log.at(-1)).toMatchObject({ tag: "Error", text: "The verification result wasn't saved: storage full" });
    expect(bufferedServices().announce.at(-1)).toEqual([
      "The verification result wasn't saved: storage full", { politeness: "assertive" },
    ]);
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
  test("clears a stale verificationReason when it reopens a failed record (FX20 follow-up)", async () => {
    clearServiceBuffers();
    const failedRecord = confirmed({ verification: "failed", verificationReason: "Compilation failed." });
    const { fetchImpl } = scriptedFetch([() => json(200, { isJobCompleted: true, contract: { runtimeMatch: "exact_match" } })]);
    const records = memoryRecords([failedRecord]);
    const clock = manualClock();
    const target = { chainId: CHAIN_ID, address: ADDRESS };
    await retryVerification(target, deps(fetchImpl, records, clock));
    // The "pending" write retryVerification makes itself already drops the old reason, before the job's own write.
    expect(records.all()[0]?.verificationReason).toBeUndefined();
    await flush();
    expect(records.all()[0]?.verification).toBe("exact_match");
    expect(records.all()[0]?.verificationReason).toBeUndefined();
  });

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

  test("refuses a record still being verified, rather than starting a second job", async () => {
    clearServiceBuffers();
    const records = memoryRecords([confirmed({ verification: "pending" })]);
    const clock = manualClock();
    const fetchImpl: VerifyFetch = async () => {
      throw new Error("shouldn't call Sourcify");
    };
    await retryVerification({ chainId: CHAIN_ID, address: ADDRESS }, deps(fetchImpl, records, clock));
    expect(records.writes()).toEqual([]);
    expect(bufferedServices().log.at(-1)).toMatchObject({ tag: "Verify", text: "This deployment is already being verified." });
  });

  test("refuses an already-verified record, rather than taking it back to pending", async () => {
    clearServiceBuffers();
    const records = memoryRecords([confirmed({ verification: "exact_match" })]);
    const clock = manualClock();
    const fetchImpl: VerifyFetch = async () => {
      throw new Error("shouldn't call Sourcify");
    };
    await retryVerification({ chainId: CHAIN_ID, address: ADDRESS }, deps(fetchImpl, records, clock));
    expect(records.writes()).toEqual([]);
    expect(records.all()[0]?.verification).toBe("exact_match");
    expect(bufferedServices().log.at(-1)).toMatchObject({ tag: "Verify", text: "This deployment is already verified." });
  });
});

/** The catalog's real long version: Etherscan needs the commit, which `OK_BUILD`'s short one lacks. */
const LONG_BUILD: Result<ProxyBuild, string> = {
  ok: true,
  value: { stdJsonInput: { language: "Solidity" }, compilerVersion: "0.8.36+commit.8a079791" },
};

const QUEUED = (): Response => json(200, { status: "1", message: "OK", result: "guid-1" });
const PASS = (): Response => json(200, { status: "1", message: "OK", result: "Pass - Verified" });
const notOk = (result: string) => (): Response => json(200, { status: "0", message: "NOTOK", result });
const SOURCIFY_MATCH = (init: RequestInit | undefined): Response =>
  init?.method === "POST"
    ? json(202, { verificationId: "job-1" })
    : json(200, { isJobCompleted: true, contract: { runtimeMatch: "exact_match" } });

type Verifiers = { fetchImpl: VerifyFetch; etherscan(): string[]; sourcifyPosts(): number };

/** Routes by host: Etherscan's calls step through `answers` (the last repeats); Sourcify's go to `sourcify`. */
function verifiers(answers: (() => Response)[], sourcify: (init: RequestInit | undefined) => Response = SOURCIFY_MATCH): Verifiers {
  const actions: string[] = [];
  let sourcifyPosts = 0;
  const fetchImpl: VerifyFetch = async (input, init) => {
    if (input.startsWith(ETHERSCAN)) {
      const answer = answers[Math.min(actions.length, answers.length - 1)];
      actions.push(new URLSearchParams(String(init?.body)).get("action") ?? "");
      if (!answer) throw new Error("shouldn't call Etherscan");
      return answer();
    }
    if (!input.startsWith(BASE)) throw new Error(`unscripted fetch: ${input}`);
    if (init?.method === "POST") sourcifyPosts += 1;
    return sourcify(init);
  };
  return { fetchImpl, etherscan: () => [...actions], sourcifyPosts: () => sourcifyPosts };
}

function keyed(fetchImpl: VerifyFetch, records: FakeRecords, clock: ManualClock, build: Result<ProxyBuild, string> = LONG_BUILD): VerifyDeps {
  return { ...deps(fetchImpl, records, clock, build), etherscanKey: () => KEY };
}

function fresh(): void {
  clearServiceBuffers();
  etherscanOutcomes.reset();
}

const texts = (): string[] => bufferedServices().log.map((l) => l.text);
/** Enough backoff steps to clear the five-minute cap. */
const PAST_THE_CAP: number[] = Array(14).fill(30_000);

describe("the Etherscan leg", () => {
  test("both verifiers verify, each saying so", async () => {
    fresh();
    const net = verifiers([QUEUED, PASS]);
    const records = memoryRecords([confirmed()]);
    const clock = manualClock();
    await run(verifyIfNeeded(keyed(net.fetchImpl, records, clock), confirmed()), clock, [5_000]);
    expect(records.all()[0]?.verification).toBe("exact_match");
    expect(etherscanOutcomes.get(confirmed())).toEqual({ outcome: "verified" });
    expect(texts().sort()).toEqual(["Verified on Etherscan.", "Verified on Sourcify (exact match)."]);
    expect(net.etherscan()).toEqual(["verifysourcecode", "checkverifystatus"]);
    expect(verifyingNow(confirmed(), "etherscan")).toBe(false);
  });

  test("already verified on submit is a success, with no poll", async () => {
    fresh();
    const net = verifiers([notOk("Contract source code already verified")]);
    const records = memoryRecords([confirmed()]);
    const clock = manualClock();
    await run(verifyIfNeeded(keyed(net.fetchImpl, records, clock), confirmed()), clock, []);
    expect(etherscanOutcomes.get(confirmed())).toEqual({ outcome: "verified" });
    expect(texts()).toContain("Verified on Etherscan.");
    expect(net.etherscan()).toEqual(["verifysourcecode"]);
  });

  test("already verified on poll is a success", async () => {
    fresh();
    const net = verifiers([QUEUED, notOk("Already Verified")]);
    const records = memoryRecords([confirmed()]);
    const clock = manualClock();
    await run(verifyIfNeeded(keyed(net.fetchImpl, records, clock), confirmed()), clock, [5_000]);
    expect(etherscanOutcomes.get(confirmed())).toEqual({ outcome: "verified" });
  });

  test("pending in queue polls again, then passes", async () => {
    fresh();
    const net = verifiers([QUEUED, notOk("Pending in queue"), PASS]);
    const records = memoryRecords([confirmed()]);
    const clock = manualClock();
    await run(verifyIfNeeded(keyed(net.fetchImpl, records, clock), confirmed()), clock, [5_000, 5_000]);
    expect(etherscanOutcomes.get(confirmed())).toEqual({ outcome: "verified" });
    expect(net.etherscan()).toEqual(["verifysourcecode", "checkverifystatus", "checkverifystatus"]);
  });

  test("a contract Etherscan hasn't indexed yet is submitted again after a wait", async () => {
    fresh();
    const net = verifiers([notOk(`Unable to locate ContractCode at ${ADDRESS}`), QUEUED, PASS]);
    const records = memoryRecords([confirmed()]);
    const clock = manualClock();
    await run(verifyIfNeeded(keyed(net.fetchImpl, records, clock), confirmed()), clock, [5_000, 5_000]);
    expect(etherscanOutcomes.get(confirmed())).toEqual({ outcome: "verified" });
    expect(net.etherscan()).toEqual(["verifysourcecode", "verifysourcecode", "checkverifystatus"]);
  });

  test("gives up on a contract Etherscan never indexes, and Sourcify's match stands", async () => {
    fresh();
    const net = verifiers([notOk(`Unable to locate ContractCode at ${ADDRESS}`)]);
    const records = memoryRecords([confirmed()]);
    const clock = manualClock();
    await run(verifyIfNeeded(keyed(net.fetchImpl, records, clock), confirmed()), clock, PAST_THE_CAP);
    expect(etherscanOutcomes.get(confirmed())).toEqual({
      outcome: "failed", reason: "Etherscan hasn't indexed this contract yet. Retry in a minute.", keyed: false,
    });
    expect(texts()).toContain("Couldn't verify on Etherscan: Etherscan hasn't indexed this contract yet. Retry in a minute.");
    expect(records.all()[0]?.verification).toBe("exact_match");
  });

  test("gives up on a submission that never leaves the queue", async () => {
    fresh();
    const net = verifiers([QUEUED, notOk("Pending in queue")]);
    const records = memoryRecords([confirmed()]);
    const clock = manualClock();
    await run(verifyIfNeeded(keyed(net.fetchImpl, records, clock), confirmed()), clock, PAST_THE_CAP);
    expect(etherscanOutcomes.get(confirmed())).toEqual({ outcome: "failed", reason: "Etherscan didn't finish in time.", keyed: false });
  });

  test("a rejected key fails Etherscan alone, marked as the key's doing", async () => {
    fresh();
    const net = verifiers([notOk("Invalid API Key (#err2)")]);
    const records = memoryRecords([confirmed()]);
    const clock = manualClock();
    await run(verifyIfNeeded(keyed(net.fetchImpl, records, clock), confirmed()), clock, []);
    expect(etherscanOutcomes.get(confirmed())).toEqual({
      outcome: "failed", reason: "Etherscan rejected the API key. Check it in Settings → Deploy.", keyed: true,
    });
    expect(texts()).toContain("Couldn't verify on Etherscan: Etherscan rejected the API key. Check it in Settings → Deploy.");
    expect(records.all()[0]?.verification).toBe("exact_match");
    expect(records.all()[0]?.verificationReason).toBeUndefined();
  });

  test("a chain the free plan doesn't cover says so", async () => {
    fresh();
    const net = verifiers([notOk("Free API access is not supported for this chain. Please upgrade your api plan.")]);
    const records = memoryRecords([confirmed({ chainId: 84532 })]);
    const clock = manualClock();
    await run(verifyIfNeeded(keyed(net.fetchImpl, records, clock), confirmed({ chainId: 84532 })), clock, []);
    expect(texts()).toContain("Couldn't verify on Etherscan: Etherscan's free plan doesn't cover this chain.");
    expect(records.all()[0]?.verification).toBe("exact_match");
  });

  test("Sourcify failing doesn't stop Etherscan verifying", async () => {
    fresh();
    const net = verifiers([QUEUED, PASS], (init) =>
      init?.method === "POST" ? json(400, { error: { message: "compilerVersion is not a valid version." } }) : json(500, {}),
    );
    const records = memoryRecords([confirmed()]);
    const clock = manualClock();
    await run(verifyIfNeeded(keyed(net.fetchImpl, records, clock), confirmed()), clock, [5_000]);
    expect(records.all()[0]?.verification).toBe("failed");
    expect(etherscanOutcomes.get(confirmed())).toEqual({ outcome: "verified" });
    expect(texts().sort()).toEqual(["Couldn't verify: compilerVersion is not a valid version.", "Verified on Etherscan."]);
  });

  test("with no key, Etherscan is never called and nothing is said about it", async () => {
    fresh();
    const net = verifiers([]);
    const records = memoryRecords([confirmed()]);
    const clock = manualClock();
    await run(verifyIfNeeded(deps(net.fetchImpl, records, clock, LONG_BUILD), confirmed()), clock, []);
    expect(net.etherscan()).toEqual([]);
    expect(etherscanOutcomes.get(confirmed())).toBeUndefined();
    expect(texts()).toEqual(["Verified on Sourcify (exact match)."]);
  });

  test("never calls anyone for Anvil, and only Sourcify's line says so", async () => {
    fresh();
    const fetchImpl: VerifyFetch = async () => {
      throw new Error("shouldn't call anyone");
    };
    const records = memoryRecords([confirmed({ chainId: 31337 })]);
    const clock = manualClock();
    await run(verifyIfNeeded(keyed(fetchImpl, records, clock), confirmed({ chainId: 31337 })), clock, []);
    expect(texts()).toEqual(["Couldn't verify: Sourcify doesn't verify contracts on Anvil."]);
    expect(etherscanOutcomes.get(confirmed({ chainId: 31337 }))).toBeUndefined();
  });

  test("on a chain Etherscan doesn't serve, Sourcify verifies and Etherscan is never asked or mentioned", async () => {
    fresh();
    const net = verifiers([]);
    const hashkey = confirmed({ chainId: 133 });
    const records = memoryRecords([hashkey]);
    const clock = manualClock();
    await run(verifyIfNeeded(keyed(net.fetchImpl, records, clock), hashkey), clock, []);
    expect(net.etherscan()).toEqual([]);
    expect(etherscanOutcomes.get(hashkey)).toBeUndefined();
    expect(texts()).toEqual(["Verified on Sourcify (exact match)."]);
    expect(records.all()[0]?.verification).toBe("exact_match");
    // Retry has nothing left to do there, with a key or without one, and never says Etherscan isn't set up.
    await retryVerification({ chainId: 133, address: ADDRESS }, keyed(net.fetchImpl, records, clock));
    await retryVerification({ chainId: 133, address: ADDRESS }, deps(net.fetchImpl, records, clock, LONG_BUILD));
    expect(net.etherscan()).toEqual([]);
    expect(texts().slice(1)).toEqual(["This deployment is already verified.", "This deployment is already verified."]);
  });

  test("on Avalanche Fuji, which Etherscan serves, a keyed record gets both legs", async () => {
    fresh();
    const net = verifiers([QUEUED, PASS]);
    const fuji = confirmed({ chainId: 43113 });
    const records = memoryRecords([fuji]);
    const clock = manualClock();
    await run(verifyIfNeeded(keyed(net.fetchImpl, records, clock), fuji), clock, [5_000]);
    expect(net.etherscan()).toEqual(["verifysourcecode", "checkverifystatus"]);
    expect(etherscanOutcomes.get(fuji)).toEqual({ outcome: "verified" });
    expect(texts().sort()).toEqual(["Verified on Etherscan.", "Verified on Sourcify (exact match)."]);
  });

  test("a catalog without the compiler's commit fails Etherscan before any call, and Sourcify goes on", async () => {
    fresh();
    const net = verifiers([]);
    const records = memoryRecords([confirmed()]);
    const clock = manualClock();
    await run(verifyIfNeeded(keyed(net.fetchImpl, records, clock, OK_BUILD), confirmed()), clock, []);
    expect(net.etherscan()).toEqual([]);
    expect(etherscanOutcomes.get(confirmed())).toEqual({
      outcome: "failed", reason: "This catalog doesn't carry the full compiler version Etherscan needs.", keyed: false,
    });
    expect(records.all()[0]?.verification).toBe("exact_match");
  });

  test("a dispose mid-poll stops the calls and keeps no outcome, so the next watcher starts again", async () => {
    fresh();
    const net = verifiers([QUEUED, notOk("Pending in queue")]);
    const records = memoryRecords([confirmed({ verification: "exact_match" })]);
    const clock = manualClock();
    const controller = new AbortController();
    const promise = verifyIfNeeded(keyed(net.fetchImpl, records, clock), confirmed({ verification: "exact_match" }), controller.signal);
    await flush();
    expect(net.etherscan()).toEqual(["verifysourcecode"]);
    controller.abort();
    clock.advance(5_000);
    await flush();
    await promise;
    expect(net.etherscan()).toEqual(["verifysourcecode"]);
    expect(etherscanOutcomes.get(confirmed())).toBeUndefined();
    expect(texts()).toEqual([]);
  });

  test("a record that moved off confirmed keeps no outcome, and nothing is said", async () => {
    fresh();
    const net = verifiers([notOk("Contract source code already verified")]);
    const records = memoryRecords([confirmed({ status: "mismatch", verification: "exact_match" })]);
    const clock = manualClock();
    await run(verifyIfNeeded(keyed(net.fetchImpl, records, clock), confirmed({ verification: "exact_match" })), clock, []);
    expect(etherscanOutcomes.get(confirmed())).toBeUndefined();
    expect(texts()).toEqual([]);
  });

  test("a request that never reaches Etherscan is kept as transient, so it's tried again unasked", async () => {
    fresh();
    const fetchImpl: VerifyFetch = async (input, init) => {
      if (input.startsWith(ETHERSCAN)) throw new Error("offline");
      return SOURCIFY_MATCH(init);
    };
    const records = memoryRecords([confirmed()]);
    const clock = manualClock();
    await run(verifyIfNeeded(keyed(fetchImpl, records, clock), confirmed()), clock, []);
    expect(etherscanOutcomes.get(confirmed())).toEqual({
      outcome: "failed", reason: "Couldn't reach Etherscan.", keyed: false, transient: true,
    });
    expect(texts()).toContain("Couldn't verify on Etherscan: Couldn't reach Etherscan.");
    expect(records.all()[0]?.verification).toBe("exact_match");
  });

  test("the proxy's build not loading is kept as transient too, with no call", async () => {
    fresh();
    const net = verifiers([]);
    const records = memoryRecords([confirmed({ verification: "exact_match" })]);
    const clock = manualClock();
    const build: Result<ProxyBuild, string> = { ok: false, error: "The catalog hasn't loaded." };
    await run(verifyIfNeeded(keyed(net.fetchImpl, records, clock, build), confirmed({ verification: "exact_match" })), clock, []);
    expect(net.etherscan()).toEqual([]);
    expect(etherscanOutcomes.get(confirmed())).toEqual({
      outcome: "failed", reason: "The catalog hasn't loaded.", keyed: false, transient: true,
    });
  });

  test("a busy Etherscan (429, then 503 on the poll) is waited out, not failed", async () => {
    fresh();
    const net = verifiers([() => json(429, {}), QUEUED, () => json(503, {}), PASS]);
    const records = memoryRecords([confirmed({ verification: "exact_match" })]);
    const clock = manualClock();
    await run(verifyIfNeeded(keyed(net.fetchImpl, records, clock), confirmed({ verification: "exact_match" })), clock, [5_000, 5_000, 10_000]);
    expect(net.etherscan()).toEqual(["verifysourcecode", "verifysourcecode", "checkverifystatus", "checkverifystatus"]);
    expect(etherscanOutcomes.get(confirmed())).toEqual({ outcome: "verified" });
  });

  test("an Etherscan job that throws for a record that moved on keeps no outcome, and nothing is said", async () => {
    fresh();
    const broken = { get ok(): boolean { throw new Error("boom"); }, status: 200 } as Response;
    const fetchImpl: VerifyFetch = async () => broken;
    const records = memoryRecords([confirmed({ status: "mismatch", verification: "exact_match" })]);
    const clock = manualClock();
    await run(verifyIfNeeded(keyed(fetchImpl, records, clock), confirmed({ verification: "exact_match" })), clock, []);
    expect(etherscanOutcomes.get(confirmed())).toBeUndefined();
    expect(texts()).toEqual([]);
  });

  test("an Etherscan job that throws fails with fixed words, and Sourcify still verifies", async () => {
    fresh();
    const broken = { get ok(): boolean { throw new Error(`boom apikey=${KEY}`); } } as Response;
    const fetchImpl: VerifyFetch = async (input, init) => (input.startsWith(ETHERSCAN) ? broken : SOURCIFY_MATCH(init));
    const records = memoryRecords([confirmed()]);
    const clock = manualClock();
    await run(verifyIfNeeded(keyed(fetchImpl, records, clock), confirmed()), clock, []);
    expect(records.all()[0]?.verification).toBe("exact_match");
    expect(etherscanOutcomes.get(confirmed())).toEqual({ outcome: "failed", reason: "Etherscan verification stopped unexpectedly.", keyed: false });
    expect(texts().sort()).toEqual(["Couldn't verify on Etherscan: Etherscan verification stopped unexpectedly.", "Verified on Sourcify (exact match)."]);
  });

  test("a Sourcify job that throws doesn't stop Etherscan settling", async () => {
    fresh();
    const net = verifiers([QUEUED, PASS]);
    const records = memoryRecords([confirmed()]);
    const clock = manualClock();
    // Sourcify's own client turns a thrown fetch into a failure; a build that throws on its first read only
    // (Sourcify's leg starts first) is what makes `verifyRecord` itself reject.
    let builds = 0;
    const d: VerifyDeps = {
      ...keyed(net.fetchImpl, records, clock),
      proxyBuild: async () => {
        builds += 1;
        if (builds === 1) throw new Error("build blew up");
        return LONG_BUILD;
      },
    };
    const promise = verifyIfNeeded(d, confirmed());
    const outcome = promise.then(() => "resolved", (error: unknown) => (error instanceof Error ? error.message : "rejected"));
    await run(Promise.resolve(), clock, [5_000]);
    expect(await outcome).toBe("build blew up");
    expect(etherscanOutcomes.get(confirmed())).toEqual({ outcome: "verified" });
    expect(verifyingNow(confirmed())).toBe(false);
  });

  test("the key reaches no console line, no stored outcome and no record, even when Etherscan echoes it", async () => {
    fresh();
    const net = verifiers([notOk(`Something about ${KEY} went wrong`)]);
    const records = memoryRecords([confirmed()]);
    const clock = manualClock();
    await run(verifyIfNeeded(keyed(net.fetchImpl, records, clock), confirmed()), clock, []);
    expect(texts()).toContain("Couldn't verify on Etherscan: Etherscan answered: Something about … went wrong.");
    expect(JSON.stringify(bufferedServices().log)).not.toContain(KEY);
    expect(JSON.stringify(bufferedServices().announce)).not.toContain(KEY);
    expect(JSON.stringify(etherscanOutcomes.get(confirmed()))).not.toContain(KEY);
    expect(JSON.stringify(records.all())).not.toContain(KEY);
  });

  test("a key changed while a job ran drops the failure the old key caused, and tries the new one", async () => {
    fresh();
    const net = verifiers([notOk("Invalid API Key (#err2)"), notOk("Contract source code already verified")]);
    const records = memoryRecords([confirmed({ verification: "exact_match" })]);
    const clock = manualClock();
    let reads = 0;
    const d: VerifyDeps = {
      ...keyed(net.fetchImpl, records, clock),
      etherscanKey: () => {
        reads += 1;
        return reads === 1 ? "partial" : KEY;
      },
    };
    await run(verifyIfNeeded(d, confirmed({ verification: "exact_match" })), clock, []);
    expect(net.etherscan()).toEqual(["verifysourcecode", "verifysourcecode"]);
    expect(etherscanOutcomes.get(confirmed())).toEqual({ outcome: "verified" });
  });
});

describe("retryVerification with Etherscan", () => {
  const target = { chainId: CHAIN_ID, address: ADDRESS };

  test("Sourcify matched, Etherscan failed: runs Etherscan again and leaves the record alone", async () => {
    fresh();
    const record = confirmed({ verification: "exact_match" });
    etherscanOutcomes.set(record, { outcome: "failed", reason: "Etherscan didn't finish in time.", keyed: false });
    const net = verifiers([QUEUED, PASS]);
    const records = memoryRecords([record]);
    const clock = manualClock();
    await retryVerification(target, keyed(net.fetchImpl, records, clock));
    await run(Promise.resolve(), clock, [5_000]);
    expect(net.etherscan()).toEqual(["verifysourcecode", "checkverifystatus"]);
    expect(net.sourcifyPosts()).toBe(0);
    expect(records.writes()).toEqual([]);
    expect(etherscanOutcomes.get(record)).toEqual({ outcome: "verified" });
    expect(texts()).toEqual(["Verified on Etherscan."]);
  });

  test("both failed: one retry reopens both", async () => {
    fresh();
    const record = confirmed({ verification: "failed", verificationReason: "Sourcify didn't finish in time." });
    etherscanOutcomes.set(record, { outcome: "failed", reason: "Etherscan didn't finish in time.", keyed: false });
    const net = verifiers([notOk("Contract source code already verified")]);
    const records = memoryRecords([record]);
    const clock = manualClock();
    await retryVerification(target, keyed(net.fetchImpl, records, clock));
    await run(Promise.resolve(), clock, []);
    expect(records.writes()).toEqual(["pending", "exact_match"]);
    expect(etherscanOutcomes.get(record)).toEqual({ outcome: "verified" });
  });

  test("an Etherscan failure with no key now says it isn't set up, and keeps the failure", async () => {
    fresh();
    const record = confirmed({ verification: "exact_match" });
    const failure = { outcome: "failed" as const, reason: "Etherscan rejected the API key. Check it in Settings → Deploy.", keyed: true };
    etherscanOutcomes.set(record, failure);
    const net = verifiers([]);
    const records = memoryRecords([record]);
    const clock = manualClock();
    await retryVerification(target, deps(net.fetchImpl, records, clock, LONG_BUILD));
    await flush();
    expect(texts()).toEqual(["Etherscan verification isn't set up. Add an API key in Settings → Deploy."]);
    expect(net.etherscan()).toEqual([]);
    expect(etherscanOutcomes.get(record)).toEqual(failure);
  });

  test("verified by both is refused as already verified", async () => {
    fresh();
    const record = confirmed({ verification: "exact_match" });
    etherscanOutcomes.set(record, { outcome: "verified" });
    const net = verifiers([]);
    const records = memoryRecords([record]);
    const clock = manualClock();
    await retryVerification(target, keyed(net.fetchImpl, records, clock));
    await flush();
    expect(texts()).toEqual(["This deployment is already verified."]);
    expect(net.etherscan()).toEqual([]);
  });

  test("retrying Sourcify while Etherscan is still polling starts Sourcify's job at once", async () => {
    fresh();
    let sourcifyMatches = false;
    const net = verifiers([QUEUED, notOk("Pending in queue")], (init) => {
      if (init?.method === "POST") return json(202, { verificationId: "job-1" });
      return sourcifyMatches
        ? json(200, { isJobCompleted: true, contract: { runtimeMatch: "exact_match" } })
        : json(200, { isJobCompleted: true, error: { message: "Compilation failed." } });
    });
    const records = memoryRecords([confirmed()]);
    const clock = manualClock();
    const controller = new AbortController();
    const d = keyed(net.fetchImpl, records, clock);
    const first = verifyIfNeeded(d, confirmed(), controller.signal);
    await flush();
    expect(records.all()[0]?.verification).toBe("failed");
    expect(verifyingNow(confirmed(), "etherscan")).toBe(true);

    sourcifyMatches = true;
    await retryVerification(target, d);
    await flush();
    expect(net.sourcifyPosts()).toBe(2);
    expect(records.all()[0]?.verification).toBe("exact_match");
    expect(verifyingNow(confirmed(), "etherscan")).toBe(true);
    expect(net.etherscan().filter((a) => a === "verifysourcecode")).toHaveLength(1);

    controller.abort();
    await flush();
    await first;
  });
});
