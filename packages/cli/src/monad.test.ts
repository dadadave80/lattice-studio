import { expect, test } from "bun:test";
import { chainName, chooseRpc, FIXED_GAS_CAPS } from "./probe";

test("Monad Testnet's gas cap is fixed at 30,000,000, so no block is read for it", () => {
  expect(FIXED_GAS_CAPS[10143]).toBe(30_000_000n);
  expect(FIXED_GAS_CAPS[296]).toBe(15_000_000n);
});

test("viem names Monad Testnet and knows its public RPC", () => {
  expect(chainName(10143)).toBe("Monad Testnet");
  expect(chooseRpc(undefined, undefined, 10143)).toEqual({ source: "public", url: "https://testnet-rpc.monad.xyz" });
});
