/**
 * The Etherscan V2 client against the response strings its docs and Foundry's verifier name: the request's shape
 * (the key in the body, never the URL), every submit and poll outcome, the house reasons, and that no reason ever
 * carries the key.
 */
import { describe, expect, test } from "bun:test";
import type { Address } from "@lattice-studio/core";
import { etherscanCompilerVersion, pollEtherscan, submitToEtherscan } from "./etherscan";
import type { VerifyFetch } from "./ports";

const BASE = "https://etherscan.test/v2/api";
const CHAIN_ID = 11155111;
const ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as Address;
const KEY = "TESTKEY1234567890";
const URL_FOR_CHAIN = `${BASE}?chainid=${CHAIN_ID}`;
const BODY = { stdJsonInput: { language: "Solidity" }, compilerVersion: "v0.8.36+commit.8a079791", contractName: "src/Lattice.sol:Lattice" };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

type Call = { url: string; init: RequestInit | undefined };

function answering(respond: () => Response): { fetchImpl: VerifyFetch; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetchImpl: async (input, init) => {
      if (input !== URL_FOR_CHAIN) throw new Error(`unscripted fetch: ${input}`);
      calls.push({ url: input, init });
      return respond();
    },
  };
}

const submit = (respond: () => Response) => submitToEtherscan(answering(respond).fetchImpl, BASE, KEY, CHAIN_ID, ADDRESS, BODY);
const poll = (respond: () => Response) => pollEtherscan(answering(respond).fetchImpl, BASE, KEY, CHAIN_ID, "guid-1");
const notOk = (result: string) => () => json(200, { status: "0", message: "NOTOK", result });

describe("etherscanCompilerVersion", () => {
  test("adds the leading v, keeps one already there, and drops a platform suffix", () => {
    expect(etherscanCompilerVersion("0.8.36+commit.8a079791")).toBe("v0.8.36+commit.8a079791");
    expect(etherscanCompilerVersion("v0.8.36+commit.8a079791")).toBe("v0.8.36+commit.8a079791");
    expect(etherscanCompilerVersion("0.8.36+commit.8a079791.Darwin.appleclang")).toBe("v0.8.36+commit.8a079791");
  });

  test("is null for a version with no commit", () => {
    expect(etherscanCompilerVersion("0.8.36")).toBeNull();
  });
});

