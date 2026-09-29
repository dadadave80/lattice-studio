/**
 * What the machine says after CreateX's `FailedContractCreation` (spec L75): every branch of which address has code,
 * with the replay sentence after a mined transaction and without it for a simulation (which is the `eth_call`).
 */
import { describe, expect, test } from "bun:test";
import type { Address } from "@lattice-studio/core";
import { CREATION_REPLAYED, creationFailed, creationUnread } from "./copy";

const PROXY: Address = "0x760f14a0f5b14b3321796bcbfb872863a3859221";
const DIAMOND: Address = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const found = (proxyCode: boolean, diamondCode: boolean) => ({ proxy: PROXY, diamond: DIAMOND, chain: "Sepolia", proxyCode, diamondCode });

describe("creationFailed", () => {
  test("both addresses have code: the salt was used before", () => {
    expect(creationFailed(found(true, true))).toBe(
      `Both the salt's CREATE3 proxy 0x760f…9221 and the diamond address 0x5FbD…0aa3 have code on Sepolia: this salt was used before. Use a new salt. ${CREATION_REPLAYED}`,
    );
  });

  test("only the proxy has code: the salt was used before", () => {
    expect(creationFailed(found(true, false))).toBe(
      `The salt's CREATE3 proxy 0x760f…9221 has code on Sepolia but the diamond address 0x5FbD…0aa3 has none: this salt was used before. Use a new salt. ${CREATION_REPLAYED}`,
    );
  });

  test("only the diamond address has code: said as it is, with no advice the reads can't back", () => {
    expect(creationFailed(found(false, true))).toBe(
      `The diamond address 0x5FbD…0aa3 has code on Sepolia but the salt's CREATE3 proxy 0x760f…9221 has none. ${CREATION_REPLAYED}`,
    );
  });

  test("neither has code: the salt is free and the creation itself failed", () => {
    expect(creationFailed(found(false, false))).toBe(
      `Neither the salt's CREATE3 proxy 0x760f…9221 nor the diamond address 0x5FbD…0aa3 has code on Sepolia, so the salt is free: the creation itself failed. ${CREATION_REPLAYED}`,
    );
  });

  test("for a simulation (replayed: null) the replay sentence is left out", () => {
    expect(creationFailed(found(true, false), null)).toBe(
      "The salt's CREATE3 proxy 0x760f…9221 has code on Sepolia but the diamond address 0x5FbD…0aa3 has none: this salt was used before. Use a new salt.",
    );
    expect(creationFailed(found(false, true), null)).toBe("The diamond address 0x5FbD…0aa3 has code on Sepolia but the salt's CREATE3 proxy 0x760f…9221 has none.");
  });
});

describe("creationUnread", () => {
  test("names the chain and the reason, one period, then the replay", () => {
    expect(creationUnread("Sepolia", "Sepolia's public RPC isn't answering.")).toBe(
      `Couldn't read code at the salt's addresses on Sepolia: Sepolia's public RPC isn't answering. ${CREATION_REPLAYED}`,
    );
  });

  test("for a simulation (replayed: null) it stops after the reason", () => {
    expect(creationUnread("Sepolia", "socket closed", null)).toBe("Couldn't read code at the salt's addresses on Sepolia: socket closed.");
  });
});
