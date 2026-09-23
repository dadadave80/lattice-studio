/**
 * Wallets through `@wagmi/core` (wagmi v3's framework-free core, spec decision 13): browser wallets found through
 * EIP-6963 (wagmi's `multiInjectedProviderDiscovery`), WalletConnect as "Other wallets (QR)", loaded only when
 * chosen, and wagmi's `mock` connector in end-to-end builds. The React bindings and TanStack Query aren't used:
 * the rest of Studio reads the wallet through `ChainService`, so the lazy chunk stays small.
 */
import type { Address, Result } from "@lattice-studio/core";
import { toChecksum } from "@lattice-studio/core";
import {
  connect, createConfig, createStorage, disconnect, getConnection, getConnectors, injected, reconnect, switchChain,
  watchConnection, watchConnectors, type Config, type Connector, type CreateConnectorFn,
} from "@wagmi/core";
import { BaseError, type Chain, type Transport } from "viem";
import type { WalletConnector } from "@/contracts";
import { CANCELED_IN_WALLET, CONNECT_A_WALLET, NO_WALLET } from "./copy";

/** The WalletConnect row's connector id and name (spec L564). */
export const WALLETCONNECT_ID = "walletConnect";
export const WALLETCONNECT_NAME = "Other wallets (QR)";
/** A browser wallet that doesn't announce itself through EIP-6963, reached through `window.ethereum`. */
export const LEGACY_INJECTED_ID = "injected";
export const LEGACY_INJECTED_NAME = "Browser wallet";

export type WalletState = { address: Address; chainId: number; connector: string };

export type WalletOptions = {
  /** The picker's chains. */
  chains: readonly [Chain, ...Chain[]];
  /** Each chain's transport (the fallback transport, through the service's clients). */
  transport: (chainId: number) => Transport;
  /** Connectors besides EIP-6963's: wagmi's `mock` in end-to-end builds. */
  connectors?: CreateConnectorFn[];
  /** EIP-6963 discovery. Needs `window`. Default true. */
  discovery?: boolean;
  /** Where wagmi remembers the last connection, for reconnecting after a reload; null keeps it in memory. */
  storage?: Storage | null;
  /** WalletConnect's connector, loaded when chosen; an error says why it can't be used. */
  walletConnect?: () => Promise<Result<CreateConnectorFn, string>>;
  /** Whether `window.ethereum` exists (a wallet without EIP-6963). */
  legacyInjected?: () => boolean;
};

export type Wallet = {
  readonly config: Config;
  connectors(): readonly WalletConnector[];
  subscribeConnectors(listener: (connectors: readonly WalletConnector[]) => void): () => void;
  state(): WalletState | null;
  subscribe(listener: (state: WalletState | null) => void): () => void;
  connect(id?: string): Promise<Result<WalletState, string>>;
  disconnect(): Promise<void>;
  /** `publicRpc`: what the wallet adds on error 4902; never the person's own RPC, which may carry a key. */
  switchChain(chainId: number, publicRpc: string): Promise<Result<void, string>>;
  /** Restores the last connection after a reload. */
  reconnect(): Promise<void>;
};

/** A wallet error in the spec's words: a rejection, no wallet, else the error's own short message. */
export function walletError(error: unknown): string {
  if (error instanceof BaseError) {
    const rejected = error.walk((e) => (e as { code?: unknown }).code === 4001 || (e instanceof Error && e.name === "UserRejectedRequestError"));
    if (rejected) return CANCELED_IN_WALLET;
    if (error.walk((e) => e instanceof Error && e.name === "ProviderNotFoundError")) return NO_WALLET;
    return error.shortMessage;
  }
  if ((error as { code?: unknown } | null)?.code === 4001) return CANCELED_IN_WALLET;
  return error instanceof Error ? error.message : String(error);
}

function kindOf(connector: Connector): WalletConnector["kind"] | null {
  if (connector.type === "mock") return "mock";
  if (connector.type === "walletConnect") return null;
  return "injected";
}

function describe(connector: Connector): WalletConnector | null {
  const kind = kindOf(connector);
  if (!kind) return null;
  const rdns = typeof connector.rdns === "string" ? connector.rdns : connector.rdns?.[0];
  return {
    id: connector.id,
    name: connector.name,
    kind,
    ...(rdns ? { rdns } : {}),
    ...(connector.icon ? { icon: connector.icon } : {}),
  };
}

