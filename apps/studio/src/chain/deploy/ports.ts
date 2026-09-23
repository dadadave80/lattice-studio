/**
 * What the deploy machine (`machine.ts`) needs from the world, as plain interfaces: the chain (reads, simulation, the
 * wallet), the deployment records, the catalog's files, the console and announcements, the settings and a clock.
 * The app wires them to the chain module, S7a's records and the contracts' services (`app-deps.ts`); unit tests pass
 * fakes (`testing.ts`); the Anvil tests pass a viem client on a local node. Nothing here imports React or the DOM.
 */
import type {
  Address, Analysis, Catalog, ChainState, Deployment, DeployPath, FacetDetail, Hex, LineDraft, LoupeFacet, Project, Result,
  TxRequest,
} from "@lattice-studio/core";
import type { AnnounceOptions, BannerProps } from "@/contracts";

/** What a simulation of the diamond deploy found. */
export type SimulationOutcome =
  /** `events` only from `eth_simulateV1`; `eth_call` can't count them. */
  | { kind: "ok"; block: number; gas: bigint; events?: number; method: "simulate" | "call" }
  | { kind: "reverted"; block: number; data: Hex; method: "simulate" | "call" }
  /** The RPC failed; `message` is the spec's sentence ("Sepolia's public RPC isn't answering."). */
  | { kind: "error"; message: string };

/** What the wallet did with a transaction or a batch of calls. */
export type SendOutcome<T = Hex> =
  | { kind: "sent"; value: T }
  /** EIP-1193 4001: the person said no. */
  | { kind: "rejected" }
  | { kind: "error"; message: string };

/** A transaction's end, as the receipt watcher saw it. */
export type ReceiptOutcome =
  | { kind: "receipt"; hash: Hex; status: "success" | "reverted"; block: number }
  /** Another transaction took its nonce: a cancel (to self, no value) or something else entirely. */
  | { kind: "replaced"; reason: "cancelled" | "replaced"; hash: Hex }
  /** The watch was stopped (Review again, another project, dispose). */
  | { kind: "aborted" };

export type WatchOptions = {
  /** The sender, for replacement detection (its nonce moving past this transaction's). */
  from: Address;
  signal: AbortSignal;
  /** The wallet sped it up: the same call under a new hash. The watcher follows the new hash. */
  onRepriced(hash: Hex): void;
};

/** Whether the node still knows a transaction (Check wallet). */
export type TxStatus = "pending" | "mined" | "unknown";

/** The outcome of an EIP-5792 batch. */
export type CallsOutcome =
  | { kind: "done"; status: "success" | "failure"; receipts: { hash: Hex; status: "success" | "reverted"; block: number }[] }
  | { kind: "aborted" }
  | { kind: "error"; message: string };

/** An `eth_call`: the returned bytes, or the revert data when there is some. */
export type CallOutcome = { ok: true; data: Hex } | { ok: false; data: Hex | null; message: string };

