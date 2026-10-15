import { describe, expect, test } from "bun:test";
import type { Address, Deployment, Hex } from "@lattice-studio/core";
import { formatAddress } from "@lattice-studio/core";
import {
  etherscanFailureReason, etherscanOffer, etherscanWord, groupDeployments, holderText, statusWord, verificationFailureReason, verificationWord,
} from "./diamond-words";

const CURRENT: Hex = `0x${"ab".repeat(32)}`;

function record(patch: Partial<Deployment>): Deployment {
  return {
    projectId: "p",
    chainId: 1,
    address: `0x${"a1".repeat(20)}` as Address,
    path: "factory",
    deployer: `0x${"d0".repeat(20)}` as Address,
    salt: `0x${"00".repeat(32)}`,
    status: "confirmed",
    recipeHash: CURRENT,
    catalogHash: CURRENT,
    at: "2026-09-20T00:00:00.000Z",
    verification: "match",
    revision: 1,
    ...patch,
  };
}

describe("diamond-words", () => {
  test("holders read as the spec names them", () => {
    expect(holderText({ holder: { $ref: "self" } })).toBe("This diamond");
    expect(holderText({ holder: { $ref: "deployer" } })).toBe("Deploying account");
    expect(holderText({ holder: null })).toBe("none");
    expect(holderText({ holder: null, anyone: true })).toBe("anyone");
    const holder = `0x${"ab".repeat(20)}`;
    expect(holderText({ holder })).toBe(formatAddress(holder as Address, { full: true }));
    expect(holderText({ holder })).toHaveLength(42);
  });

  test("status words: live only with the current hash and not from a file", () => {
    expect(statusWord(record({}), CURRENT)).toBe("Live · r1");
    expect(statusWord(record({ revision: 2 }), `0x${"cd".repeat(32)}`)).toBe("Confirmed · r2");
    expect(statusWord(record({ fromFile: true }), CURRENT)).toBe("From file");
    expect(statusWord(record({ status: "proposed" }), CURRENT)).toBe("Proposed (Safe)");
    expect(statusWord(record({ status: "mismatch" }), CURRENT)).toBe("Mismatch");
    expect(statusWord(record({ status: "pending" }), CURRENT)).toBe("Pending");
    expect(statusWord(record({ status: "failed" }), CURRENT)).toBe("Failed");
  });

  test("verification words", () => {
    expect(verificationWord("pending", true)).toBe("Verifying");
    expect(verificationWord("exact_match", true)).toBe("Verified (exact match)");
    expect(verificationWord("match", true)).toBe("Verified (match)");
    expect(verificationWord("failed", true)).toBe("Couldn't verify");
  });

  test("offline, every verification word reads Unknown (ruling R7)", () => {
    expect(verificationWord("pending", false)).toBe("Unknown");
    expect(verificationWord("exact_match", false)).toBe("Unknown");
    expect(verificationWord("match", false)).toBe("Unknown");
    expect(verificationWord("failed", false)).toBe("Unknown");
  });

  test("groups by chain, newest first, the newest chain on top", () => {
    const a = record({ chainId: 1, at: "2026-09-20T00:00:00.000Z" });
    const b = record({ chainId: 2, at: "2026-09-22T00:00:00.000Z" });
    const c = record({ chainId: 1, at: "2026-09-21T00:00:00.000Z" });
    expect(groupDeployments([a, b, c])).toEqual([
      { chainId: 2, records: [b] },
      { chainId: 1, records: [c, a] },
    ]);
  });

  test("verification failure reason: only for a failed record, and only online", () => {
    expect(verificationFailureReason(record({ verification: "failed" }), true)).toBeUndefined();
    expect(
      verificationFailureReason(record({ verification: "failed", verificationReason: "Sourcify didn't finish in time." }), true),
    ).toBe("Sourcify didn't finish in time.");
    // A stale reason on a record that isn't failed never surfaces: it means nothing there.
    expect(verificationFailureReason(record({ verification: "match", verificationReason: "stale" }), true)).toBeUndefined();
    // Offline, the stored failure can't be confirmed either (ruling R7).
    expect(
      verificationFailureReason(record({ verification: "failed", verificationReason: "Sourcify didn't finish in time." }), false),
    ).toBeUndefined();
  });

  test("Etherscan's word: its outcome, Verifying only while a job is in flight, and nothing when there's nothing to say", () => {
    const failed = { outcome: "failed" as const, reason: "Etherscan didn't finish in time.", keyed: false };
    const own = record({ chainId: 11155111 });
    expect(etherscanWord(own, { outcome: "verified" }, true, false)).toBe("Verified on Etherscan");
    expect(etherscanWord(own, failed, true, false)).toBe("Couldn't verify on Etherscan");
    expect(etherscanWord(own, undefined, true, true)).toBe("Verifying on Etherscan");
    // No outcome and nothing in flight, key or no key: Verifying would claim a request that was never made.
    expect(etherscanWord(own, undefined, true, false)).toBeNull();
    // Offline nothing stored can be confirmed (ruling R7); Anvil is never submitted; only our own confirmed records are.
    expect(etherscanWord(own, { outcome: "verified" }, false, true)).toBeNull();
    expect(etherscanWord(record({ chainId: 31337 }), undefined, true, true)).toBeNull();
    // Etherscan doesn't serve HSKChain Testnet or Hedera Testnet: no line there.
    expect(etherscanWord(record({ chainId: 133 }), undefined, true, true)).toBeNull();
    expect(etherscanWord(record({ chainId: 296 }), undefined, true, true)).toBeNull();
    // It does serve Avalanche Fuji (Snowscan) and Monad Testnet (Monadscan).
    expect(etherscanWord(record({ chainId: 43113 }), undefined, true, true)).toBe("Verifying on Etherscan");
    expect(etherscanWord(record({ chainId: 43113 }), { outcome: "verified" }, true, false)).toBe("Verified on Etherscan");
    expect(etherscanWord(record({ chainId: 10143 }), undefined, true, true)).toBe("Verifying on Etherscan");
    expect(etherscanWord(record({ chainId: 10143 }), { outcome: "verified" }, true, false)).toBe("Verified on Etherscan");
    expect(etherscanWord(record({ chainId: 11155111, status: "pending" }), undefined, true, true)).toBeNull();
    expect(etherscanWord(record({ chainId: 11155111, fromFile: true }), undefined, true, true)).toBeNull();
  });

  test("Etherscan's offer: a Settings hint without a key, Verify on Etherscan with one, only where nothing is said yet", () => {
    const own = record({ chainId: 11155111 });
    const idle = { online: true, inFlight: false };
    expect(etherscanOffer(own, undefined, { ...idle, keySet: false })).toBe("add-key");
    expect(etherscanOffer(own, undefined, { ...idle, keySet: true })).toBe("verify");
    // Served by Etherscan API V2: Avalanche Fuji, Monad Testnet.
    expect(etherscanOffer(record({ chainId: 43113 }), undefined, { ...idle, keySet: false })).toBe("add-key");
    expect(etherscanOffer(record({ chainId: 10143 }), undefined, { ...idle, keySet: true })).toBe("verify");
    // Not served: HSKChain Testnet, Hedera Testnet, Anvil. Nothing to offer, key or no key.
    for (const chainId of [133, 296, 31337]) {
      expect(etherscanOffer(record({ chainId }), undefined, { ...idle, keySet: false })).toBeNull();
      expect(etherscanOffer(record({ chainId }), undefined, { ...idle, keySet: true })).toBeNull();
    }
    // Etherscan already answered, or a job is running: the outcome line or Verifying says it instead.
    expect(etherscanOffer(own, { outcome: "verified" }, { ...idle, keySet: true })).toBeNull();
    expect(etherscanOffer(own, { outcome: "failed", reason: "No.", keyed: false }, { ...idle, keySet: true })).toBeNull();
    expect(etherscanOffer(own, undefined, { online: true, inFlight: true, keySet: true })).toBeNull();
    // Offline, not ours, or not confirmed: nothing.
    expect(etherscanOffer(own, undefined, { online: false, inFlight: false, keySet: true })).toBeNull();
    expect(etherscanOffer(record({ chainId: 11155111, fromFile: true }), undefined, { ...idle, keySet: true })).toBeNull();
    expect(etherscanOffer(record({ chainId: 11155111, status: "pending" }), undefined, { ...idle, keySet: false })).toBeNull();
  });

  test("Etherscan's failure reason: only for a failure, and only online", () => {
    const failed = { outcome: "failed" as const, reason: "Etherscan didn't finish in time.", keyed: false };
    expect(etherscanFailureReason(record({}), failed, true)).toBe("Etherscan didn't finish in time.");
    expect(etherscanFailureReason(record({}), failed, false)).toBeUndefined();
    expect(etherscanFailureReason(record({}), { outcome: "verified" }, true)).toBeUndefined();
    expect(etherscanFailureReason(record({}), undefined, true)).toBeUndefined();
  });
});
