/**
 * viem clients per chain (spec L841): a `fallback` transport over the person's own RPC (Settings → Networks), the
 * chain default and one extra, each an HTTP transport with JSON-RPC batching. Clients are made on first use and
 * remade when the RPCs or their ranking change.
 *
 * Ranking is Studio's own, not viem's: viem's `rank` starts a ping loop per transport that can't be stopped, so a
 * replaced client would keep pinging its RPCs forever. Here one timer pings the RPCs of the chains in use, orders
 * them by answer time (a failed ping last), and stops when the service says so: offline, the tab hidden, disposed.
 */
import { createClient, fallback, http, type Chain, type Client, type Transport } from "viem";
import { ANVIL, isRpcUrl, knownChains, readUrls, type ChainSpec } from "./chains";

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

/** How often the RPCs of the chains in use are ranked, and how long a ping may take. */
export const RANK = { interval: 60_000, timeout: 2_000 } as const;

/**
 * The viem chain for a spec, with `urls` as its RPCs. wagmi and its connectors read `rpcUrls` (WalletConnect sends
 * them through its relay), so the wallet's chains get public URLs only; see `publicRpcUrls`.
 */
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

/** One transport over `urls`, in order: a single URL as is, several behind a `fallback` (no viem ranking). */
export function chainTransport(urls: readonly string[], make: TransportFactory): Transport {
  const transports = urls.map((url) => make(url));
  const [only] = transports;
  if (only && transports.length === 1) return only;
  return fallback(transports, { rank: false, retryCount: 1 });
}

export type ClientOptions = {
  /** The person's own RPC per chain (already debounced and checked by the service). */
  overrides?: Readonly<Record<number, string>>;
  /** End-to-end build: every chain is read through local Anvil (`readUrls`). */
  e2e?: boolean;
  transport?: TransportFactory;
  /** Ranking pass timing, and a clock for answer times; tests inject theirs. */
  interval?: number;
  clock?: () => number;
  setInterval?: (run: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
};

export type Clients = {
  /** The chain's client, made on first use and remade when its RPCs or their order change. */
  get(spec: ChainSpec): ChainClient;
  /** The chain's RPC URLs in fallback order, as the client uses them (ranked once a pass has run). */
  urls(spec: ChainSpec): string[];
  /** The chain's RPC URLs as configured, unranked: what a probe cache is keyed by. */
  key(spec: ChainSpec): string;
  /** Replaces the overrides; returns the ids of chains whose URLs changed. */
  setOverrides(next: Readonly<Record<number, string>>): number[];
  /** One ranking pass over the chains in use. */
  rank(): Promise<void>;
  /** Runs ranking passes on the interval while active; stops them otherwise. */
  setActive(active: boolean): void;
  dispose(): void;
};

export function createClients(options: ClientOptions = {}): Clients {
  const make = options.transport ?? httpTransport;
  const clock = options.clock ?? (() => performance.now());
  const every = options.setInterval ?? ((run, ms) => globalThis.setInterval(run, ms));
  const stopEvery = options.clearInterval ?? ((handle) => globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>));
  let overrides: Readonly<Record<number, string>> = options.overrides ?? {};
  const made = new Map<number, { key: string; spec: ChainSpec; client: ChainClient }>();
  /** Per chain: the configured URL set it was ranked for, and the ranked order. */
  const ranked = new Map<number, { set: string; order: string[] }>();
  let timer: unknown = null;

  const e2e = options.e2e ?? false;
  const configured = (spec: ChainSpec): string[] => readUrls(spec, overrides, e2e);
  const urlsOf = (spec: ChainSpec): string[] => {
    const urls = configured(spec);
    const found = ranked.get(spec.id);
    return found && found.set === urls.join(" ") ? [...found.order] : urls;
  };

  /** Milliseconds for `eth_blockNumber`, or Infinity when the RPC doesn't answer in time. */
  const ping = async (spec: ChainSpec, url: string): Promise<number> => {
    const started = clock();
    let expire: ReturnType<typeof setTimeout> | undefined;
    try {
      // A transport's own `retryCount` wins over the factory argument, so the no-retry goes on the request itself.
      const transport = make(url)({ chain: viemChain(spec, [url]) });
      await Promise.race([
        transport.request({ method: "eth_blockNumber" }, { retryCount: 0 }),
        new Promise((_, reject) => {
          expire = setTimeout(() => reject(new Error("timeout")), RANK.timeout);
        }),
      ]);
      return clock() - started;
    } catch {
      return Number.POSITIVE_INFINITY;
    } finally {
      clearTimeout(expire);
    }
  };

  const clients: Clients = {
    get(spec) {
      const urls = urlsOf(spec);
      const key = urls.join(" ");
      const found = made.get(spec.id);
      if (found && found.key === key) return found.client;
      const client = createClient({ chain: viemChain(spec, urls), transport: chainTransport(urls, make) });
      made.set(spec.id, { key, spec, client });
      return client;
    },
    urls: urlsOf,
    key: (spec) => configured(spec).join(" "),
    setOverrides(next) {
      const changed: number[] = [];
      const ids = new Set([...Object.keys(overrides), ...Object.keys(next)].map(Number));
      // What's actually used: an invalid override counts as none, so typing one changes nothing.
      const used = (text: string | undefined): string => (isRpcUrl(text) ? text.trim() : "");
      for (const id of ids) if (used(overrides[id]) !== used(next[id])) changed.push(id);
      // End to end, every chain reads through Anvil's RPC, so a change to it changes them all.
      if (e2e && changed.includes(ANVIL.id)) {
        for (const chain of knownChains(true)) if (!changed.includes(chain.id)) changed.push(chain.id);
      }
      overrides = { ...next };
      return changed;
    },
    async rank() {
      for (const { spec } of made.values()) {
        const urls = configured(spec);
        if (urls.length < 2) continue;
        const times = await Promise.all(urls.map((url) => ping(spec, url)));
        const order = urls.map((url, i) => ({ url, time: times[i] ?? Number.POSITIVE_INFINITY, i }))
          .sort((a, b) => a.time - b.time || a.i - b.i)
          .map((entry) => entry.url);
        ranked.set(spec.id, { set: urls.join(" "), order });
      }
    },
    setActive(active) {
      if (active && timer === null) timer = every(() => void clients.rank(), options.interval ?? RANK.interval);
      if (!active && timer !== null) {
        stopEvery(timer);
        timer = null;
      }
    },
    dispose() {
      clients.setActive(false);
      made.clear();
    },
  };
  return clients;
}
