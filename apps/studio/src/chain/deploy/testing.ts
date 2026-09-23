/**
 * @internal Fakes for the deploy machine's tests (`bun test` and Vitest Browser Mode): a scriptable chain port, an
 * in-memory record store, a manual clock and inputs that analyze a real recipe against a catalog the test passes in.
 * Never imported by the app. No Node or Bun APIs, so browser tests can use it too.
 */
import type {
  Address, Analysis, Catalog, ChainState, Deployment, DeployPath, FacetDetail, Hex, LineDraft, LoupeFacet, Project, Result,
  TxRequest,
} from "@lattice-studio/core";
import { analyze, buildSalt, createxPredict, factoryPredict, MULTICALL3_CODEHASH, toChecksum } from "@lattice-studio/core";
import type { AnnounceOptions, BannerProps } from "@/contracts";
import type {
  CallOutcome, CallsOutcome, DeployChainPort, DeployDeps, DeployInputs, DeploySettings, ReceiptOutcome, SendOutcome,
  SimulationOutcome, TxStatus, WatchOptions,
} from "./ports";

/** Anvil's default account 0. */
export const ALICE: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
/** Anvil's default account 1. */
export const BOB: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
export const SEPOLIA_ID = 11155111;

/** A timer queue moved by hand. */
export type ManualClock = DeployDeps["clock"] & { advance(ms: number): void; pending(): number };

export function manualClock(start = Date.parse("2026-09-23T12:00:00.000Z")): ManualClock {
  let now = start;
  let seq = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  return {
    now: () => now,
    setTimeout(run, ms) {
      seq += 1;
      timers.set(seq, { at: now + ms, run });
      return seq;
    },
    clearTimeout(handle) {
      if (typeof handle === "number") timers.delete(handle);
    },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].run();
      }
      now = until;
    },
    pending: () => timers.size,
  };
}

/** A healthy chain for `catalog`: every shared contract present with its codehash, simulate supported. */
export function healthyState(catalog: Catalog, chainId: number, name: string): ChainState {
  const shared: ChainState["shared"] = {
    LatticeRegistry: { present: true, codehash: catalog.registry.codehash },
    LatticeFactory: { present: true, codehash: catalog.factory.codehash },
  };
  for (const facet of catalog.facets) shared[facet.name] = { present: true, codehash: facet.release.codehash };
  for (const library of catalog.libraries ?? []) shared[library.name] = { present: true, codehash: library.release.codehash };
  for (const init of catalog.inits) {
    if (!init.release) continue;
    shared[init.contract] = { present: true, codehash: init.release.codehash };
    shared[init.name] = { present: true, codehash: init.release.codehash };
  }
  return {
    chainId,
    name,
    online: true,
    probedAt: "2026-09-23T12:00:00.000Z",
    deployer: { present: true, codehash: catalog.deployer.codehash },
    multicall3: { present: true, codehash: MULTICALL3_CODEHASH },
    shared,
    simulate: true,
    gasCap: "16777216",
    codeAt: {},
  };
}

/** The loupe a correct deploy of `plan` answers with (in reverse, since order never matters). */
export function loupeOf(plan: Analysis["plan"]): LoupeFacet[] {
  return [...plan].reverse().map((entry) => ({ facetAddress: entry.address, functionSelectors: [...entry.selectors] }));
}

type Watcher = { chainId: number; hash: Hex; options: WatchOptions; resolve(outcome: ReceiptOutcome): void };

