import { describe, expect, test } from "bun:test";
import { chainFromText, chainInfo, findChain, MONAD_TESTNET, pickerChains, rpcUrls } from "./chains";

describe("Monad Testnet", () => {
  test("is the sixth picker chain, after Avalanche Fuji and before Anvil", () => {
    expect(pickerChains(false).map((chain) => chain.id)).toEqual([11155111, 84532, 133, 296, 43113, 10143]);
    expect(pickerChains(true).map((chain) => chain.id)).toEqual([11155111, 84532, 133, 296, 43113, 10143, 31337]);
  });

  test("carries its static facts", () => {
    expect(MONAD_TESTNET.gasCap).toBe(30_000_000n);
    expect(MONAD_TESTNET.ensChainId).toBe(11155111);
    expect(MONAD_TESTNET.nativeCurrency).toEqual({ name: "Monad", symbol: "MON", decimals: 18 });
    expect(chainInfo(MONAD_TESTNET)).toEqual({
      id: 10143,
      name: "Monad Testnet",
      testnet: true,
      explorer: "https://testnet.monadvision.com",
      faucet: "https://faucet.monad.xyz",
    });
  });

  test("reads through Monad's RPC, then Ankr's", () => {
    expect(rpcUrls(MONAD_TESTNET, undefined)).toEqual(["https://testnet-rpc.monad.xyz", "https://rpc.ankr.com/monad_testnet"]);
  });

  test("is named by its id or its name, but not by the bare word monad", () => {
    expect(chainFromText("10143", false)?.id).toBe(10143);
    expect(chainFromText("monad-testnet", false)?.id).toBe(10143);
    expect(chainFromText("Monad Testnet", false)?.id).toBe(10143);
    expect(chainFromText("monad", false)).toBeUndefined();
    expect(findChain(10143, false)?.name).toBe("Monad Testnet");
  });
});
