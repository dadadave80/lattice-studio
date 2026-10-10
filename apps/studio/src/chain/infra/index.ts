/**
 * The chain module's light surface (S8a): the chain table, the Flow 14 wording, the lazy boundary's state and
 * status line, and a typed way for the deploy engine to reach the full runtime. Light on purpose: importing this
 * barrel never pulls viem's clients or wagmi into a chunk; `chainService()` (contracts) loads them.
 */
import type { Catalog } from "@lattice-studio/core";
import { chainService, type ChainService } from "@/contracts";
import type { ChainRuntime } from "./service";

export {
  ANVIL, AVALANCHE_FUJI, BASE_SEPOLIA, EIP7825_GAS_CAP, ETHEREUM, HASHKEY_TESTNET, SEPOLIA, chainFromText, chainInfo, chainName, findChain, isRpcUrl,
  pickerChains, publicRpcUrls, rpcUrls,
} from "./chains";
export type { ChainSpec } from "./chains";
export {
  CANCELED_IN_WALLET, CHAIN_CHECKS_NEED_CONNECTION, CHOOSE_A_CHAIN, CONNECT_A_WALLET, LOADING_WALLET_SUPPORT, NO_WALLET,
  checking, couldntRead, needsFunds, rpcNotAnswering, walletOn,
} from "./copy";
export { CHAIN_COMMANDS } from "./chain-commands";
export { chainLoader, createChainLoader, useChainLoad } from "./loader";
export type { ChainLoader, ChainLoadState } from "./loader";
export { WalletSupportStatus } from "./WalletSupportStatus";
export type { ChainRuntime } from "./service";

/** Contracts §4: a fixture catalog can't deploy. S8b disables Deploy with this reason. */
export const FIXTURE_CATALOG = "Fixture catalog: build the real catalog first";

/** Why this catalog can't deploy, or null. */
export function catalogDeployBlock(catalog: Pick<Catalog, "lattice">): string | null {
  return catalog.lattice.tag === "fixture" || catalog.lattice.tag.startsWith("fixture-") ? FIXTURE_CATALOG : null;
}

/** True when the chain service is the real runtime (tests serve fakes without the viem clients). */
export function isChainRuntime(service: ChainService): service is ChainRuntime {
  return typeof (service as Partial<ChainRuntime>).publicClient === "function";
}

/**
 * The full runtime for the deploy engine (S8c): the service plus each chain's viem client and wagmi's config.
 * Rejects when the service is a test fake, with the reason.
 */
export async function loadChainRuntime(): Promise<ChainRuntime> {
  const service = await chainService();
  if (isChainRuntime(service)) return service;
  throw new Error("The chain service in use has no viem clients (a test fake).");
}
