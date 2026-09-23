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
import { findKnownChain, pickerChains } from "./chains";
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
function delegate(clients: Clients, chainId: number): ReturnType<typeof custom> {
  return custom({
    request: ({ method, params }) => {
      const spec = findKnownChain(chainId, env.e2e);
      if (!spec) throw new Error(`Chain ${chainId} isn't one Studio reads.`);
      return clients.get(spec).request({ method, params } as never);
    },
  });
}

async function walletConnect(): Promise<Result<CreateConnectorFn, string>> {
  if (!WALLETCONNECT_PROJECT_ID) return { ok: false, error: WALLETCONNECT_NOT_SET_UP };
  settings.set({ walletConnect: true });
  const { walletConnectConnector } = await import("./walletconnect");
  return { ok: true, value: walletConnectConnector(WALLETCONNECT_PROJECT_ID) };
}

async function build(): Promise<ChainRuntime> {
  const clients = createClients({ overrides: () => settings.get().rpc });
  const chains = pickerChains(env.e2e).map((spec) => viemChain(spec, clients.urls(spec)));
  const [first, ...rest] = chains;
  if (!first) throw new Error("Studio lists no chains.");
  const connectors = env.e2e ? (await import("./e2e")).e2eConnectors() : [];
  const wallet = typeof window === "undefined"
    ? null
    : createWallet({
      chains: [first, ...rest] as [Chain, ...Chain[]],
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