export type FakePort = DeployChainPort & {
  readonly calls: { method: string; args: unknown[] }[];
  methods(): string[];
  account(): { address: Address; chainId: number } | null;
  setAccount(account: { address: Address; chainId: number } | null): void;
  /** Per chain, fields that differ from a healthy chain. */
  patch(chainId: number, patch: Partial<ChainState>): void;
  /** Code at an address (predicted-address checks, proposals, missing contracts). */
  setCode(address: Address, code: Hex | "0x"): void;
  setFacets(address: Address, facets: LoupeFacet[] | null): void;
  /** What the next simulation answers (default: success with 7 events). */
  simulation: SimulationOutcome;
  /** What `send` answers next; default: a new hash. */
  sendQueue: SendOutcome[];
  replayData: Hex | null;
  callResult: CallOutcome;
  txStatus: TxStatus;
  atomic: boolean;
  /** Estimates by `to ‖ data` prefix; default 1,000,000. */
  gas: bigint;
  /** Resolves every watch at once with success, after running `onMined` (missing-contract tests). */
  autoMine: boolean;
  onMined?: ((tx: TxRequest | undefined, hash: Hex) => void) | undefined;
  /** Hashes sent so far, with their transactions. */
  readonly sent: { hash: Hex; tx: TxRequest; from: Address; gas?: bigint }[];
  readonly batches: { calls: readonly TxRequest[] }[];
  /** Pending watches. */
  watching(): Hex[];
  /** Ends the watch on `hash`. */
  mine(hash: Hex, outcome: ReceiptOutcome): void;
  /** The wallet speeds `hash` up as `next`. */
  reprice(hash: Hex, next: Hex): void;
  down: boolean;
};

export type FakePortOptions = {
  catalog: () => Catalog | null;
  /** The address the diamond would deploy at now, for `predictedHasCode`. */
  predicted?: () => Address | null;
  account?: { address: Address; chainId: number } | null;
};

