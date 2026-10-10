/**
 * The chains Studio deploys to (spec Phasing: the v1 testnets) and the static facts about each: the picker's
 * `ChainInfo`, the default and extra RPCs for the fallback transport (spec L841), the per-transaction gas cap
 * where one is fixed (EIP-7825, spec R16, or Hedera's relay) and the chain ENS names resolve on (spec L462).
 *
 * Plain data, no viem: the commands read it from the entry chunk. The lazy module turns it into viem chains.
 */
import type { ChainInfo } from "@/contracts";

export type ChainSpec = ChainInfo & {
  /** The chain's own public RPC ("the chain default") and one extra, in fallback order after the person's own. */
  rpc: { default: string; extra?: string };
  /**
   * The per-transaction gas cap where one is fixed: EIP-7825's 16,777,216 where it applies, or Hedera's 15,000,000
   * (its JSON-RPC relay rejects a transaction above that with -32005 GAS_LIMIT_TOO_HIGH while its blocks report a
   * gasLimit of 150,000,000). Else the latest block's gasLimit (contracts §3.1 `gasCap`).
   */
  gasCap?: bigint;
  /** The chain ENS names resolve on for this chain: Ethereum for mainnets, Sepolia for testnets. Null: none. */
  ensChainId: number | null;
  /** Solidity and the wallet see this as the native currency. */
  nativeCurrency: { name: string; symbol: string; decimals: number };
};

const ETHER = { name: "Ether", symbol: "ETH", decimals: 18 } as const;

/** EIP-7825's per-transaction gas cap, on Ethereum and Sepolia since Fusaka (spec R16). */
export const EIP7825_GAS_CAP = 16_777_216n;

export const SEPOLIA: ChainSpec = {
  id: 11155111,
  name: "Sepolia",
  testnet: true,
  explorer: "https://sepolia.etherscan.io",
  faucet: "https://www.alchemy.com/faucets/ethereum-sepolia",
  rpc: { default: "https://11155111.rpc.thirdweb.com", extra: "https://ethereum-sepolia-rpc.publicnode.com" },
  gasCap: EIP7825_GAS_CAP,
  ensChainId: 11155111,
  nativeCurrency: { ...ETHER, name: "Sepolia Ether" },
};

export const BASE_SEPOLIA: ChainSpec = {
  id: 84532,
  name: "Base Sepolia",
  testnet: true,
  explorer: "https://sepolia.basescan.org",
  faucet: "https://www.alchemy.com/faucets/base-sepolia",
  rpc: { default: "https://sepolia.base.org", extra: "https://base-sepolia-rpc.publicnode.com" },
  ensChainId: 11155111,
  nativeCurrency: { ...ETHER, name: "Sepolia Ether" },
};

/**
 * HashKey Chain's testnet, an OP Stack L2 over Sepolia; its docs name it "HSKChain Testnet". The explorer is
 * Blockscout. The docs list one public RPC.
 */
export const HASHKEY_TESTNET: ChainSpec = {
  id: 133,
  name: "HSKChain Testnet",
  testnet: true,
  explorer: "https://testnet-explorer.hskchain.net",
  faucet: "https://faucet.hskchain.net/faucet",
  rpc: { default: "https://testnet.hsk.xyz" },
  ensChainId: 11155111,
  nativeCurrency: { name: "HashKey EcoPoints", symbol: "HSK", decimals: 18 },
};

/**
 * Hedera's testnet, read through Hashio, Hedera's public JSON-RPC relay. The explorer is HashScan, which serves the
 * `/tx/<hash>` and `/address/<address>` paths. Over JSON-RPC, balances and fees are in weibars (18 decimals); only
 * contracts see tinybars (8).
 */
export const HEDERA_TESTNET: ChainSpec = {
  id: 296,
  name: "Hedera Testnet",
  testnet: true,
  explorer: "https://hashscan.io/testnet",
  faucet: "https://portal.hedera.com/faucet",
  rpc: { default: "https://testnet.hashio.io/api" },
  gasCap: 15_000_000n,
  ensChainId: 11155111,
  nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: 18 },
};

/**
 * Avalanche's Fuji testnet, the C-Chain (EVM). The explorer is Snowtrace (Routescan), the one Avalanche's own tooling
 * links to. The default RPC is Avalanche's public endpoint, the extra one PublicNode's; both answered chain id 43113
 * on 2026-10-10. The faucet is the Builder Hub's (sign-in required). No EIP-7825 cap: the block gas limit applies.
 */
export const AVALANCHE_FUJI: ChainSpec = {
  id: 43113,
  name: "Avalanche Fuji",
  testnet: true,
  explorer: "https://testnet.snowtrace.io",
  faucet: "https://build.avax.network/console/primary-network/faucet",
  rpc: { default: "https://api.avax-test.network/ext/bc/C/rpc", extra: "https://avalanche-fuji-c-chain-rpc.publicnode.com" },
  ensChainId: 11155111,
  nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 },
};

/**
 * Local Anvil, only in end-to-end builds (contracts §5.5). Its shared-contract addresses equal every other
 * chain's. Tests point it at their own node through Settings → Networks (`settings.rpc[31337]`).
 */
export const ANVIL: ChainSpec = {
  id: 31337,
  name: "Anvil",
  testnet: true,
  rpc: { default: "http://127.0.0.1:8545" },
  ensChainId: null,
  nativeCurrency: ETHER,
};