function sameState(a: WalletState | null, b: WalletState | null): boolean {
  if (a === null || b === null) return a === b;
  return a.address === b.address && a.chainId === b.chainId && a.connector === b.connector;
}

export function createWallet(options: WalletOptions): Wallet {
  const transports = Object.fromEntries(options.chains.map((chain) => [chain.id, options.transport(chain.id)])) as Record<number, Transport>;
  const config = createConfig({
    chains: options.chains,
    transports,
    connectors: options.connectors ?? [],
    multiInjectedProviderDiscovery: options.discovery ?? true,
    storage: options.storage ? createStorage({ storage: options.storage, key: "lattice-studio.wagmi" }) : null,
  });
  const legacy = options.legacyInjected ?? (() => typeof window !== "undefined" && "ethereum" in window);

  const list = (): WalletConnector[] => {
    const found = getConnectors(config).map(describe).filter((c): c is WalletConnector => c !== null);
    const injectedRows = found.filter((c) => c.kind === "injected");
    const rows = injectedRows.length === 0 && legacy()
      ? [{ id: LEGACY_INJECTED_ID, name: LEGACY_INJECTED_NAME, kind: "injected" as const }, ...found]
      : found;
    return [...rows, { id: WALLETCONNECT_ID, name: WALLETCONNECT_NAME, kind: "walletconnect" }];
  };

  const read = (): WalletState | null => {
    const connection = getConnection(config);
    if (connection.status !== "connected") return null;
    return { address: toChecksum(connection.address), chainId: connection.chainId, connector: connection.connector.id };
  };

  const connectWith = async (connector: Connector | CreateConnectorFn): Promise<Result<WalletState, string>> => {
    const current = read();
    if (current && typeof connector !== "function" && connector.id === current.connector) return { ok: true, value: current };
    try {
      await connect(config, { connector });
    } catch (error) {
      if (error instanceof Error && error.name === "ConnectorAlreadyConnectedError" && current) return { ok: true, value: current };
      return { ok: false, error: walletError(error) };
    }
    const now = read();
    return now ? { ok: true, value: now } : { ok: false, error: NO_WALLET };
  };

  return {
    config,
    connectors: list,
    subscribeConnectors(listener) {
      return watchConnectors(config, { onChange: () => listener(list()) });
    },
    state: read,
    subscribe(listener) {
      let last = read();
      return watchConnection(config, {
        onChange: () => {
          const next = read();
          if (sameState(last, next)) return;
          last = next;
          listener(next);
        },
      });
    },
    async connect(id) {
      if (id === WALLETCONNECT_ID) {
        const loaded = options.walletConnect ? await options.walletConnect() : { ok: false as const, error: NO_WALLET };
        return loaded.ok ? connectWith(loaded.value) : loaded;
      }
      const connectors = getConnectors(config);
      if (id === undefined) {
        const first = connectors.find((c) => kindOf(c) === "injected") ?? connectors.find((c) => kindOf(c) === "mock");
        if (first) return connectWith(first);
        return legacy() ? connectWith(injected()) : { ok: false, error: NO_WALLET };
      }
      if (id === LEGACY_INJECTED_ID && !connectors.some((c) => c.id === id)) {
        return legacy() ? connectWith(injected()) : { ok: false, error: NO_WALLET };
      }
      const chosen = connectors.find((c) => c.id === id);
      return chosen ? connectWith(chosen) : { ok: false, error: NO_WALLET };
    },
    async disconnect() {
      if (read()) await disconnect(config);
    },
    async switchChain(chainId, publicRpc) {
      if (!read()) return { ok: false, error: CONNECT_A_WALLET };
      try {
        await switchChain(config, { chainId, addEthereumChainParameter: { rpcUrls: [publicRpc] } });
        return { ok: true, value: undefined };
      } catch (error) {
        return { ok: false, error: walletError(error) };
      }
    },
    async reconnect() {
      try {
        await reconnect(config);
      } catch {
        // Nothing to restore, or the wallet declined: the person connects again.
      }
    },
  };
}
