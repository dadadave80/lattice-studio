/**
 * The chain service (contracts §5.2 "chain", `ChainService` in `contracts/chain.ts`): readiness probes cached per
 * session with their time (spec L842), code and loupe reads, ENS, and the wallet. It follows the stores itself:
 * choosing a chain, changing the deploy path, a new catalog, an RPC override or coming back online probes the
 * selected chain again, and going offline turns every chain's readiness into "Chain checks need a connection."
 * Online and offline come from the connection service; a failed RPC call reports itself there.
 *
 * `ChainRuntime` adds what the deploy engine (S8c) needs beyond the contract: each chain's viem client and wagmi's config.
 */
import type { Address, Catalog, ChainState, DeployPath, Hex, LoupeFacet, Result } from "@lattice-studio/core";
import { toChecksum } from "@lattice-studio/core";
import type { Config } from "@wagmi/core";
import { BaseError, ContractFunctionExecutionError, ContractFunctionZeroDataError, parseAbi } from "viem";
import { readContract } from "viem/actions";
import {
  doc, getCatalog, isOnline, now, session, settings, subscribeCatalog, subscribeOnline, type ChainReadiness, type ChainService,
  type WalletAccount, type WalletConnector,
} from "@/contracts";
import { reportConnectionFailure } from "@/contracts/services";
import { predict } from "@/state/prediction";
import { accountBalance, accountKind } from "./account";
import { chainInfo, chainName, findChain, findKnownChain, pickerChains, type ChainSpec } from "./chains";
import type { ChainClient, Clients } from "./clients";
import {
  CHAIN_CHECKS_NEED_CONNECTION, couldntRead, invalidEnsName, noEns, rpcNotAnswering, unsupportedChain,
} from "./copy";
import { loadNormalize, resolveName, reverseName, type Normalize } from "./ens";
import { isTransportFailure, probeChain, readCodeAt, type ProbeResult } from "./probe";
import { WALLETCONNECT_ID, WALLETCONNECT_NAME, type Wallet, type WalletState } from "./wallet";

export type ChainRuntime = ChainService & {
  /** The chain's viem client: the ranked fallback transport with JSON-RPC batching. Throws for a chain Studio doesn't list. */
  publicClient(chainId: number): ChainClient;
  /** wagmi's config, for the deploy engine's wallet actions (send, sendCalls, capabilities). Null without a wallet. */
  readonly wagmi: Config | null;
  /**
   * The deploy's gas estimate on a chain (S8c, after simulating), or null when it no longer applies. It lands in
   * the chain's `ChainState.gasEstimate`, so NET-06 weighs it against the cap.
   */
  noteEstimate(chainId: number, gas: bigint | null): void;
  /** Stops following the stores and the wallet. */
  dispose(): void;
};

export type ServiceOptions = {
  /** End-to-end build: the Anvil chain. */
  e2e: boolean;
  clients: Clients;
  /** Null: no wallet support (reads only). */
  wallet: Wallet | null;
  /** ENSIP-15 normalization, loaded on the first name. */
  normalize?: () => Promise<Normalize>;
};

/** `facets()` from the diamond's loupe. */
const LOUPE_ABI = parseAbi(["function facets() view returns ((address facetAddress, bytes4[] functionSelectors)[])"]);

