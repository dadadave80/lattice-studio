/** Flow 14's words (spec L586-L606) and the chain rows' (spec L697), as the spec writes them. */
import { describe, expect, test } from "bun:test";
import { lintCopy } from "@lattice-studio/core";
import { catalogDeployBlock } from ".";
import { AVALANCHE_FUJI, chainFromText, chainInfo, HASHKEY_TESTNET, pickerChains, publicRpcUrls, rpcUrls } from "./chains";
import {
  CANCELED_IN_WALLET, CHAIN_CHECKS_NEED_CONNECTION, checking, couldntRead, LOADING_WALLET_SUPPORT, needsFunds, NO_WALLET,
  rpcNotAnswering, walletOn,
} from "./copy";

describe("Flow 14", () => {
  test("each situation in the spec's words", () => {
    expect(NO_WALLET).toBe("No wallet found in this browser.");
    expect(walletOn("Base Sepolia")).toBe("Your wallet is on Base Sepolia.");
    expect(needsFunds(12_000_000_000_000_000n, 4_000_000_000_000_000n)).toBe("Needs about 0.012 ETH; this account has 0.004.");
    expect(rpcNotAnswering("Sepolia")).toBe("Sepolia's public RPC isn't answering.");
    expect(CANCELED_IN_WALLET).toBe("You canceled in your wallet.");
  });

  test("chain rows and the lazy boundary", () => {
    expect(checking("Sepolia")).toBe("Checking Sepolia…");
    expect(couldntRead("Sepolia")).toBe("Couldn't read Sepolia: the RPC didn't answer.");
    expect(CHAIN_CHECKS_NEED_CONNECTION).toBe("Chain checks need a connection.");
    expect(LOADING_WALLET_SUPPORT).toBe("Loading wallet support…");
  });

  test("pass C10's copy lint", () => {
    for (const text of [NO_WALLET, walletOn("Sepolia"), needsFunds(1n, 0n), rpcNotAnswering("Sepolia"), couldntRead("Sepolia"), LOADING_WALLET_SUPPORT]) {
      expect(lintCopy(text)).toEqual([]);
    }
  });
});

describe("chains", () => {
  test("v1 testnets in the picker; Anvil only in end-to-end builds", () => {
    expect(pickerChains(false).map((c) => c.id)).toEqual([11155111, 84532, 133, 43113]);
    expect(pickerChains(true).map((c) => c.id)).toEqual([11155111, 84532, 133, 43113, 31337]);
    expect(chainFromText("anvil", false)).toBeUndefined();
    expect(chainFromText("anvil", true)?.id).toBe(31337);
  });

  test("HSKChain Testnet: chain 133, HSK, its own RPC, explorer and faucet, ENS through Sepolia", () => {
    expect(chainInfo(HASHKEY_TESTNET)).toEqual({
      id: 133,
      name: "HSKChain Testnet",
      testnet: true,
      explorer: "https://testnet-explorer.hskchain.net",
      faucet: "https://faucet.hskchain.net/faucet",
    });
    expect(HASHKEY_TESTNET.nativeCurrency).toEqual({ name: "HashKey EcoPoints", symbol: "HSK", decimals: 18 });
    expect(HASHKEY_TESTNET.ensChainId).toBe(11155111);
    expect(HASHKEY_TESTNET.gasCap).toBeUndefined();
    expect(rpcUrls(HASHKEY_TESTNET, undefined)).toEqual(["https://testnet.hsk.xyz"]);
    expect(publicRpcUrls(HASHKEY_TESTNET, "https://rpc.example/key")).toEqual(["https://testnet.hsk.xyz"]);
    expect(chainFromText("133", false)).toBe(HASHKEY_TESTNET);
    expect(chainFromText("hskchain-testnet", false)).toBe(HASHKEY_TESTNET);
    expect(chainFromText("HSKChain Testnet", false)).toBe(HASHKEY_TESTNET);
  });

  test("Avalanche Fuji: chain 43113, AVAX, two public RPCs, Snowtrace and the Builder Hub faucet, ENS through Sepolia", () => {
    expect(chainInfo(AVALANCHE_FUJI)).toEqual({
      id: 43113,
      name: "Avalanche Fuji",
      testnet: true,
      explorer: "https://testnet.snowtrace.io",
      faucet: "https://build.avax.network/console/primary-network/faucet",
    });
    expect(AVALANCHE_FUJI.nativeCurrency).toEqual({ name: "Avalanche", symbol: "AVAX", decimals: 18 });
    expect(AVALANCHE_FUJI.ensChainId).toBe(11155111);
    expect(AVALANCHE_FUJI.gasCap).toBeUndefined();
    const both = ["https://api.avax-test.network/ext/bc/C/rpc", "https://avalanche-fuji-c-chain-rpc.publicnode.com"];
    expect(rpcUrls(AVALANCHE_FUJI, undefined)).toEqual(both);
    expect(publicRpcUrls(AVALANCHE_FUJI, "https://rpc.example/key")).toEqual(both);
    expect(chainFromText("43113", false)).toBe(AVALANCHE_FUJI);
    expect(chainFromText("avalanche-fuji", false)).toBe(AVALANCHE_FUJI);
    expect(chainFromText("Avalanche Fuji", false)).toBe(AVALANCHE_FUJI);
  });

  test("`chain <id>`: a picker chain by its number, nothing for one Studio doesn't list (IR L155)", () => {
    expect(chainFromText("11155111", false)?.name).toBe("Sepolia");
    expect(chainFromText(" 84532 ", false)?.name).toBe("Base Sepolia");
    expect(chainFromText("31337", false)).toBeUndefined();
    expect(chainFromText("31337", true)?.name).toBe("Anvil");
    // Ethereum is read for ENS only; it isn't a chain to deploy to.
    for (const unknown of ["1", "5", "10", "0", "999999999"]) expect(chainFromText(unknown, true)).toBeUndefined();
  });

  test("a fixture catalog can't deploy (contracts §4)", () => {
    expect(catalogDeployBlock({ lattice: { tag: "fixture", commit: "f4a32c8" } })).toBe("Fixture catalog: build the real catalog first");
    expect(catalogDeployBlock({ lattice: { tag: "v0.4.0", commit: "abc" } })).toBeNull();
  });
});
