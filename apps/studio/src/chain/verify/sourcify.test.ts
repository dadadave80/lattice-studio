/**
 * The Sourcify v2 client against recorded response shapes (`sourcify.dev/server/api-docs/swagger.json`, apiv2):
 * submit, and every poll outcome (pending, exact match, match, a compilation error, a completed job with no
 * match, an HTTP error and a network failure).
 */
import { describe, expect, test } from "bun:test";
import type { VerifyFetch } from "./ports";
import { pollSourcify, submitToSourcify } from "./sourcify";

const BASE = "https://sourcify.dev/server";
const CHAIN_ID = 11155111;
const ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const VERIFICATION_ID = "8f14e45f-ceea-467e-bd28-9bff5a5c9f9a";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function scripted(handlers: Record<string, () => Response | Promise<Response>>): VerifyFetch {
  return async (input) => {
    const url = String(input);
    const handler = handlers[url];
    if (!handler) throw new Error(`unscripted fetch: ${url}`);
    return handler();
  };
}

describe("submitToSourcify", () => {
  test("a 202 with a verificationId is the ticket to poll", async () => {
    const fetchImpl = scripted({
      [`${BASE}/v2/verify/${CHAIN_ID}/${ADDRESS}`]: () => json(202, { verificationId: VERIFICATION_ID }),
    });
    const result = await submitToSourcify(fetchImpl, BASE, CHAIN_ID, ADDRESS, {
      stdJsonInput: { language: "Solidity" },
      compilerVersion: "0.8.36",
      contractIdentifier: "src/Lattice.sol:Lattice",
    });
    expect(result).toEqual({ ok: true, value: VERIFICATION_ID });
  });

  test("a 200 with a verificationId is accepted too", async () => {
    const fetchImpl = scripted({
      [`${BASE}/v2/verify/${CHAIN_ID}/${ADDRESS}`]: () => json(200, { verificationId: VERIFICATION_ID }),
    });
    const result = await submitToSourcify(fetchImpl, BASE, CHAIN_ID, ADDRESS, {
      stdJsonInput: {}, compilerVersion: "0.8.36", contractIdentifier: "src/Lattice.sol:Lattice",
    });
    expect(result.ok).toBe(true);
  });

  test("a 4xx with an error body reads its message", async () => {
    const fetchImpl = scripted({
      [`${BASE}/v2/verify/${CHAIN_ID}/${ADDRESS}`]: () =>
        json(400, { customCode: "invalid_parameter", message: "compilerVersion is not a valid version." }),
    });
    const result = await submitToSourcify(fetchImpl, BASE, CHAIN_ID, ADDRESS, {
      stdJsonInput: {}, compilerVersion: "bogus", contractIdentifier: "src/Lattice.sol:Lattice",
    });
    expect(result).toEqual({ ok: false, error: "compilerVersion is not a valid version." });
  });

  test("a network failure never throws", async () => {
    const fetchImpl: VerifyFetch = async () => {
      throw new Error("fetch failed");
    };
    const result = await submitToSourcify(fetchImpl, BASE, CHAIN_ID, ADDRESS, {
      stdJsonInput: {}, compilerVersion: "0.8.36", contractIdentifier: "src/Lattice.sol:Lattice",
    });
    expect(result).toEqual({ ok: false, error: "fetch failed" });
  });

  test("a body with no verificationId is reported, not swallowed", async () => {
    const fetchImpl = scripted({ [`${BASE}/v2/verify/${CHAIN_ID}/${ADDRESS}`]: () => json(202, {}) });
    const result = await submitToSourcify(fetchImpl, BASE, CHAIN_ID, ADDRESS, {
      stdJsonInput: {}, compilerVersion: "0.8.36", contractIdentifier: "src/Lattice.sol:Lattice",
    });
    expect(result).toEqual({ ok: false, error: "Sourcify didn't return a verification id." });
  });
});

describe("pollSourcify", () => {
  test("an incomplete job is pending", async () => {
    const fetchImpl = scripted({
      [`${BASE}/v2/verify/${VERIFICATION_ID}`]: () =>
        json(200, { isJobCompleted: false, verificationId: VERIFICATION_ID, contract: { match: null, runtimeMatch: null } }),
    });
    const result = await pollSourcify(fetchImpl, BASE, VERIFICATION_ID);
    expect(result).toEqual({ ok: true, value: { kind: "pending" } });
  });

  test("a completed job with an exact runtime match is verified", async () => {
    const fetchImpl = scripted({
      [`${BASE}/v2/verify/${VERIFICATION_ID}`]: () =>
        json(200, {
          isJobCompleted: true,
          verificationId: VERIFICATION_ID,
          contract: { match: null, creationMatch: null, runtimeMatch: "exact_match", chainId: String(CHAIN_ID), address: ADDRESS },
        }),
    });
    const result = await pollSourcify(fetchImpl, BASE, VERIFICATION_ID);
    expect(result).toEqual({ ok: true, value: { kind: "verified", match: "exact_match" } });
  });

  test("a completed job with a partial runtime match is a match, not an exact one", async () => {
    const fetchImpl = scripted({
      [`${BASE}/v2/verify/${VERIFICATION_ID}`]: () =>
        json(200, { isJobCompleted: true, contract: { runtimeMatch: "match" } }),
    });
    const result = await pollSourcify(fetchImpl, BASE, VERIFICATION_ID);
    expect(result).toEqual({ ok: true, value: { kind: "verified", match: "match" } });
  });

  test("a compilation error reads the error object's message", async () => {
    const fetchImpl = scripted({
      [`${BASE}/v2/verify/${VERIFICATION_ID}`]: () =>
        json(200, {
          isJobCompleted: true,
          error: { customCode: "compilation_error", message: "Compilation failed", errorId: "b3f1…" },
        }),
    });
    const result = await pollSourcify(fetchImpl, BASE, VERIFICATION_ID);
    expect(result).toEqual({ ok: true, value: { kind: "failed", reason: "Compilation failed" } });
  });

  test("a completed job with no match at all fails with a reason of our own", async () => {
    const fetchImpl = scripted({
      [`${BASE}/v2/verify/${VERIFICATION_ID}`]: () =>
        json(200, { isJobCompleted: true, contract: { match: null, runtimeMatch: null } }),
    });
    const result = await pollSourcify(fetchImpl, BASE, VERIFICATION_ID);
    expect(result).toEqual({ ok: true, value: { kind: "failed", reason: "Sourcify found no match for this contract." } });
  });

  test("an HTTP error with no JSON body falls back to the status line", async () => {
    const fetchImpl = scripted({
      [`${BASE}/v2/verify/${VERIFICATION_ID}`]: () => new Response("gateway timeout", { status: 504 }),
    });
    const result = await pollSourcify(fetchImpl, BASE, VERIFICATION_ID);
    expect(result).toEqual({ ok: false, error: "Sourcify answered 504." });
  });
});
