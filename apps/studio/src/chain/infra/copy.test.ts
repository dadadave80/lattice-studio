/** Flow 14's words (spec L586-L606) and the chain rows' (spec L697), as the spec writes them. */
import { describe, expect, test } from "bun:test";
import { lintCopy } from "@lattice-studio/core";
import { catalogDeployBlock } from ".";
import { ANVIL, AVALANCHE_FUJI, chainFromText, chainInfo, ensRegistryNames, ETHEREUM, HASHKEY_TESTNET, HEDERA_TESTNET, MONAD_TESTNET, pickerChains, publicRpcUrls, rpcUrls, SEPOLIA } from "./chains";
import {
  CANCELED_IN_WALLET, CHAIN_CHECKS_NEED_CONNECTION, checking, couldntRead, ensGatewayFailed, LOADING_WALLET_SUPPORT, needsFunds,
  NO_WALLET, noEnsRecord, rpcNotAnswering, walletOn,
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

describe("ENS", () => {
  test("a name with no record says where Studio looked; an offchain resolver that didn't answer says so", () => {
    expect(noEnsRecord("safe.eth", ["Sepolia", "Ethereum"])).toBe("safe.eth has no address on Sepolia's or Ethereum's ENS.");
    expect(noEnsRecord("safe.eth", ["Ethereum"])).toBe("safe.eth has no address on Ethereum's ENS.");
    expect(noEnsRecord("safe.eth", [])).toBe("safe.eth doesn't resolve to an address.");
    expect(ensGatewayFailed("safe.eth")).toBe("Couldn't resolve safe.eth: its offchain resolver didn't answer.");
    for (const text of [noEnsRecord("safe.eth", ["Sepolia", "Ethereum"]), ensGatewayFailed("safe.eth")]) expect(lintCopy(text)).toEqual([]);
  });

  test("testnets read Sepolia's ENS, then Ethereum's; Ethereum reads its own; Anvil has none", () => {
    for (const chain of pickerChains(false)) expect(chain.ensChainIds).toEqual([11155111, 1]);
    expect(ETHEREUM.ensChainIds).toEqual([1]);
    expect(ANVIL.ensChainIds).toEqual([]);
    expect(ensRegistryNames(SEPOLIA.id, false)).toEqual(["Sepolia", "Ethereum"]);
    expect(ensRegistryNames(ANVIL.id, true)).toEqual([]);
  });
});

describe("chains", () => {
  test("v1 testnets in the picker; Anvil only in end-to-end builds", () => {
    expect(pickerChains(false).map((c) => c.id)).toEqual([11155111, 84532, 133, 296, 43113, 10143]);
    expect(pickerChains(true).map((c) => c.id)).toEqual([11155111, 84532, 133, 296, 43113, 10143, 31337]);
    expect(chainFromText("anvil", false)).toBeUndefined();
    expect(chainFromText("anvil", true)?.id).toBe(31337);
  });

  test("HSKChain Testnet: chain 133, HSK, its own RPC, explorer and faucet, ENS through Sepolia, then Ethereum", () => {
    expect(chainInfo(HASHKEY_TESTNET)).toEqual({
      id: 133,
      name: "HSKChain Testnet",
      testnet: true,
      explorer: "https://testnet-explorer.hskchain.net",
      faucet: "https://faucet.hskchain.net/faucet",
    });
    expect(HASHKEY_TESTNET.nativeCurrency).toEqual({ name: "HashKey EcoPoints", symbol: "HSK", decimals: 18 });
    expect(HASHKEY_TESTNET.ensChainIds).toEqual([11155111, 1]);
    expect(HASHKEY_TESTNET.gasCap).toBeUndefined();
    expect(rpcUrls(HASHKEY_TESTNET, undefined)).toEqual(["https://testnet.hsk.xyz"]);
    expect(publicRpcUrls(HASHKEY_TESTNET, "https://rpc.example/key")).toEqual(["https://testnet.hsk.xyz"]);
    expect(chainFromText("133", false)).toBe(HASHKEY_TESTNET);
    expect(chainFromText("hskchain-testnet", false)).toBe(HASHKEY_TESTNET);
    expect(chainFromText("HSKChain Testnet", false)).toBe(HASHKEY_TESTNET);
  });

  test("Hedera Testnet: chain 296, HBAR in weibars, Hashio's 15M per-transaction cap, HashScan, ENS through Sepolia, then Ethereum", () => {
    expect(chainInfo(HEDERA_TESTNET)).toEqual({
      id: 296,
      name: "Hedera Testnet",
      testnet: true,
      explorer: "https://hashscan.io/testnet",
      faucet: "https://portal.hedera.com/faucet",
    });
    expect(HEDERA_TESTNET.nativeCurrency).toEqual({ name: "HBAR", symbol: "HBAR", decimals: 18 });
    expect(HEDERA_TESTNET.ensChainIds).toEqual([11155111, 1]);
    expect(HEDERA_TESTNET.gasCap).toBe(15_000_000n);
    expect(rpcUrls(HEDERA_TESTNET, undefined)).toEqual(["https://testnet.hashio.io/api"]);
    expect(publicRpcUrls(HEDERA_TESTNET, "https://rpc.example/key")).toEqual(["https://testnet.hashio.io/api"]);
    expect(chainFromText("296", false)).toBe(HEDERA_TESTNET);
    expect(chainFromText("hedera-testnet", false)).toBe(HEDERA_TESTNET);
    expect(chainFromText("Hedera Testnet", false)).toBe(HEDERA_TESTNET);
  });

  test("Avalanche Fuji: chain 43113, AVAX, two public RPCs, Snowtrace and the Builder Hub faucet, ENS through Sepolia, then Ethereum", () => {
    expect(chainInfo(AVALANCHE_FUJI)).toEqual({
      id: 43113,
      name: "Avalanche Fuji",
      testnet: true,
      explorer: "https://testnet.snowtrace.io",
      faucet: "https://build.avax.network/console/primary-network/faucet",
    });
    expect(AVALANCHE_FUJI.nativeCurrency).toEqual({ name: "Avalanche", symbol: "AVAX", decimals: 18 });
    expect(AVALANCHE_FUJI.ensChainIds).toEqual([11155111, 1]);
    expect(AVALANCHE_FUJI.gasCap).toBeUndefined();
    const both = ["https://api.avax-test.network/ext/bc/C/rpc", "https://avalanche-fuji-c-chain-rpc.publicnode.com"];
    expect(rpcUrls(AVALANCHE_FUJI, undefined)).toEqual(both);
    expect(publicRpcUrls(AVALANCHE_FUJI, "https://rpc.example/key")).toEqual(both);
    expect(chainFromText("43113", false)).toBe(AVALANCHE_FUJI);
    expect(chainFromText("avalanche-fuji", false)).toBe(AVALANCHE_FUJI);
    expect(chainFromText("Avalanche Fuji", false)).toBe(AVALANCHE_FUJI);
  });

  test("Monad Testnet: chain 10143, MON, two public RPCs, MonadVision and the faucet, ENS through Sepolia, then Ethereum", () => {
    expect(chainInfo(MONAD_TESTNET)).toEqual({
      id: 10143,
      name: "Monad Testnet",
      testnet: true,
      explorer: "https://testnet.monadvision.com",
      faucet: "https://faucet.monad.xyz",
    });
    expect(MONAD_TESTNET.nativeCurrency).toEqual({ name: "Monad", symbol: "MON", decimals: 18 });
    expect(MONAD_TESTNET.ensChainIds).toEqual([11155111, 1]);
    expect(MONAD_TESTNET.gasCap).toBe(30_000_000n);
    const both = ["https://testnet-rpc.monad.xyz", "https://rpc.ankr.com/monad_testnet"];
    expect(rpcUrls(MONAD_TESTNET, undefined)).toEqual(both);
    expect(publicRpcUrls(MONAD_TESTNET, "https://rpc.example/key")).toEqual(both);
    expect(chainFromText("10143", false)).toBe(MONAD_TESTNET);
    expect(chainFromText("monad-testnet", false)).toBe(MONAD_TESTNET);
    expect(chainFromText("Monad Testnet", false)).toBe(MONAD_TESTNET);
    expect(chainFromText("monad", false)).toBeUndefined();
  });

  test("`chain <id>`: a picker chain by its number, nothing for one Studio doesn't list (IR L155)", () => {
    expect(chainFromText("11155111", false)?.name).toBe("Sepolia");
    expect(chainFromText(" 84532 ", false)?.name).toBe("Base Sepolia");
    expect(chainFromText("31337", false)).toBeUndefined();
    expect(chainFromText("31337", true)?.name).toBe("Anvil");
    // Ethereum is read for ENS only; it isn't a chain to deploy to. Nor is Hedera Mainnet (295): mainnets are off.
    for (const unknown of ["1", "5", "10", "295", "0", "999999999"]) expect(chainFromText(unknown, true)).toBeUndefined();
  });

  test("a fixture catalog can't deploy (contracts §4)", () => {
    expect(catalogDeployBlock({ lattice: { tag: "fixture", commit: "f4a32c8" } })).toBe("Fixture catalog: build the real catalog first");
    expect(catalogDeployBlock({ lattice: { tag: "v0.4.0", commit: "abc" } })).toBeNull();
  });
});
