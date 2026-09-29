import { describe, expect, test } from "bun:test";
import { chainNameOf } from "./use-chain";

describe("chainNameOf", () => {
  test("names a picker chain from the static table before the chain module has loaded (Q1e's 'Chain 31337' chip)", () => {
    expect(chainNameOf(null, 11155111)).toBe("Sepolia");
    expect(chainNameOf(undefined, 84532)).toBe("Base Sepolia");
  });

  test("prefers the module's list once it's there and falls back to 'Chain <id>' for one Studio doesn't list", () => {
    const chains = [{ id: 5, name: "Goerli", testnet: true }];
    expect(chainNameOf(chains, 5)).toBe("Goerli");
    expect(chainNameOf(chains, 6)).toBe("Chain 6");
  });
});
