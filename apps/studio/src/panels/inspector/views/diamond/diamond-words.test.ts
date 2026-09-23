import { describe, expect, test } from "bun:test";
import type { Address, Deployment, Hex } from "@lattice-studio/core";
import { formatAddress } from "@lattice-studio/core";
import { groupDeployments, holderText, shortHash, statusWord, verificationWord } from "./diamond-words";

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
    expect(verificationWord("pending")).toBe("Verifying");
    expect(verificationWord("exact_match")).toBe("Verified (exact match)");
    expect(verificationWord("match")).toBe("Verified (match)");
    expect(verificationWord("failed")).toBe("Couldn't verify");
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

  test("short hashes are 6 + 4", () => {
    expect(shortHash(CURRENT)).toBe("0xabab…abab");
  });
});