type CacheEntry = {
  /** Catalog hash and RPC URLs the probe ran with; a change invalidates it. */
  key: string;
  base: ProbeResult;
  /** Every address asked about so far, lowercase. */
  codeAt: Record<string, Hex | "0x">;
};

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function createChainService(options: ServiceOptions): ChainRuntime {
  const { clients, wallet } = options;
  const specs = pickerChains(options.e2e);
  const normalizeLoader = options.normalize ?? loadNormalize;
  let normalizer: Promise<Normalize> | null = null;

  const readiness = new Map<number, ChainReadiness>();
  const readinessListeners = new Set<(chainId: number) => void>();
  const cache = new Map<number, CacheEntry>();
  /** S8c's gas estimate per chain, decimal. */
  const estimates = new Map<number, string>();
  const inflight = new Map<string, Promise<Result<ProbeResult, string>>>();
  const accountListeners = new Set<(account: WalletAccount | null) => void>();
  const connectorListeners = new Set<(connectors: readonly WalletConnector[]) => void>();
  let account: WalletAccount | null = null;
  let disposed = false;

  const setReadiness = (chainId: number, next: ChainReadiness): void => {
    const current = readiness.get(chainId);
    if (current && sameJson(current, next)) return;
    readiness.set(chainId, next);
    for (const listener of Array.from(readinessListeners)) listener(chainId);
  };

  const spec = (chainId: number): ChainSpec | undefined => findChain(chainId, options.e2e);
  const nameOf = (chainId: number): string => chainName(chainId, options.e2e);
  const unsupported = (chainId: number): string => unsupportedChain(nameOf(chainId), specs.map((s) => s.name));

  /** A failed read, in the spec's words; a transport failure also tells the connection service. */
  const failure = (chainId: number, error: unknown): string => {
    if (isTransportFailure(error)) reportConnectionFailure();
    return rpcNotAnswering(nameOf(chainId));
  };

  const cacheKey = (chain: ChainSpec, catalog: Catalog): string => `${catalog.hash}|${clients.urls(chain).join(" ")}`;

  /** The state a caller sees: CreateX only on the CreateX path, every address asked about, online now. */
  /** The diamond's predicted address on `chainId` for the connected account (S1's `predict`), lowercase. */
  const predictedAddress = (chainId: number, path: DeployPath): Address | null => {
    const prediction = predict({
      deploy: { ...doc.get().deploy, path },
      catalog: getCatalog(),
      chainId,
      account: account ? { address: account.address } : null,
    });
    return prediction.status === "ready" ? (prediction.address.toLowerCase() as Address) : null;
  };

  /**
   * The state a caller sees: CreateX only on the CreateX path, every address asked about, whether the predicted
   * address already has code (NET-05), the deploy's gas estimate when S8c noted one (NET-06), online now.
   */
  const compose = (entry: CacheEntry, path: DeployPath): ChainState => {
    const { createx, ...rest } = entry.base;
    const predicted = predictedAddress(rest.chainId, path);
    const code = predicted === null ? undefined : entry.codeAt[predicted];
    const estimate = estimates.get(rest.chainId);
    return {
      ...rest,
      ...(path === "createx" ? { createx } : {}),
      online: isOnline(),
      codeAt: { ...entry.codeAt },
      ...(code !== undefined ? { predictedHasCode: code !== "0x" } : {}),
      ...(estimate !== undefined ? { gasEstimate: estimate } : {}),
    };
  };

  const publish = (chainId: number, state: ChainState): ChainState => {
    const current = readiness.get(chainId);
    if (current?.status === "ready" && sameJson(current.state, state)) return current.state;
    setReadiness(chainId, { status: "ready", state });
    return state;
  };

  const probe: ChainService["probe"] = async (chainId, probeOptions = {}) => {
    const chain = spec(chainId);
    if (!chain) return { ok: false, error: unsupported(chainId) };
    if (!isOnline()) {
      setReadiness(chainId, { status: "error", reason: CHAIN_CHECKS_NEED_CONNECTION });
      return { ok: false, error: CHAIN_CHECKS_NEED_CONNECTION };
    }
    const catalog = getCatalog();
    if (!catalog) return { ok: false, error: "The catalog hasn't loaded yet." };
    const path = probeOptions.path ?? doc.get().deploy.path;
    // The predicted address is always read, so NET-05 knows whether it's taken.
    const predicted = predictedAddress(chainId, path);
    const asked = [...(probeOptions.codeAt ?? []), ...(predicted ? [predicted] : [])].map((address) => address.toLowerCase() as Address);
    const key = cacheKey(chain, catalog);
    const cached = cache.get(chainId);
    const client = clients.get(chain);

    if (!probeOptions.refresh && cached?.key === key) {
      const missing = asked.filter((address) => !Object.hasOwn(cached.codeAt, address));
      if (missing.length > 0) {
        try {
          Object.assign(cached.codeAt, await readCodeAt(client, missing));
        } catch (error) {
          return { ok: false, error: failure(chainId, error) };
        }
      }
      return { ok: true, value: publish(chainId, compose(cached, path)) };
    }

    const current = readiness.get(chainId);
    if (probeOptions.refresh || current?.status !== "ready") setReadiness(chainId, { status: "checking" });
    const addresses = [...new Set([...Object.keys(cached?.key === key ? cached.codeAt : {}), ...asked])] as Address[];
    const flight = `${chainId}|${key}|${addresses.join(",")}`;
    let running = inflight.get(flight);
    if (!running) {
      running = probeChain(client, {
        chainId,
        name: chain.name,
        catalog,
        ...(chain.gasCap !== undefined ? { gasCap: chain.gasCap } : {}),
        codeAt: addresses,
        online: true,
        probedAt: () => new Date(now()).toISOString(),
      }).then(
        (value): Result<ProbeResult, string> => ({ ok: true, value }),
        (error: unknown): Result<ProbeResult, string> => ({ ok: false, error: failure(chainId, error) }),
      );
      inflight.set(flight, running);
      void running.finally(() => inflight.delete(flight));
    }
    const result = await running;
    if (disposed) return result.ok ? { ok: true, value: result.value } : result;
    if (!result.ok) {
      setReadiness(chainId, { status: "error", reason: isOnline() ? couldntRead(chain.name) : CHAIN_CHECKS_NEED_CONNECTION });
      return result;
    }
    const entry: CacheEntry = { key, base: result.value, codeAt: { ...result.value.codeAt } };
    cache.set(chainId, entry);
    return { ok: true, value: publish(chainId, compose(entry, path)) };
  };

  // ---------------------------------------------------------------------------------------------------------
  // Wallet account: shown at once, then its kind, balance and primary name as they arrive.

  const emitAccount = (): void => {
    for (const listener of Array.from(accountListeners)) listener(account);
  };

  const enrich = async (state: WalletState): Promise<void> => {
    const chain = findKnownChain(state.chainId, options.e2e);
    if (!chain) return;
    const client = clients.get(chain);
    const settle = <T>(promise: Promise<T>): Promise<T | undefined> => promise.catch(() => undefined);
    const [kind, balance, ens] = await Promise.all([
      settle(accountKind(client, state.address)),
      settle(accountBalance(client, state.address)),
      settle(reverse(state.address, state.chainId).then((r) => (r.ok ? r.value : null))),
    ]);
    if (disposed || !account || account.address !== state.address || account.chainId !== state.chainId) return;
    account = {
      ...account,
      ...(kind ? { kind } : {}),
      ...(balance !== undefined ? { balance } : {}),
      ...(ens ? { ens } : {}),
    };
    emitAccount();
  };

  const follow = (state: WalletState | null): void => {
    const moved = account?.address !== state?.address;
    account = state ? { address: state.address, chainId: state.chainId, connector: state.connector } : null;
    emitAccount();
    // A new account predicts a new address: read whether it's free.
    if (moved) reprobe(selected());
    if (state) void enrich(state);
  };

  // ---------------------------------------------------------------------------------------------------------
  // ENS

  const ensClient = (chainId: number): { client: ChainClient; ensChainId: number } | { error: string } => {
    const chain = findKnownChain(chainId, options.e2e);
    if (!chain) return { error: unsupported(chainId) };
    if (chain.ensChainId === null) return { error: noEns(chain.name) };
    const ensChain = findKnownChain(chain.ensChainId, options.e2e);
    if (!ensChain) return { error: noEns(chain.name) };
    return { client: clients.get(ensChain), ensChainId: ensChain.id };
  };

  const resolve: ChainService["resolveEns"] = async (name, chainId) => {
    const target = ensClient(chainId);
    if ("error" in target) return { ok: false, error: target.error };
    normalizer ??= normalizeLoader();
    let normalize: Normalize;
    try {
      normalize = await normalizer;
    } catch (error) {
      normalizer = null;
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    try {
      normalize(name.trim());
    } catch {
      return { ok: false, error: invalidEnsName(name) };
    }
    try {
      return { ok: true, value: await resolveName(target.client, normalize, name, chainId, target.ensChainId) };
    } catch (error) {
      return { ok: false, error: failure(target.ensChainId, error) };
    }
  };

  const reverse: ChainService["reverseEns"] = async (address, chainId) => {
    const target = ensClient(chainId);
    if ("error" in target) return { ok: false, error: target.error };
    try {
      return { ok: true, value: await reverseName(target.client, address, chainId, target.ensChainId) };
    } catch (error) {
      return { ok: false, error: failure(target.ensChainId, error) };
    }
  };

  // ---------------------------------------------------------------------------------------------------------
  // Following the stores

  const selected = (): number | null => session.get().chainId;
  const reprobe = (chainId: number | null, refresh = false): void => {
    if (chainId === null || disposed || !spec(chainId)) return;
    void probe(chainId, refresh ? { refresh: true } : {});
  };

  const stops: (() => void)[] = [
    session.subscribe((state, previous) => {
      if (state.chainId !== previous.chainId) reprobe(state.chainId);
    }),
    doc.subscribe((state, previous) => {
      // Path, salt entropy or scope: CreateX's probe, and a new predicted address to check.
      if (state.project.deploy !== previous.project.deploy) reprobe(selected());
    }),
    subscribeCatalog(() => reprobe(selected())),
    subscribeOnline((online) => {
      if (online) {
        reprobe(selected());
        return;
      }
      for (const [chainId, state] of readiness) {
        if (state.status !== "unknown") setReadiness(chainId, { status: "error", reason: CHAIN_CHECKS_NEED_CONNECTION });
      }
    }),
    settings.subscribe((state, previous) => {
      if (state.rpc === previous.rpc) return;
      for (const chain of specs) {
        if ((state.rpc[chain.id] ?? "") === (previous.rpc[chain.id] ?? "")) continue;
        cache.delete(chain.id);
        if (chain.id === selected()) reprobe(chain.id, true);
      }
    }),
  ];
  if (wallet) {
    stops.push(wallet.subscribe(follow));
    stops.push(wallet.subscribeConnectors((list) => {
      for (const listener of Array.from(connectorListeners)) listener(list);
    }));
    const initial = wallet.state();
    if (initial) follow(initial);
  }
  reprobe(selected());

  const client = (chainId: number): ChainClient => {
    const chain = findKnownChain(chainId, options.e2e);
    if (!chain) throw new Error(unsupported(chainId));
    return clients.get(chain);
  };

  const service: ChainRuntime = {
    chains: () => specs.map(chainInfo),
    probe,
    readiness: (chainId) => readiness.get(chainId) ?? { status: "unknown" },
    subscribeReadiness(listener) {
      readinessListeners.add(listener);
      return () => {
        readinessListeners.delete(listener);
      };
    },
    async codeAt(chainId, address) {
      const chain = spec(chainId);
      if (!chain) return { ok: false, error: unsupported(chainId) };
      try {
        const code = (await readCodeAt(clients.get(chain), [address]))[address.toLowerCase()] ?? "0x";
        const entry = cache.get(chainId);
        if (entry) entry.codeAt[address.toLowerCase()] = code;
        return { ok: true, value: code };
      } catch (error) {
        return { ok: false, error: failure(chainId, error) };
      }
    },
    async readFacets(chainId, address) {
      const chain = spec(chainId);
      if (!chain) return { ok: false, error: unsupported(chainId) };
      try {
        const facets = await readContract(clients.get(chain), { address, abi: LOUPE_ABI, functionName: "facets" });
        return {
          ok: true,
          value: facets.map((facet): LoupeFacet => ({
            facetAddress: toChecksum(facet.facetAddress),
            functionSelectors: facet.functionSelectors.map((selector) => selector.toLowerCase() as Hex),
          })),
        };
      } catch (error) {
        if (!isTransportFailure(error) && error instanceof BaseError
          && error.walk((e) => e instanceof ContractFunctionZeroDataError || e instanceof ContractFunctionExecutionError)) {
          return { ok: false, error: `There's no diamond at ${toChecksum(address)} on ${chain.name}.` };
        }
        return { ok: false, error: failure(chainId, error) };
      }
    },
    resolveEns: resolve,
    reverseEns: reverse,
    connectors: () => wallet?.connectors() ?? [{ id: WALLETCONNECT_ID, name: WALLETCONNECT_NAME, kind: "walletconnect" }],
    subscribeConnectors(listener) {
      connectorListeners.add(listener);
      return () => {
        connectorListeners.delete(listener);
      };
    },
    account: () => account,
    subscribeAccount(listener) {
      accountListeners.add(listener);
      return () => {
        accountListeners.delete(listener);
      };
    },
    async connect(connector) {
      if (!wallet) return { ok: false, error: "Wallet support isn't available." };
      const result = await wallet.connect(connector);
      if (!result.ok) return result;
      if (!account || account.address !== result.value.address || account.chainId !== result.value.chainId) follow(result.value);
      return { ok: true, value: account ?? { ...result.value } };
    },
    async disconnect() {
      await wallet?.disconnect();
    },
    async switchNetwork(chainId) {
      const chain = spec(chainId);
      if (!chain) return { ok: false, error: unsupported(chainId) };
      if (!wallet) return { ok: false, error: "Wallet support isn't available." };
      return wallet.switchChain(chainId, chain.rpc.default);
    },
    publicClient: client,
    noteEstimate(chainId, gas) {
      if (gas === null) estimates.delete(chainId);
      else estimates.set(chainId, gas.toString());
      const entry = cache.get(chainId);
      if (entry && readiness.get(chainId)?.status === "ready") publish(chainId, compose(entry, doc.get().deploy.path));
    },
    wagmi: wallet?.config ?? null,
    dispose() {
      disposed = true;
      for (const stop of stops.splice(0)) stop();
      readinessListeners.clear();
      accountListeners.clear();
      connectorListeners.clear();
    },
  };
  return service;
}