/** The chain as the deploy sees it. Every failure is a `Result` or an outcome, never a throw. */
export type DeployChainPort = {
  /** "Sepolia". */
  chainName(chainId: number): string;
  /** The connected account and the chain its wallet is on, or null. */
  account(): { address: Address; chainId: number } | null;
  /** Readiness probes; `refresh` reads again (predicted-address code is cached). */
  probe(chainId: number, options?: { refresh?: boolean; path?: DeployPath; codeAt?: readonly Address[] }): Promise<Result<ChainState, string>>;
  codeAt(chainId: number, address: Address): Promise<Result<Hex | "0x", string>>;
  readFacets(chainId: number, address: Address): Promise<Result<LoupeFacet[], string>>;
  /** `eth_simulateV1` when `simulateV1`, else `eth_call` plus `eth_estimateGas`. */
  simulate(chainId: number, request: { from: Address; tx: TxRequest; simulateV1: boolean }): Promise<SimulationOutcome>;
  /** `eth_call` at `block` (default latest). */
  call(chainId: number, request: { from: Address; tx: TxRequest; block?: number }): Promise<CallOutcome>;
  /** The revert bytes of a mined, reverted transaction: its call replayed at the block before (receipts carry none). */
  replay(chainId: number, hash: Hex): Promise<Hex | null>;
  estimateGas(chainId: number, request: { from: Address; tx: TxRequest }): Promise<Result<bigint, string>>;
  /** Hands the deploy's gas estimate to the chain module, so NET-06 weighs it (null: no longer applies). */
  noteEstimate(chainId: number, gas: bigint | null): void;
  /** Asks the wallet to send; `gas` overrides the wallet's estimate (a Multicall3 batch, whose failures don't revert). */
  send(chainId: number, request: { from: Address; tx: TxRequest; gas?: bigint }): Promise<SendOutcome>;
  /** Waits for the receipt with no timeout of its own (the machine owns the stale timer), following speed-ups. */
  watch(chainId: number, hash: Hex, options: WatchOptions): Promise<ReceiptOutcome>;
  transactionStatus(chainId: number, hash: Hex): Promise<Result<TxStatus, string>>;
  /** The wallet reports EIP-5792 `atomic: supported` for this account and chain. */
  atomicBatch(chainId: number, from: Address): Promise<boolean>;
  /** EIP-5792 `wallet_sendCalls`; the value is the calls id. */
  sendCalls(chainId: number, request: { from: Address; calls: readonly TxRequest[] }): Promise<SendOutcome<string>>;
  waitCalls(chainId: number, id: string, signal: AbortSignal): Promise<CallsOutcome>;
};

/** The open document and everything derived from it, read when the machine needs it. */
export type DeployInputs = {
  project(): Project;
  analysis(): Analysis;
  catalog(): Catalog | null;
  /** The selected chain. */
  chainId(): number | null;
  /** The predicted address for the selected chain, path, salt and account (S1), or why there's none. */
  prediction(): { status: "ready"; address: Address; chainId: number; path: DeployPath; from: Address; salt: Hex } | { status: "none"; reason: string };
  /** Acknowledged problem ids for the current recipe hash. */
  acks(): readonly string[];
  online(): boolean;
  /** Calls back when any of the above may have changed. */
  subscribe(listener: () => void): () => void;
};

export type DeployRecords = {
  list(projectId: string): Promise<Deployment[]>;
  /** Rejects with the reason when the browser refuses the write (storage full, a newer Studio). */
  put(deployment: Deployment): Promise<void>;
  /** Called with the project id after every write, from this tab or another. */
  subscribe(listener: (projectId: string) => void): () => void;
};

export type DeployFiles = {
  /** ABI shard by name (facets, init contracts, Lattice, LatticeFactory, LatticeRegistry). */
  detail(name: string): Promise<Result<FacetDetail, string>>;
  /** Creation code by shared-contract name, or "Lattice" for the proxy. */
  code(name: string): Promise<Result<Hex, string>>;
};

export type DeploySay = {
  log(line: LineDraft): void;
  announce(text: string, options?: AnnounceOptions): void;
  showBanner(id: string, props: BannerProps): void;
  hideBanner(id: string): void;
};

export type DeployClock = {
  now(): number;
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

export type DeploySettings = {
  /** Seconds before a pending transaction reads as stale (spec L844: 180 by default). */
  receiptTimeout: number;
  /** What deploy output announces (spec L778). */
  deployAnnouncements: "errors" | "all" | "none";
};

export type DeployDeps = {
  inputs: DeployInputs;
  /** The chain, loaded on first use (the chain module is lazy). Rejects when it can't load. */
  chain(): Promise<DeployChainPort>;
  records: DeployRecords;
  files: DeployFiles;
  say: DeploySay;
  settings(): DeploySettings;
  clock: DeployClock;
};
