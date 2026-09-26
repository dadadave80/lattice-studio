/**
 * End-to-end builds only (contracts §5.5): wagmi's `mock` connector with Anvil's first default account, which
 * Anvil signs for when a transaction is sent unsigned. Loaded through `import()` behind `env.e2e`, so a
 * production build never fetches it.
 *
 * The mock talks to local Anvil and nowhere else. On its own it answers every request it can't handle itself
 * through the RPC of the chain `getProvider` names, and without a chain id that's the wagmi config's first chain
 * (Sepolia), whatever chain the wallet is on. So a send meant for Anvil left for Sepolia's public RPC. `anvilOnly`
 * resolves each request against the chain the wallet is on at that moment, and refuses anything that would leave
 * the mock (sends, signatures, reads) unless that chain is Anvil.
 */
import { mock, type CreateConnectorFn } from "@wagmi/core";

/** Anvil's default account 0 (its well-known test mnemonic). */
export const ANVIL_ACCOUNT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as const;

/** Anvil's chain id, the only chain the end-to-end wallet reaches. */
export const ANVIL_CHAIN_ID = 31337;

/** Requests the mock answers itself, without an RPC. Everything else goes over the network. */
const LOCAL_METHODS: ReadonlySet<string> = new Set([
  "eth_chainId",
  "eth_accounts",
  "eth_requestAccounts",
  "wallet_switchEthereumChain",
  "wallet_watchAsset",
  "wallet_getCapabilities",
  "wallet_showCallsStatus",
]);

type Request = { method: string; params?: unknown };
type Provider = { request(args: Request): Promise<unknown> };

/** What the end-to-end wallet says when asked to reach a chain other than Anvil. */
export function notAnvil(chainId: number): string {
  return `The end-to-end wallet only reaches local Anvil (${ANVIL_CHAIN_ID}), not chain ${chainId}.`;
}

/**
 * `inner`'s connector, with every network request sent on the chain the wallet is on when it's made (or the one
 * `getProvider` was asked for) and refused unless that chain is Anvil. A provider kept across a switch follows it.
 */
export function anvilOnly(inner: CreateConnectorFn): CreateConnectorFn {
  return (config) => {
    const connector = inner(config);
    const innerProvider = connector.getProvider;
    return {
      ...connector,
      async getProvider(parameters?: { chainId?: number | undefined }) {
        // `this` is the connector wagmi built from this one; the mock's own methods and events need it.
        const local = (await innerProvider.call(this, {})) as Provider;
        const asked = parameters?.chainId;
        const request = async (args: Request): Promise<unknown> => {
          if (LOCAL_METHODS.has(args.method)) return local.request(args);
          const chainId = asked ?? Number(await local.request({ method: "eth_chainId" }));
          if (chainId !== ANVIL_CHAIN_ID) throw new Error(notAnvil(chainId));
          const onAnvil = (await innerProvider.call(this, { chainId })) as Provider;
          return onAnvil.request(args);
        };
        return { ...local, request };
      },
    };
  };
}

export function e2eConnectors(): CreateConnectorFn[] {
  return [anvilOnly(mock({ accounts: [ANVIL_ACCOUNT], features: { reconnect: true } }))];
}