export function fakePort(options: FakePortOptions): FakePort {
  const calls: { method: string; args: unknown[] }[] = [];
  const patches = new Map<number, Partial<ChainState>>();
  const code = new Map<string, Hex | "0x">();
  const facets = new Map<string, LoupeFacet[]>();
  const watchers = new Map<string, Watcher>();
  const sent: FakePort["sent"] = [];
  const batches: FakePort["batches"] = [];
  let account = options.account === undefined ? { address: ALICE, chainId: SEPOLIA_ID } : options.account;
  let hashes = 0;
  const record = (method: string, args: unknown[]) => calls.push({ method, args });
  const names: Record<number, string> = { [SEPOLIA_ID]: "Sepolia", 84532: "Base Sepolia", 31337: "Anvil" };
  const nameOf = (chainId: number) => names[chainId] ?? `Chain ${chainId}`;
  const unreachable = (chainId: number) => `${nameOf(chainId)}'s public RPC isn't answering.`;
  const nextHash = (): Hex => {
    hashes += 1;
    return `0x${hashes.toString(16).padStart(64, "0")}`;
  };

  const port: FakePort = {
    calls,
    methods: () => calls.map((c) => c.method),
    simulation: { kind: "ok", block: 9_123_456, gas: 3_000_000n, events: 7, method: "simulate" },
    sendQueue: [],
    replayData: null,
    callResult: { ok: true, data: "0x" },
    txStatus: "pending",
    atomic: false,
    gas: 1_000_000n,
    autoMine: false,
    sent,
    batches,
    down: false,
    chainName: nameOf,
    account: () => account,
    setAccount(next) {
      account = next;
    },
    patch(chainId, patch) {
      patches.set(chainId, { ...patches.get(chainId), ...patch });
    },
    setCode(address, value) {
      code.set(address.toLowerCase(), value);
    },
    setFacets(address, value) {
      if (value === null) facets.delete(address.toLowerCase());
      else facets.set(address.toLowerCase(), value);
    },
    async probe(chainId, probeOptions) {
      record("probe", [chainId, probeOptions]);
      const catalog = options.catalog();
      if (port.down) return { ok: false, error: unreachable(chainId) };
      if (!catalog) return { ok: false, error: "The catalog hasn't loaded yet." };
      const state = { ...healthyState(catalog, chainId, nameOf(chainId)), ...patches.get(chainId) };
      const predicted = options.predicted?.() ?? null;
      const codeAt: ChainState["codeAt"] = {};
      for (const address of [...(probeOptions?.codeAt ?? []), ...(predicted ? [predicted] : [])]) {
        codeAt[address.toLowerCase()] = code.get(address.toLowerCase()) ?? "0x";
      }
      return {
        ok: true,
        value: {
          ...state,
          codeAt,
          ...(predicted ? { predictedHasCode: (code.get(predicted.toLowerCase()) ?? "0x") !== "0x" } : {}),
        },
      };
    },
    async codeAt(chainId, address) {
      record("codeAt", [chainId, address]);
      if (port.down) return { ok: false, error: unreachable(chainId) };
      return { ok: true, value: code.get(address.toLowerCase()) ?? "0x" };
    },
    async readFacets(chainId, address) {
      record("readFacets", [chainId, address]);
      if (port.down) return { ok: false, error: unreachable(chainId) };
      const found = facets.get(address.toLowerCase());
      return found ? { ok: true, value: found } : { ok: false, error: `There's no diamond at ${toChecksum(address)} on ${nameOf(chainId)}.` };
    },
    async simulate(chainId, request) {
      record("simulate", [chainId, request]);
      if (port.down) return { kind: "error", message: unreachable(chainId) };
      const outcome = port.simulation;
      if (outcome.kind === "ok" && !request.simulateV1) {
        return { kind: "ok", block: outcome.block, gas: outcome.gas, method: "call" };
      }
      return outcome;
    },
    async call(chainId, request) {
      record("call", [chainId, request]);
      return port.callResult;
    },
    async replay(chainId, hash) {
      record("replay", [chainId, hash]);
      return port.replayData;
    },
    async estimateGas(chainId, request) {
      record("estimateGas", [chainId, request]);
      return { ok: true, value: port.gas };
    },
    noteEstimate(chainId, gas) {
      record("noteEstimate", [chainId, gas]);
    },
    async send(chainId, request) {
      record("send", [chainId, request]);
      const next = port.sendQueue.shift();
      if (next && next.kind !== "sent") return next;
      const hash = next?.kind === "sent" ? next.value : nextHash();
      sent.push({ hash, tx: request.tx, from: request.from, ...(request.gas === undefined ? {} : { gas: request.gas }) });
      return { kind: "sent", value: hash };
    },
    watch(chainId, hash, watchOptions) {
      record("watch", [chainId, hash]);
      if (port.autoMine) {
        port.onMined?.(sent.find((s) => s.hash === hash)?.tx, hash);
        return Promise.resolve({ kind: "receipt", hash, status: "success", block: 100 });
      }
      return new Promise<ReceiptOutcome>((resolve) => {
        const key = hash.toLowerCase();
        watchers.set(key, { chainId, hash, options: watchOptions, resolve });
        watchOptions.signal.addEventListener("abort", () => {
          if (watchers.get(key)?.resolve === resolve) watchers.delete(key);
          resolve({ kind: "aborted" });
        });
      });
    },
    async transactionStatus(chainId, hash) {
      record("transactionStatus", [chainId, hash]);
      return { ok: true, value: port.txStatus };
    },
    async atomicBatch(chainId, from) {
      record("atomicBatch", [chainId, from]);
      return port.atomic;
    },
    async sendCalls(chainId, request) {
      record("sendCalls", [chainId, request]);
      const next = port.sendQueue.shift();
      if (next && next.kind !== "sent") return next;
      batches.push({ calls: request.calls });
      return { kind: "sent", value: `calls-${batches.length}` };
    },
    async waitCalls(chainId, id): Promise<CallsOutcome> {
      record("waitCalls", [chainId, id]);
      const batch = batches[Number(id.split("-")[1]) - 1];
      for (const call of batch?.calls ?? []) port.onMined?.(call, "0x");
      return { kind: "done", status: "success", receipts: [] };
    },
    watching: () => [...watchers.values()].map((w) => w.hash),
    mine(hash, outcome) {
      const key = hash.toLowerCase();
      const watcher = watchers.get(key);
      if (!watcher) throw new Error(`Nothing watches ${hash}.`);
      watchers.delete(key);
      watcher.resolve(outcome);
    },
    reprice(hash, next) {
      const watcher = watchers.get(hash.toLowerCase());
      if (!watcher) throw new Error(`Nothing watches ${hash}.`);
      watchers.delete(hash.toLowerCase());
      watchers.set(next.toLowerCase(), { ...watcher, hash: next });
      watcher.options.onRepriced(next);
    },
  };
  return port;
}

