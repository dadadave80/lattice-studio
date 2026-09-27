/**
 * WalletConnect, "Other wallets (QR)" (spec L564, L590, L635, L882): the project id from `env`, the connector wagmi
 * builds from it, and the options its SDK is started with. The SDK itself never runs here: its module is replaced
 * by a provider that records `EthereumProvider.init`'s options and plays a wallet, so nothing reaches the relay.
 *
 * `mock.module` holds for the whole `bun test` process, so every test that imports `./walletconnect` lives here.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Address } from "@lattice-studio/core";
import { getConnectors } from "@wagmi/core";
import { custom } from "viem";
import { env, settings } from "@/contracts";
import { isolateContracts } from "@/contracts/test-support";
import { SEPOLIA } from "./chains";
import { CANCELED_IN_WALLET, WALLETCONNECT_NOT_SET_UP } from "./copy";
import { walletChains, walletConnectLoader } from "./runtime";
import { createWallet, WALLETCONNECT_ID, WALLETCONNECT_NAME, type Wallet } from "./wallet";

const ME = "0x3333333333333333333333333333333333333333" as Address;
const SECRET_RPC = "https://sepolia.example/v3/secret-key";

type Listener = (...args: unknown[]) => void;

/** What the replaced SDK saw: each `init`'s options, and the calls its provider got. */
const sdk = {
  inits: [] as Record<string, unknown>[],
  calls: [] as string[],
  /** The next `connect` rejects as a person closing the QR modal would. */
  reject: false,
};

function fakeProvider() {
  const listeners = new Map<string, Set<Listener>>();
  const provider = {
    session: undefined as { namespaces: Record<string, { accounts: string[]; chains: string[] }> } | undefined,
    accounts: [] as string[],
    chainId: SEPOLIA.id,
    events: { setMaxListeners() {} },
    on(event: string, listener: Listener) {
      const set = listeners.get(event) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(event, set);
      return provider;
    },
    removeListener(event: string, listener: Listener) {
      listeners.get(event)?.delete(listener);
      return provider;
    },
    async connect() {
      sdk.calls.push("connect");
      if (sdk.reject) throw new Error("User rejected the request.");
      provider.session = { namespaces: { eip155: { accounts: [`eip155:${SEPOLIA.id}:${ME}`], chains: [`eip155:${SEPOLIA.id}`] } } };
      provider.accounts = [ME];
    },
    async enable() {
      sdk.calls.push("enable");
      return provider.accounts;
    },
    async disconnect() {
      sdk.calls.push("disconnect");
      provider.session = undefined;
      provider.accounts = [];
    },
    async request({ method }: { method: string }) {
      sdk.calls.push(method);
      if (method === "eth_chainId") return `0x${SEPOLIA.id.toString(16)}`;
      if (method === "eth_accounts") return provider.accounts;
      throw new Error(`${method} isn't played by the fake provider.`);
    },
  };
  return provider;
}

void mock.module("@walletconnect/ethereum-provider", () => ({
  EthereumProvider: {
    async init(options: Record<string, unknown>) {
      sdk.inits.push(options);
      return fakeProvider();
    },
  },
}));

const walletconnect = await import("./walletconnect");

let restore: () => void = () => {};
beforeEach(() => {
  restore = isolateContracts();
  sdk.inits.length = 0;
  sdk.calls.length = 0;
  sdk.reject = false;
});
afterEach(() => restore());

let imports = 0;
/** The runtime's loader with a project id and the real `./walletconnect`, counting chunk loads. */
const withId = (projectId = "studio-test-project") =>
  walletConnectLoader(projectId, async () => {
    imports += 1;
    return walletconnect;
  });

function wallet(walletConnect: ReturnType<typeof walletConnectLoader>): Wallet {
  return createWallet({
    chains: walletChains(false, { [SEPOLIA.id]: SECRET_RPC }),
    transport: () => custom({ request: () => Promise.reject(new Error("No reads in these tests.")) }),
    discovery: false,
    legacyInjected: () => false,
    storage: null,
    walletConnect,
  });
}

