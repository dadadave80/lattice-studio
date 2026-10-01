import { describe, expect, test } from "bun:test";
import type { Address } from "@lattice-studio/core";
import { etherscanOutcomes, readOutcomes } from "./etherscan-outcomes";

const A = { chainId: 11155111, address: "0x5FbDB2315678afecb367f032d93F642f64180aa3" as Address };
const B = { chainId: 84532, address: "0x5FbDB2315678afecb367f032d93F642f64180aa3" as Address };

describe("etherscanOutcomes", () => {
  test("keeps one outcome per chain and address, whatever the address's case", () => {
    etherscanOutcomes.reset();
    etherscanOutcomes.set(A, { outcome: "verified" });
    expect(etherscanOutcomes.get({ ...A, address: A.address.toLowerCase() as Address })).toEqual({ outcome: "verified" });
    expect(etherscanOutcomes.get(B)).toBeUndefined();
    etherscanOutcomes.clear(A);
    expect(etherscanOutcomes.get(A)).toBeUndefined();
  });

  test("clearKeyed forgets only the failures a key caused", () => {
    etherscanOutcomes.reset();
    etherscanOutcomes.set(A, { outcome: "failed", reason: "Etherscan rejected the API key.", keyed: true });
    etherscanOutcomes.set(B, { outcome: "failed", reason: "Etherscan didn't finish in time.", keyed: false });
    etherscanOutcomes.clearKeyed();
    expect(etherscanOutcomes.get(A)).toBeUndefined();
    expect(etherscanOutcomes.get(B)).toEqual({ outcome: "failed", reason: "Etherscan didn't finish in time.", keyed: false });
  });
});

describe("readOutcomes", () => {
  test("keeps well-formed entries and drops the rest", () => {
    const key = `11155111:${A.address.toLowerCase()}`;
    expect(readOutcomes(JSON.stringify({
      [key]: { outcome: "failed", reason: "Why.", keyed: true },
      [`84532:${A.address.toLowerCase()}`]: { outcome: "verified", extra: 1 },
      "nonsense": { outcome: "verified" },
      [`1:${A.address.toLowerCase()}`]: { outcome: "failed" },
      [`2:${A.address.toLowerCase()}`]: "verified",
    }))).toEqual({
      [key]: { outcome: "failed", reason: "Why.", keyed: true },
      [`84532:${A.address.toLowerCase()}`]: { outcome: "verified" },
    });
    expect(readOutcomes("not json")).toEqual({});
    expect(readOutcomes("[1]")).toEqual({});
    expect(readOutcomes(null)).toEqual({});
  });
});
