/**
 * The lazy chain module's entry (spec L822): what `import("./runtime")` loads the first time anything calls
 * `chainService()`. It builds the clients, the wagmi config and the service once per page, restores the last
 * wallet connection, and loads the end-to-end pieces (Anvil, the mock connector) only in an e2e build.
 */
import type { Result } from "@lattice-studio/core";
import type { CreateConnectorFn } from "@wagmi/core";
import type { Chain } from "viem";
import { custom } from "viem";
import { env, settings } from "@/contracts";
import { findKnownChain, pickerChains, publicRpcUrls } from "./chains";
import { createClients, viemChain, type Clients } from "./clients";
import { WALLETCONNECT_NOT_SET_UP } from "./copy";
import { createChainService, type ChainRuntime } from "./service";
import { createWallet } from "./wallet";

/**
 * WalletConnect's project id. None is configured yet (CCR: `env.walletConnectProjectId`), so choosing
 * "Other wallets (QR)" says WalletConnect isn't set up in this build.
 */
const WALLETCONNECT_PROJECT_ID: string | undefined = undefined;

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

/**
 * WalletConnect's connector, loaded when chosen. "Off until chosen" (spec L635): the setting turns on only once its
 * code has actually loaded; a failed load leaves it off (and S11a's banner speaks for the failed chunk).
 */
export async function loadWalletConnect(
  projectId: string | undefined,
  importer: () => Promise<Pick<typeof import("./walletconnect"), "walletConnectConnector">>,
): Promise<Result<CreateConnectorFn, string>> {
  if (!projectId) return { ok: false, error: WALLETCONNECT_NOT_SET_UP };
  const { walletConnectConnector } = await importer();
  settings.set({ walletConnect: true });
  return { ok: true, value: walletConnectConnector(projectId) };
}

/** While no project id is configured, the `import()` below folds away and the build carries no WalletConnect code. */
const walletConnect = (): Promise<Result<CreateConnectorFn, string>> =>
  WALLETCONNECT_PROJECT_ID
    ? loadWalletConnect(WALLETCONNECT_PROJECT_ID, () => import("./walletconnect"))
    : Promise.resolve({ ok: false, error: WALLETCONNECT_NOT_SET_UP });

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
  const clients = createClients();
  const chains = walletChains(env.e2e, settings.get().rpc);
  const connectors = env.e2e ? (await import("./e2e")).e2eConnectors() : [];
  const wallet = typeof window === "undefined"
    ? null
    : createWallet({
      chains,
      transport: (chainId) => delegate(clients, chainId),
      connectors,
      storage: storage(),
      walletConnect,
    });
  const service = createChainService({ e2e: env.e2e, clients, wallet });
  if (wallet) void wallet.reconnect();
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
