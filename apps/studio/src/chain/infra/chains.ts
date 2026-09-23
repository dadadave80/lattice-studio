/**
 * The chains Studio deploys to (spec Phasing: the v1 testnets) and the static facts about each: the picker's
 * `ChainInfo`, the default and extra RPCs for the fallback transport (spec L841), the per-transaction gas cap
 * where one is fixed (EIP-7825, spec R16) and the chain ENS names resolve on (spec L462).
 *
 * Plain data, no viem: the commands read it from the entry chunk. The lazy module turns it into viem chains.
 */
import type { ChainInfo } from "@/contracts";

export type ChainSpec = ChainInfo & {
  /** The chain's own public RPC ("the chain default") and one extra, in fallback order after the person's own. */
  rpc: { default: string; extra?: string };
  /** EIP-7825's 16,777,216 where it applies; else the latest block's gasLimit (contracts §3.1 `gasCap`). */
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
  return e2e ? [SEPOLIA, BASE_SEPOLIA, ANVIL] : [SEPOLIA, BASE_SEPOLIA];
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
 * ("sepolia", "Base Sepolia", "basesepolia", "84532").
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
 * Whether `text` is an RPC URL Studio will call: http(s), with a host that is `localhost`, an IP address, or a
 * name with a dot and a top-level label. Anything else (a half-typed override) is never fetched.
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
  if (host === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[")) return true;
  return /^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(host);
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
 * The URLs a wallet may see: the chain's public RPCs only, never the person's own, which can carry an API key
 * (WalletConnect sends a chain's `rpcUrls` through its relay). Anvil in end-to-end builds is the exception: its
 * node is local, and wagmi's mock connector reaches it through `rpcUrls`.
 */
export function publicRpcUrls(spec: ChainSpec, override: string | undefined): string[] {
  return spec.id === ANVIL.id ? rpcUrls(spec, override) : rpcUrls(spec, undefined);
}
