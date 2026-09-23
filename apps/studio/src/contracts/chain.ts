/**
 * The chain service's shape (contracts §5.2 "chain"): what the lazy chain module (S8a) offers the rest of the
 * app. `chainService()` in `services.ts` returns a promise for it. Failures are `Result`s whose error is the
 * spec's sentence ("Sepolia's public RPC isn't answering.", spec L586-L606), ready to show.
 */
import type { Address, ChainState, DeployPath, Hex, LoupeFacet, Result } from "@lattice-studio/core";

/** A chain Studio can deploy to. */
export type ChainInfo = {
  id: number;
  /** "Sepolia", "Base Sepolia". */
  name: string;
  testnet: boolean;
  /** Block explorer base URL. */
  explorer?: string;
  /** Faucet link for testnets (Flow 14, not enough funds). */
  faucet?: string;
};

/** What kind of account is connected (spec L564). */
export type AccountKind = "eoa" | "delegated" | "smart" | "safe";

/** The connected wallet account. */
export type WalletAccount = {
  address: Address;
  /** The chain the wallet is on, which can differ from the selected chain. */
  chainId: number;
  /** The connector's id (see `WalletConnector`). */
  connector: string;
  kind?: AccountKind;
  /** Primary ENS name, when it has one. */
  ens?: string;
  /** Balance in wei on `chainId`. */
  balance?: bigint;
};

/** A wallet the person can connect: EIP-6963 announcements, WalletConnect, and wagmi's mock in e2e builds. */
export type WalletConnector = {
  id: string;
  /** "MetaMask", "Rabby", "Other wallets (QR)". */
  name: string;
  kind: "injected" | "walletconnect" | "mock";
  /** EIP-6963 reverse-DNS id, for injected wallets. */
  rdns?: string;
  /** EIP-6963 icon: a data URI. */
  icon?: string;
};

/** Options for a readiness probe. */
export type ProbeOptions = {
  /** Probes CreateX too on the CreateX path. */
  path?: DeployPath;
  /** Addresses to read code at, into `ChainState.codeAt`: authority holders, Safe addresses. */
  codeAt?: readonly Address[];
  /** Ignores the per-session cache. */
  refresh?: boolean;
};

/**
 * A chain's readiness as the service last knew it: "Checking Sepolia…", the probes, or
 * "Couldn't read Sepolia: the RPC didn't answer." (spec L697-L698).
 */
export type ChainReadiness =
  | { status: "unknown" }
  | { status: "checking" }
  | { status: "ready"; state: ChainState }
  | { status: "error"; reason: string };

export type ChainService = {
  /** Chains in the picker, in display order. */
  chains(): readonly ChainInfo[];
  /** Readiness probes as `ChainState`, cached per session with `probedAt`. */
  probe(chainId: number, options?: ProbeOptions): Promise<Result<ChainState, string>>;
  /** The last probe's outcome, without probing. */
  readiness(chainId: number): ChainReadiness;
  /** Calls back with the chain id whenever its readiness changes (a probe starts, finishes or fails). */
  subscribeReadiness(listener: (chainId: number) => void): () => void;
  /** Runtime code at `address`, "0x" when there is none. */
  codeAt(chainId: number, address: Address): Promise<Result<Hex | "0x", string>>;
  /** A diamond's `facets()` (the loupe), for the Comparison view and the post-deploy check. */
  readFacets(chainId: number, address: Address): Promise<Result<LoupeFacet[], string>>;
  /** ENS name → address (mainnet for mainnets, Sepolia for testnets; ENSIP-11 elsewhere). Null: no record. */
  resolveEns(name: string, chainId: number): Promise<Result<Address | null, string>>;
  /** Address → primary name. Null: none set. */
  reverseEns(address: Address, chainId: number): Promise<Result<string | null, string>>;
  /** Wallets found so far (EIP-6963 announcements arrive over time), then Other wallets (QR). */
  connectors(): readonly WalletConnector[];
  subscribeConnectors(listener: (connectors: readonly WalletConnector[]) => void): () => void;
  /** The connected account, or null. */
  account(): WalletAccount | null;
  subscribeAccount(listener: (account: WalletAccount | null) => void): () => void;
  /** Connects a wallet by connector id; without one, the first injected ("No wallet found in this browser."). */
  connect(connector?: string): Promise<Result<WalletAccount, string>>;
  disconnect(): Promise<void>;
  /** Asks the wallet to switch, adding the chain when it doesn't know it (error 4902). */
  switchNetwork(chainId: number): Promise<Result<void, string>>;
};