describe("submitToEtherscan", () => {
  test("posts a form with the key in the body, and only the chain id in the URL", async () => {
    const { fetchImpl, calls } = answering(() => json(200, { status: "1", message: "OK", result: "guid-1" }));
    const result = await submitToEtherscan(fetchImpl, BASE, KEY, CHAIN_ID, ADDRESS, BODY);
    expect(result).toEqual({ kind: "queued", guid: "guid-1" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(URL_FOR_CHAIN);
    expect(calls[0]?.url).not.toContain(KEY);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers).toEqual({ "content-type": "application/x-www-form-urlencoded" });
    expect(Object.fromEntries(new URLSearchParams(String(calls[0]?.init?.body)))).toEqual({
      apikey: KEY,
      module: "contract",
      action: "verifysourcecode",
      codeformat: "solidity-standard-json-input",
      sourceCode: '{"language":"Solidity"}',
      contractaddress: ADDRESS,
      contractname: "src/Lattice.sol:Lattice",
      compilerversion: "v0.8.36+commit.8a079791",
    });
  });

  test("leaves out the settings keys solc's standard JSON doesn't define, without touching the caller's object", async () => {
    const stdJsonInput = { language: "Solidity", settings: { viaIR: false, experimental: false, viaSSACFG: false } };
    const { fetchImpl, calls } = answering(() => json(200, { status: "1", result: "guid-1" }));
    await submitToEtherscan(fetchImpl, BASE, KEY, CHAIN_ID, ADDRESS, { ...BODY, stdJsonInput });
    const sent = new URLSearchParams(String(calls[0]?.init?.body)).get("sourceCode");
    expect(JSON.parse(sent ?? "")).toEqual({ language: "Solidity", settings: { viaIR: false } });
    expect(stdJsonInput.settings).toEqual({ viaIR: false, experimental: false, viaSSACFG: false });
  });

  test("already verified is a success", async () => {
    expect(await submit(notOk("Contract source code already verified"))).toEqual({ kind: "verified" });
  });

  test("a contract Etherscan hasn't indexed yet, or a rate limit, waits", async () => {
    expect(await submit(notOk(`Unable to locate ContractCode at ${ADDRESS}`))).toEqual({ kind: "wait" });
    expect(await submit(notOk("Max rate limit reached, please use API Key for higher rate limit"))).toEqual({ kind: "wait" });
  });

  test("a rejected key, a plan that doesn't cover the chain and a used-up quota fail with house reasons", async () => {
    const rejected = { kind: "failed" as const, reason: "Etherscan rejected the API key. Check it in Settings → Deploy.", keyed: true };
    expect(await submit(notOk("Invalid API Key (#err2)"))).toEqual(rejected);
    expect(await submit(notOk("Missing/Invalid API Key"))).toEqual(rejected);
    expect(await submit(notOk("Too many invalid api key attempts, please try again later"))).toEqual(rejected);
    expect(await submit(notOk("Free API access is not supported for this chain. Please upgrade your api plan."))).toEqual({
      kind: "failed", reason: "Etherscan's free plan doesn't cover this chain.", keyed: true,
    });
    expect(await submit(notOk("Community Free API limit reached"))).toEqual({
      kind: "failed", reason: "Etherscan's free daily limit is used up. Retry later.", keyed: true,
    });
    expect(await submit(notOk("Missing or unsupported chainid parameter (required for v2 api)"))).toEqual({
      kind: "failed", reason: "Etherscan doesn't serve this chain.", keyed: false,
    });
  });

  test("any other answer is quoted, capped, with the key cut out of it", async () => {
    expect(await submit(notOk(`Bad request for apikey=${KEY}`))).toEqual({
      kind: "failed", reason: "Etherscan answered: Bad request for apikey=…", keyed: false,
    });
    const long = await submit(notOk("x".repeat(500)));
    expect(long.kind === "failed" && long.reason.length).toBe("Etherscan answered: ".length + 200);
  });

  test("a network failure, a non-2xx status and a body that isn't JSON get fixed words", async () => {
    const offline: VerifyFetch = async () => {
      throw new Error(`fetch failed for ${URL_FOR_CHAIN}&apikey=${KEY}`);
    };
    expect(await submitToEtherscan(offline, BASE, KEY, CHAIN_ID, ADDRESS, BODY)).toEqual({
      kind: "failed", reason: "Couldn't reach Etherscan.", keyed: false,
    });
    expect(await submit(() => json(502, {}))).toEqual({ kind: "failed", reason: "Etherscan answered 502.", keyed: false });
    expect(await submit(() => new Response("<html>", { status: 200 }))).toEqual({
      kind: "failed", reason: "Etherscan's response wasn't valid JSON.", keyed: false,
    });
  });
});

describe("pollEtherscan", () => {
  test("posts the guid with the key in the body", async () => {
    const { fetchImpl, calls } = answering(() => json(200, { status: "1", message: "OK", result: "Pass - Verified" }));
    expect(await pollEtherscan(fetchImpl, BASE, KEY, CHAIN_ID, "guid-1")).toEqual({ kind: "verified" });
    expect(calls[0]?.url).toBe(URL_FOR_CHAIN);
    expect(Object.fromEntries(new URLSearchParams(String(calls[0]?.init?.body)))).toEqual({
      apikey: KEY, module: "contract", action: "checkverifystatus", guid: "guid-1",
    });
  });

  test("already verified is a success", async () => {
    expect(await poll(notOk("Already Verified"))).toEqual({ kind: "verified" });
  });

  test("still queued, not indexed yet, rate limited or an unrecognized OK answer stay pending", async () => {
    expect(await poll(notOk("Pending in queue"))).toEqual({ kind: "pending" });
    expect(await poll(notOk("Error: contract does not exist"))).toEqual({ kind: "pending" });
    expect(await poll(notOk("Max rate limit reached"))).toEqual({ kind: "pending" });
    expect(await poll(() => json(200, { status: "1", message: "OK", result: "In progress" }))).toEqual({ kind: "pending" });
  });

  test("any other failure is terminal, with the reason", async () => {
    expect(await poll(notOk("Fail - Unable to verify"))).toEqual({
      kind: "failed", reason: "Etherscan answered: Fail - Unable to verify", keyed: false,
    });
    expect(await poll(notOk("Invalid API Key (#err2)"))).toMatchObject({ kind: "failed", keyed: true });
  });

  test("a network failure gets fixed words", async () => {
    const offline: VerifyFetch = async () => {
      throw new Error("offline");
    };
    expect(await pollEtherscan(offline, BASE, KEY, CHAIN_ID, "guid-1")).toEqual({
      kind: "failed", reason: "Couldn't reach Etherscan.", keyed: false,
    });
  });
});