export type FakeRecords = DeployDeps["records"] & {
  all(): Deployment[];
  get(chainId: number, address: Address): Deployment | undefined;
  /** Rejects the next writes with this reason. */
  failWith: string | null;
  seed(records: Deployment[]): void;
  /** Writes as another module would (S8d's verification), telling subscribers. */
  write(record: Deployment): void;
};

export function fakeRecords(): FakeRecords {
  const map = new Map<string, Deployment>();
  const listeners = new Set<(projectId: string) => void>();
  const key = (d: Pick<Deployment, "chainId" | "address">) => `${d.chainId}:${d.address.toLowerCase()}`;
  const store: FakeRecords = {
    failWith: null,
    async list(projectId) {
      return [...map.values()].filter((d) => d.projectId === projectId).map((d) => structuredClone(d));
    },
    async put(record) {
      if (store.failWith !== null) throw new Error(store.failWith);
      map.set(key(record), structuredClone(record));
      for (const listener of Array.from(listeners)) listener(record.projectId);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    all: () => [...map.values()],
    get: (chainId, address) => map.get(key({ chainId, address })),
    seed(records) {
      for (const record of records) map.set(key(record), structuredClone(record));
    },
    write(record) {
      map.set(key(record), structuredClone(record));
      for (const listener of Array.from(listeners)) listener(record.projectId);
    },
  };
  return store;
}

export type FakeInputs = DeployInputs & {
  setProject(project: Project): void;
  setChain(chainId: number | null): void;
  setAck(ids: string[]): void;
  setOnline(online: boolean): void;
  /** Re-analyzes and tells subscribers (after an account change on the port). */
  touch(): void;
};

/** Inputs over a real recipe: analysis with the deploy context (refs resolved), as S1 builds it. */
export function fakeInputs(options: {
  catalog: Catalog;
  project: Project;
  chainId?: number | null;
  account: () => { address: Address; chainId: number } | null;
}): FakeInputs {
  let project = options.project;
  let chainId = options.chainId === undefined ? SEPOLIA_ID : options.chainId;
  let acks: string[] = [];
  let online = true;
  let cached: { key: string; analysis: Analysis } | null = null;
  const listeners = new Set<() => void>();
  const { catalog } = options;

  const prediction: DeployInputs["prediction"] = () => {
    const account = options.account();
    if (!account) return { status: "none", reason: "Connect a wallet to see the deploy address (it depends on the deploying account)" };
    if (chainId === null) return { status: "none", reason: "Choose a chain to see the deploy address" };
    const from = toChecksum(account.address);
    const salt = buildSalt(from, project.deploy.scope, project.deploy.entropy);
    const path: DeployPath = project.deploy.path;
    const address = path === "createx"
      ? createxPredict({ from, salt, chainId })
      : factoryPredict({ factory: catalog.factory.address, proxyInitCodeHash: catalog.proxy.initCodeHash, from, salt });
    return { status: "ready", address: toChecksum(address), chainId, path, from, salt };
  };

  const analysis = (): Analysis => {
    const p = prediction();
    const key = `${JSON.stringify(project.recipe)}|${p.status === "ready" ? `${p.address}|${p.salt}|${p.chainId}` : p.reason}`;
    if (cached?.key === key) return cached.analysis;
    const ctx = p.status === "ready"
      ? { known: [], unconfirmed: [], deploy: { chainId: p.chainId, path: p.path, from: p.from, salt: p.salt }, refs: { self: p.address, deployer: p.from } }
      : { known: [], unconfirmed: [] };
    const result = analyze(project.recipe, catalog, ctx);
    cached = { key, analysis: result };
    return result;
  };
  const emit = () => {
    for (const listener of Array.from(listeners)) listener();
  };

  return {
    project: () => project,
    analysis,
    catalog: () => catalog,
    chainId: () => chainId,
    chainName: (id) => ({ [SEPOLIA_ID]: "Sepolia", 84532: "Base Sepolia", 31337: "Anvil" } as Record<number, string>)[id] ?? `Chain ${id}`,
    prediction,
    acks: () => acks,
    online: () => online,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setProject(next) {
      project = next;
      emit();
    },
    setChain(next) {
      chainId = next;
      emit();
    },
    setAck(ids) {
      acks = ids;
      emit();
    },
    setOnline(next) {
      online = next;
      emit();
    },
    touch: emit,
  };
}

export type Said = {
  lines: LineDraft[];
  announced: [string, AnnounceOptions | undefined][];
  banners: Map<string, BannerProps>;
  texts(): string[];
};

export type DeployHarness = {
  deps: DeployDeps;
  port: FakePort;
  records: FakeRecords;
  clock: ManualClock;
  inputs: FakeInputs;
  said: Said;
  settings: DeploySettings;
  /** Every ABI shard `files.detail` can serve. */
  details: Map<string, FacetDetail>;
  /** Creation code by name for `files.code` (default: none loaded). */
  code: Map<string, Hex>;
  /** Makes `chain()` reject (the chunk failed to load). */
  chainFails: string | null;
};

export function deployHarness(options: { catalog: Catalog; project: Project; chainId?: number | null; account?: { address: Address; chainId: number } | null }): DeployHarness {
  const said: Said = { lines: [], announced: [], banners: new Map(), texts: () => said.lines.map((l) => l.text) };
  const settings: DeploySettings = { receiptTimeout: 180, deployAnnouncements: "errors" };
  const clock = manualClock();
  const details = new Map<string, FacetDetail>();
  const code = new Map<string, Hex>();
  let inputs: FakeInputs | null = null;
  const port = fakePort({
    catalog: () => options.catalog,
    predicted: () => {
      const p = inputs?.prediction();
      return p?.status === "ready" ? p.address : null;
    },
    ...(options.account === undefined ? {} : { account: options.account }),
  });
  inputs = fakeInputs({
    catalog: options.catalog,
    project: options.project,
    ...(options.chainId === undefined ? {} : { chainId: options.chainId }),
    account: () => port.account(),
  });
  const records = fakeRecords();
  const harness: DeployHarness = {
    port,
    records,
    clock,
    inputs,
    said,
    settings,
    details,
    code,
    chainFails: null,
    deps: {
      inputs,
      chain: async () => {
        if (harness.chainFails !== null) throw new Error(harness.chainFails);
        return port;
      },
      records,
      files: {
        detail: async (name): Promise<Result<FacetDetail, string>> => {
          const found = details.get(name);
          return found ? { ok: true, value: found } : { ok: false, error: `${name} has no ABI shard in this catalog.` };
        },
        code: async (name): Promise<Result<Hex, string>> => {
          const found = code.get(name);
          return found ? { ok: true, value: found } : { ok: false, error: `${name} has no creation code in this catalog.` };
        },
      },
      say: {
        log: (line) => void said.lines.push(line),
        announce: (text, announceOptions) => void said.announced.push([text, announceOptions]),
        showBanner: (id, props) => void said.banners.set(id, props),
        hideBanner: (id) => void said.banners.delete(id),
      },
      settings: () => settings,
      clock,
    },
  };
  return harness;
}

/** Lets pending promise chains run (real macrotask turns; the manual clock moves only by hand). */
export async function flush(turns = 8): Promise<void> {
  for (let i = 0; i < turns; i++) await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
}

/** The record for a hash, whichever address it's under. */
export function recordFor(records: FakeRecords, hash: Hex): Deployment | undefined {
  return records.all().find((d) => d.tx !== undefined && d.tx.toLowerCase() === hash.toLowerCase());
}