/** wagmi starts the SDK from the connector's `setup`, without awaiting it: wait for `init`. */
async function started(): Promise<void> {
  for (let i = 0; i < 50 && sdk.inits.length === 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

const walletConnectConnectors = (w: Wallet) => getConnectors(w.config).filter((c) => c.type === "walletConnect");

describe("walletConnectConnector", () => {
  test("starts WalletConnect's SDK with telemetry off, its QR modal on and the build's project id (spec L882)", async () => {
    const w = wallet(withId("studio-test-project"));
    expect(await w.loadWalletConnect()).toEqual({ ok: true, value: undefined });
    await started();
    expect(sdk.inits).toHaveLength(1);
    const options = sdk.inits[0] ?? {};
    expect(options.telemetryEnabled).toBe(false);
    expect(options.showQrModal).toBe(true);
    expect(options.projectId).toBe("studio-test-project");
    expect(options.metadata).toMatchObject({ name: "Lattice Studio" });
  });

  test("the RPCs it sends through the relay are public: never the person's own", async () => {
    const w = wallet(withId());
    await w.loadWalletConnect();
    await started();
    const rpcMap = (sdk.inits[0]?.rpcMap ?? {}) as Record<number, string>;
    expect(rpcMap[SEPOLIA.id]).toBe(SEPOLIA.rpc.default);
    expect(Object.values(rpcMap)).not.toContain(SECRET_RPC);
  });
});

describe("with a project id", () => {
  test("choosing Other wallets (QR) builds WalletConnect's connector, connects through it and turns the setting on", async () => {
    const w = wallet(withId());
    expect(w.connectors().at(-1)).toEqual({ id: WALLETCONNECT_ID, name: WALLETCONNECT_NAME, kind: "walletconnect" });
    expect(settings.get().walletConnect).toBe(false);
    const connected = await w.connect(WALLETCONNECT_ID);
    expect(connected).toEqual({ ok: true, value: { address: ME, chainId: SEPOLIA.id, connector: "walletConnect" } });
    expect(sdk.calls).toContain("connect");
    expect(walletConnectConnectors(w)).toHaveLength(1);
    expect(settings.get().walletConnect).toBe(true);
    // Still one row: the registered connector isn't listed a second time.
    expect(w.connectors().filter((c) => c.kind === "walletconnect")).toHaveLength(1);
  });

  test("the connector is built once: choosing it again reuses it, with no second load or SDK start", async () => {
    sdk.reject = true;
    const before = imports;
    const w = wallet(withId());
    expect(await w.connect(WALLETCONNECT_ID)).toEqual({ ok: false, error: CANCELED_IN_WALLET });
    expect(await w.connect(WALLETCONNECT_ID)).toEqual({ ok: false, error: CANCELED_IN_WALLET });
    expect(imports - before).toBe(1);
    expect(sdk.inits).toHaveLength(1);
    expect(walletConnectConnectors(w)).toHaveLength(1);
  });

  test("dropping it (Settings → Wallet off) ends the session and unregisters the connector", async () => {
    const w = wallet(withId());
    await w.connect(WALLETCONNECT_ID);
    expect(await w.dropWalletConnect()).toBe(true);
    expect(sdk.calls).toContain("disconnect");
    expect(w.state()).toBeNull();
    expect(walletConnectConnectors(w)).toHaveLength(0);
    expect(w.connectors().at(-1)?.id).toBe(WALLETCONNECT_ID);
    // Nothing loaded: nothing to end.
    expect(await wallet(withId()).dropWalletConnect()).toBe(false);
  });
});

describe("without a project id", () => {
  test("choosing Other wallets (QR) says WalletConnect isn't set up, and loads nothing", async () => {
    const before = imports;
    for (const loader of [walletConnectLoader(undefined, async () => walletconnect), walletConnectLoader("studio-test-project", null)]) {
      const w = wallet(loader);
      expect(await w.connect(WALLETCONNECT_ID)).toEqual({ ok: false, error: WALLETCONNECT_NOT_SET_UP });
      expect(walletConnectConnectors(w)).toHaveLength(0);
    }
    expect(imports).toBe(before);
    expect(sdk.inits).toHaveLength(0);
    expect(settings.get().walletConnect).toBe(false);
  });

  test("this build reads the id from env.walletConnectProjectId (VITE_WALLETCONNECT_PROJECT_ID), unset under bun test", () => {
    expect(env.walletConnectProjectId).toBe(process.env.VITE_WALLETCONNECT_PROJECT_ID || undefined);
    expect(WALLETCONNECT_NOT_SET_UP).toBe("WalletConnect isn't set up in this build of Studio.");
  });
});
