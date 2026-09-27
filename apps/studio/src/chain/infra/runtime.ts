/**
 * The lazy chain module's entry (spec L822): what `import("./runtime")` loads the first time anything calls
 * `chainService()`. It builds the clients, the wagmi config and the service once per page, restores the last
 * wallet connection, and loads the end-to-end pieces (Anvil, the mock connector) only in an e2e build.
 */
import type { Result } from "@lattice-studio/core";
import type { CreateConnectorFn } from "@wagmi/core";
import type { Chain } from "viem";
import { custom } from "viem";
import { env, log, settings } from "@/contracts";
import { findKnownChain, pickerChains, publicRpcUrls } from "./chains";
import { createClients, viemChain, type Clients } from "./clients";
import { WALLETCONNECT_NOT_SET_UP } from "./copy";
import { createChainService, type ChainRuntime } from "./service";
import { createWallet, type Wallet } from "./wallet";

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Every call through wagmi goes to the service's current client for that chain, so an RPC override applies at once. */
export function delegate(clients: Clients, chainId: number): ReturnType<typeof custom> {
  return custom({
    request: ({ method, params }) => {
      const spec = findKnownChain(chainId, env.e2e);
      if (!spec) throw new Error(`Chain ${chainId} isn't one Studio reads.`);
      return clients.get(spec).request({ method, params } as never);
    },
  });
}

type WalletConnectImporter = () => Promise<Pick<typeof import("./walletconnect"), "walletConnectConnector">>;

/**
 * WalletConnect's connector, loaded when chosen. "Off until chosen" (spec L635): the setting turns on only once its
 * code has actually loaded; a failed load leaves it off (and S11a's banner speaks for the failed chunk).
 */
export async function loadWalletConnect(
  projectId: string | undefined,
  importer: WalletConnectImporter,
): Promise<Result<CreateConnectorFn, string>> {
  if (!projectId) return { ok: false, error: WALLETCONNECT_NOT_SET_UP };
  const { walletConnectConnector } = await importer();
  settings.set({ walletConnect: true });
  return { ok: true, value: walletConnectConnector(projectId) };
}

/**
 * WalletConnect's own chunk, or null in a build without a project id. The id itself is `env.walletConnectProjectId`;
 * this direct read of the same variable only gates the `import()`, because the bundler can fold a literal here but
 * not a property of `env` read from another module. Unfolded, the `import()` makes every viem, ox and noble module
 * the chain module shares with WalletConnect's SDK common to two lazy chunks, and the build's first-load group then
 * moves them into the entry (+79 KB gz).
 */
const importWalletConnect: WalletConnectImporter | null = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID
  ? () => import("./walletconnect")
  : null;

/**
 * The wallet's WalletConnect loader: with a project id and its chunk, loads the connector when chosen; without
 * either, choosing "Other wallets (QR)" says WalletConnect isn't set up in this build and fetches nothing.
 */
export function walletConnectLoader(
  projectId: string | undefined,
  importer: WalletConnectImporter | null,
): () => Promise<Result<CreateConnectorFn, string>> {
  return () => (importer ? loadWalletConnect(projectId, importer) : Promise.resolve({ ok: false, error: WALLETCONNECT_NOT_SET_UP }));
}

/**
 * Settings → Wallet (spec L635) as the chain module sees it. On: WalletConnect's connector is registered, so its
 * session is restored after a reload. Turned on with no project id, or with a chunk that won't load, it goes back
 * off, and the console says why (a failed chunk is S11a's banner's to say). Off: a WalletConnect session ends and
 * the connector is dropped, so its relay sees nothing more. "Other wallets (QR)" stays listed either way: choosing
 * it is what turns the setting on ("off until chosen"; spec L564, L590). Returns the unsubscribe.
 */
export function followWalletConnectSetting(wallet: Pick<Wallet, "loadWalletConnect" | "dropWalletConnect">): () => void {
  const load = async (): Promise<void> => {
    let loaded: Result<void, string>;
    try {
      loaded = await wallet.loadWalletConnect();
    } catch {
      loaded = { ok: false, error: "" };
    }
    if (loaded.ok || !settings.get().walletConnect) return;
    settings.set({ walletConnect: false });
    if (loaded.error) log({ tag: "Note", text: loaded.error });
  };
  if (settings.get().walletConnect) void load();
  return settings.subscribe((state, previous) => {
    if (state.walletConnect === previous.walletConnect) return;
    if (state.walletConnect) void load();
    else void wallet.dropWalletConnect();
  });
}

/**
 * The wallet's chains, with public RPC URLs only. wagmi's connectors read a chain's `rpcUrls` (WalletConnect puts
 * them in the session proposal it sends through its relay), and the person's own RPC may carry an API key. Reads
 * still go through the person's RPC: the transports delegate to the service's clients.
 */
export function walletChains(e2e: boolean, overrides: Readonly<Record<number, string>>): [Chain, ...Chain[]] {
  const chains = pickerChains(e2e).map((spec) => viemChain(spec, publicRpcUrls(spec, overrides[spec.id])));
  const [first, ...rest] = chains;
  if (!first) throw new Error("Studio lists no chains.");
  return [first, ...rest];
}

async function build(): Promise<ChainRuntime> {
  // The service hands the clients the person's RPC overrides once they've settled.
  const clients = createClients({ e2e: env.e2e });
  const chains = walletChains(env.e2e, settings.get().rpc);
  const connectors = env.e2e ? (await import("./e2e")).e2eConnectors() : [];
  const wallet = typeof window === "undefined"
    ? null
    : createWallet({
      chains,
      transport: (chainId) => delegate(clients, chainId),
      connectors,
      storage: storage(),
      walletConnect: walletConnectLoader(env.walletConnectProjectId, importWalletConnect),
    });
  const service = createChainService({ e2e: env.e2e, clients, wallet });
  if (wallet) {
    // When it's on, WalletConnect is registered first, so its session is among what reconnecting restores.
    const registered = settings.get().walletConnect ? wallet.loadWalletConnect().catch(() => undefined) : Promise.resolve();
    followWalletConnectSetting(wallet);
    void registered.then(() => wallet.reconnect());
  }
  return service;
}

let runtime: Promise<ChainRuntime> | null = null;

/** The chain module, built once per page. */
export function chainRuntime(): Promise<ChainRuntime> {
  runtime ??= build().catch((error: unknown) => {
    runtime = null;
    throw error;
  });
  return runtime;
}
