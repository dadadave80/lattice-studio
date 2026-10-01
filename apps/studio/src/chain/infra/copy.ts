/**
 * The chain module's words, quoted from the spec: Flow 14's recovery table (spec L586-L606), the chain rows'
 * loading and error states (spec L697) and the lazy boundary's "Loading wallet support…" (spec L562).
 * Light: the commands and the loader read it from the entry chunk.
 */
import { formatFee } from "@lattice-studio/core";

/** Spec L562: shown while the lazy chain module loads. */
export const LOADING_WALLET_SUPPORT = "Loading wallet support…";

/** Spec L697: a chain row while its probes run. */
export function checking(chain: string): string {
  return `Checking ${chain}…`;
}

/** Spec L697: a chain row whose probes failed; the readiness reason. */
export function couldntRead(chain: string): string {
  return `Couldn't read ${chain}: the RPC didn't answer.`;
}

/** Flow 14, RPC down or rate-limited: every failed read's `Result` error. */
export function rpcNotAnswering(chain: string): string {
  return `${chain}'s public RPC isn't answering.`;
}

/** Spec L697: chain rows while offline. */
export const CHAIN_CHECKS_NEED_CONNECTION = "Chain checks need a connection.";

/** Flow 14: no wallet in the browser. */
export const NO_WALLET = "No wallet found in this browser.";

/** Flow 12 step 5: the person rejected the request in their wallet. */
export const CANCELED_IN_WALLET = "You canceled in your wallet.";

/** Flow 14: the wallet is on another chain than the one selected. */
export function walletOn(chain: string): string {
  return `Your wallet is on ${chain}.`;
}

/** Flow 14, not enough funds: "Needs about 0.012 ETH; this account has 0.004." */
export function needsFunds(needed: bigint, balance: bigint, symbol = "ETH", decimals = 18): string {
  const has = formatFee(balance, symbol, decimals).replace(new RegExp(` ${symbol}$`), "");
  return `Needs about ${formatFee(needed, symbol, decimals)}; this account has ${has}.`;
}

/** Nothing selected yet: the chain commands need a chain. */
export const CHOOSE_A_CHAIN = "Choose a chain first.";

/** `wallet.switchNetwork` with no wallet connected. */
export const CONNECT_A_WALLET = "Connect a wallet first.";

/** "Sepolia, Base Sepolia or HSKChain Testnet". */
export function orList(names: readonly string[]): string {
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names.at(-1) ?? ""}` : (names[0] ?? "");
}

/** A chain the picker doesn't list. */
export function unsupportedChain(text: string, names: readonly string[]): string {
  return `Studio doesn't deploy to ${text}. Choose ${orList(names)}.`;
}

/** ENS isn't available on a chain with no ENS deployment (Anvil). */
export function noEns(chain: string): string {
  return `ENS isn't available on ${chain}.`;
}

/** An RPC override that isn't an http(s) URL with a host: Studio keeps using the chain's public RPCs. */
export function overrideIgnored(chain: string): string {
  return `The RPC set for ${chain} isn't an http(s) URL, so Studio uses ${chain}'s public RPCs.`;
}

/** An ENS name that doesn't normalize (ENSIP-15). */
export function invalidEnsName(name: string): string {
  return `“${name}” isn't a valid ENS name.`;
}

/** WalletConnect without a project id in this build (CCR: `env.walletConnectProjectId`). */
export const WALLETCONNECT_NOT_SET_UP = "WalletConnect isn't set up in this build of Studio.";