/** Ethereum, only to resolve ENS for mainnets; it isn't in the picker while mainnets stay off (spec Phasing). */
export const ETHEREUM: ChainSpec = {
  id: 1,
  name: "Ethereum",
  testnet: false,
  explorer: "https://etherscan.io",
  rpc: { default: "https://ethereum.reth.rs/rpc", extra: "https://ethereum-rpc.publicnode.com" },
  gasCap: EIP7825_GAS_CAP,
  ensChainId: 1,
  nativeCurrency: ETHER,
};

/** The picker's chains, in display order; Anvil last and only when `e2e`. */
export function pickerChains(e2e: boolean): readonly ChainSpec[] {
  return e2e
    ? [SEPOLIA, BASE_SEPOLIA, HASHKEY_TESTNET, HEDERA_TESTNET, AVALANCHE_FUJI, ANVIL]
    : [SEPOLIA, BASE_SEPOLIA, HASHKEY_TESTNET, HEDERA_TESTNET, AVALANCHE_FUJI];
}

/** Every chain the module can read: the picker's, plus the ENS-only chains. */
export function knownChains(e2e: boolean): readonly ChainSpec[] {
  return [...pickerChains(e2e), ETHEREUM];
}

/** A picker chain by id. */
export function findChain(chainId: number, e2e: boolean): ChainSpec | undefined {
  return pickerChains(e2e).find((chain) => chain.id === chainId);
}

/** A readable chain by id (picker chains and Ethereum). */
export function findKnownChain(chainId: number, e2e: boolean): ChainSpec | undefined {
  return knownChains(e2e).find((chain) => chain.id === chainId);
}

/** "Sepolia" for 11155111; "Chain 5" for one Studio doesn't list. */
export function chainName(chainId: number, e2e: boolean): string {
  return findKnownChain(chainId, e2e)?.name ?? `Chain ${chainId}`;
}

/**
 * The picker chain a console argument names: its id, or its name ignoring case and spaces
 * ("sepolia", "Base Sepolia", "basesepolia", "hskchain-testnet", "hedera-testnet", "84532").
 */
export function chainFromText(text: string, e2e: boolean): ChainSpec | undefined {
  const trimmed = text.trim();
  if (/^\d+$/.test(trimmed)) return findChain(Number(trimmed), e2e);
  const key = trimmed.toLowerCase().replace(/[\s_-]+/g, "");
  return pickerChains(e2e).find((chain) => chain.name.toLowerCase().replace(/\s+/g, "") === key);
}

/** The picker's `ChainInfo` rows (contracts `ChainService.chains()`), without the RPC and ENS details. */
export function chainInfo(spec: ChainSpec): ChainInfo {
  return {
    id: spec.id,
    name: spec.name,
    testnet: spec.testnet,
    ...(spec.explorer ? { explorer: spec.explorer } : {}),
    ...(spec.faucet ? { faucet: spec.faucet } : {}),
  };
}

/**
 * Whether `text` is an RPC URL Studio will call: http(s) (the transports are HTTP; ws and wss aren't used), with a
 * host: a name (single-label such as `geth`, punycode, a trailing dot), an IPv4 address or a bracketed IPv6 one.
 * Anything else is never fetched. Settings → Networks can use it to say when an override won't be used; typing is
 * covered by the service's debounce.
 */
export function isRpcUrl(text: string | undefined): text is string {
  if (!text) return false;
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname;
  if (/^\[[0-9a-f:.]+\]$/i.test(host)) return true;
  return /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]*[a-z0-9])?\.?$/i.test(host);
}

/**
 * The fallback order (spec L841): the person's own RPC when set and valid, then the chain default, then one
 * extra. Duplicates collapse, keeping the first.
 */
export function rpcUrls(spec: ChainSpec, override: string | undefined): string[] {
  const own = isRpcUrl(override) ? override.trim() : undefined;
  const urls = [own, spec.rpc.default, spec.rpc.extra].filter((url): url is string => !!url);
  return [...new Set(urls)];
}

/**
 * The URLs Studio reads `spec` through: `rpcUrls` with the person's override for that chain. An end-to-end build
 * reads every chain through local Anvil instead (its override, then its default), so a test never reaches a public
 * Sepolia, Base Sepolia, HSKChain Testnet, Hedera Testnet, Avalanche Fuji or Ethereum RPC; the Anvil node stands in
 * for whichever chain is selected.
 */
export function readUrls(spec: ChainSpec, overrides: Readonly<Record<number, string>>, e2e: boolean): string[] {
  if (e2e && spec.id !== ANVIL.id) return rpcUrls(ANVIL, overrides[ANVIL.id]);
  return rpcUrls(spec, overrides[spec.id]);
}

/**
 * The URLs a wallet may see: the chain's public RPCs only, never the person's own, which can carry an API key
 * (WalletConnect sends a chain's `rpcUrls` through its relay). Anvil in end-to-end builds is the exception: its
 * node is local, and wagmi's mock connector reaches it through `rpcUrls`.
 */
export function publicRpcUrls(spec: ChainSpec, override: string | undefined): string[] {
  return spec.id === ANVIL.id ? rpcUrls(spec, override) : rpcUrls(spec, undefined);
}
