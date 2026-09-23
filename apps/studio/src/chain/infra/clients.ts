/**
 * viem clients per chain (spec L841): a `fallback` transport with ranking over the person's own RPC (Settings →
 * Networks), the chain default and one extra, each an HTTP transport with JSON-RPC batching. Clients are made on
 * first use (ranking pings the RPCs once a client exists) and remade when the person's RPC changes.
 */
import { createClient, fallback, http, type Chain, type Client, type Transport } from "viem";
import { rpcUrls, type ChainSpec } from "./chains";

/**
 * A chain's viem client, bare: callers import the actions they use from `viem/actions`, so the lazy chunk carries
 * only those (spec L813: each lazy feature ≤ 70 KB gz), not every public action.
 */
export type ChainClient = Client<Transport, Chain>;

/** ENS's Universal Resolver, the same address on Ethereum and Sepolia (viem's chain definitions). */
export const ENS_UNIVERSAL_RESOLVER = "0xeeeeeeee14d718c2b47d9923deab1335e144eeee" as const;

/** Makes the transport for one RPC URL. Tests pass EIP-1193 mocks through viem's `custom`. */
export type TransportFactory = (url: string) => Transport;

/** HTTP with batching: probes go out as a few JSON-RPC batches (spec L841). Short timeouts, so the fallback moves on. */
export const httpTransport: TransportFactory = (url) => http(url, { batch: { batchSize: 25 }, retryCount: 1, timeout: 10_000 });

/**
 * Ranking pings every transport on an interval once the client exists. Once a minute keeps that to a handful
 * of calls per RPC; the fallback still moves on at once when a call fails.
 */
export const RANK = { interval: 60_000, sampleCount: 5, timeout: 2_000 } as const;

/** The viem chain for a spec, with the RPCs in fallback order (wagmi and the mock connector read `rpcUrls`). */
export function viemChain(spec: ChainSpec, urls: readonly string[]): Chain {
  return {
    id: spec.id,
    name: spec.name,
    nativeCurrency: spec.nativeCurrency,
    rpcUrls: { default: { http: urls.length > 0 ? [...urls] : [spec.rpc.default] } },
    ...(spec.explorer ? { blockExplorers: { default: { name: `${spec.name} explorer`, url: spec.explorer } } } : {}),
    ...(spec.ensChainId === spec.id ? { contracts: { ensUniversalResolver: { address: ENS_UNIVERSAL_RESOLVER } } } : {}),
    testnet: spec.testnet,
  };
}

/** One transport over `urls`: a single URL as is, several behind a ranked `fallback`. */
export function chainTransport(urls: readonly string[], make: TransportFactory, rank: boolean): Transport {
  const transports = urls.map((url) => make(url));
  const [only] = transports;
  if (only && transports.length === 1) return only;
  return fallback(transports, { rank: rank ? RANK : false, retryCount: 1 });
}

export type ClientOptions = {
  /** `settings.rpc`: the person's own RPC per chain. */
  overrides: () => Readonly<Record<number, string>>;
  transport?: TransportFactory;
  /** Default true. Tests turn it off so no timer outlives them. */
  rank?: boolean;
};

export type Clients = {
  /** The chain's client, made on first use and remade when its RPC override changes. */
  get(spec: ChainSpec): ChainClient;
  /** The chain's RPC URLs in fallback order, as the client uses them. */
  urls(spec: ChainSpec): string[];
};

export function createClients(options: ClientOptions): Clients {
  const make = options.transport ?? httpTransport;
  const rank = options.rank ?? true;
  const made = new Map<number, { key: string; client: ChainClient }>();
  const urlsOf = (spec: ChainSpec): string[] => rpcUrls(spec, options.overrides()[spec.id]);
  return {
    get(spec) {
      const urls = urlsOf(spec);
      const key = urls.join(" ");
      const found = made.get(spec.id);
      if (found && found.key === key) return found.client;
      const client = createClient({ chain: viemChain(spec, urls), transport: chainTransport(urls, make, rank) });
      made.set(spec.id, { key, client });
      return client;
    },
    urls: urlsOf,
  };
}
