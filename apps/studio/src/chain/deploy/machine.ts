/**
 * Flow 12's state machine (spec L532-L557), as the deploy controller of contracts §5.2: review, simulate, sign, track,
 * compare with the plan, record, and resume after a reload. Free of React and the DOM: everything it touches comes
 * through `DeployDeps` (`ports.ts`), so unit tests drive it with fakes and the Anvil tests with a local node.
 *
 * - **Review → Simulating → Ready.** `open()` snapshots the recipe hash and simulates by itself once the chain, the
 *   account and the inputs are known and nothing blocks. Any edit, account, chain or salt change while the review is
 *   open marks it "Changed since review" and simulates again (the machine watches its inputs; `changed()` does the
 *   same). The mark stays after the new result is in, until Sign or a fresh review, so it's seen on a fast chain too.
 *   An RPC that can't simulate at all says so; `sign({ withoutSimulation })` then goes on after the review's extra tick.
 * - **Sign.** Refused while the tab is read-only. Asserts first that the salt's first 20 bytes are the sending account,
 *   then re-probes the chain (the predicted address must still be empty), rebuilds the transaction, re-reads the
 *   wallet's account and chain, and asks the wallet (bound to the chain). Rejected → Review with "You canceled in
 *   your wallet."; sent → Pending, with a record written at once.
 * - **Pending → Stale → …** The machine owns the receipt timeout (Settings, 180 s): no receipt by then reads
 *   "Not seen for 3 minutes. It may have been dropped." while the watcher keeps going, so a late receipt is still
 *   recorded. A sped-up transaction is followed under its new hash; a canceled or replaced one fails. Review again
 *   records a transaction the node no longer knows as failed.
 * - **Confirmed → Verifying | Mismatch.** Reads `facets()` at the address (re-probing first: predicted-address code
 *   is cached) and compares it with the plan per facet as sets, codehashes included. A repeat (sender, salt) at
 *   LatticeFactory returns the older diamond without an event, so the comparison is what catches it.
 * - **Verifying → Live** once the record's `verification` leaves "pending" (S8d writes it). Deploy again and close
 *   don't wait for it.
 * - **Proposed.** A Safe batch was downloaded: the record waits until code appears at the address.
 * - **Resume.** `refresh()` (project open, window focus, back online) re-reads the records: it resumes tracking a
 *   pending transaction or a proposal, and re-reads From file records and proposals on-chain, one probe per chain.
 *
 * Deployment records are written at every transition, outside the document (and its edit lock); a write never
 * takes a record's verification back to "pending".
 */
import type {
  Address, Analysis, Catalog, ChainState, Deployment, DeployPath, FacetDetail, Hex, LineDraft, LoupeFacet, PlanEntry, Recipe,
  Result, TxRequest,
} from "@lattice-studio/core";
import {
  ARACHNID_PROXY, assertSaltSender, buildDiamondDeploy, buildMissingDeploys, createxProxy, decodeInit, decodeRevert, formatAddress, lines,
  MULTICALL3_CODEHASH, multicallGas, plural, sameAddress, toChecksum,
} from "@lattice-studio/core";
import type { DeployController, DeployPhase, DeployState } from "@/contracts";
import {
  ACCOUNT_CHANGED, addressTaken, ALREADY_IN_FLIGHT, CANCELED_IN_WALLET, CANCELED_TRANSACTION, cantSimulate, checkWalletText, CONNECT_A_WALLET,
  couldntReadRecord, creationFailed, creationUnread, DEPLOY_BANNER_ID, DEPLOY_NEEDS_CONNECTION, DEPLOYING_BANNER, discardedProposal, droppedRecorded,
  fileRecordConfirmed, fileRecordMismatch, fileRecordUnchecked, groupDigits, landedAfterAll, MISMATCH, missingDone,
  missingReverts, missingWouldDeploy, notSeenFor, NOTHING_MISSING, OFFLINE_TRACKING, proposalExecuted, recordNotSaved,
  REPLACED_TRANSACTION, SIMULATE_FIRST, simulatedWithCall, simulationSummary, spedUp, stillWaiting, truncateHex6, walletOn,
} from "./copy";
import { judgeDiamond, releaseOf, templatePlan, withDependencies } from "./judge";
import type { DeployChainPort, DeployDeps } from "./ports";

// ---------------------------------------------------------------------------------------------------------------
// Types

/** One contract of the missing-contracts sub-step (Flow 12 step 3). */
export type MissingItem = {
  name: string;
  address: Address;
  /** `missing` until the step sends it. */
  status: "missing" | "pending" | "deployed" | "failed";
  /** The single-transaction estimate through Arachnid's proxy. */
  gas?: bigint;
  /** Why it failed, diagnosed by a code check and an `eth_call` replay. */
  reason?: string;
};

export type MissingStep = {
  chainId: number | null;
  /** Reading the chain and estimating before anything is sent. */
  preparing: boolean;
  running: boolean;
  items: MissingItem[];
  /** How the last send went out. */
  mode?: "transactions" | "multicall" | "calls";
  /** Why the step can't run or stopped. */
  error?: string;
};

export type DeployMachine = DeployController & {
  /** Re-reads the open project's records: resumes tracking, re-checks proposals and From file records on-chain. */
  refresh(): Promise<void>;
  /** Lists what the missing-contracts sub-step would deploy on `chainId`, with estimates. */
  prepareMissing(chainId: number, names: readonly string[]): Promise<void>;
  missingStep(): MissingStep;
  subscribeMissing(listener: (step: MissingStep) => void): () => void;
  /** Settles once every piece of work in flight has (tests). */
  settled(): Promise<void>;
  dispose(): void;
};

/** What this session built for a deploy: its exact plan and the facets on the sheet then. Null: only the record. */
type PlanSource = { plan: readonly PlanEntry[]; placed: readonly string[] } | null;

type Snapshot = {
  /** Everything a simulation depends on: a change means simulate again. */
  key: string;
  projectId: string;
  recipeHash: Hex;
  recipe: Recipe;
  catalog: Catalog;
  plan: PlanEntry[];
  placed: string[];
  init: { target: Address; data: Hex };
  chainId: number;
  chain: string;
  path: DeployPath;
  from: Address;
  salt: Hex;
  address: Address;
};

/** The transaction being tracked. */
type Tracker = { abort: AbortController; timer: unknown; record: Deployment; plan: PlanSource };

type Level = "info" | "warn" | "alert";

const IDLE: DeployState = Object.freeze({ phase: "idle" });
const ZERO: Address = "0x0000000000000000000000000000000000000000";
const REVIEWING: readonly DeployPhase[] = ["review", "simulating", "ready"];
/** A transaction or a proposal on its way: the review can't start another, and closing it leaves tracking on. */
const TRACKING: readonly DeployPhase[] = ["awaitingSignature", "pending", "stale", "proposed"];
/** Tries of `facets()` after a receipt: a load-balanced RPC can answer from a node a block behind. */
const FACET_READS = [0, 1_000, 3_000] as const;
/** A missing-contract send stopped because the step was (dispose, another project). */
const STOPPED = "stopped";

type StateChanges = { [K in keyof DeployState]?: DeployState[K] | undefined };

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function newestFirst(a: Deployment, b: Deployment): number {
  return a.at === b.at ? 0 : a.at < b.at ? 1 : -1;
}

function recordKey(d: Pick<Deployment, "chainId" | "address">): string {
  return `${d.chainId}:${d.address.toLowerCase()}`;
}

function blockers(analysis: Analysis): number {
  return analysis.problems.filter((p) => p.severity === "blocker").length;
}

/** Whether the chain probe found code at `address` (asked for with `codeAt`), else its predicted-address answer. */
function hasCode(chain: ChainState, address: Address): boolean {
  const code = chain.codeAt[address.toLowerCase()];
  return code === undefined ? chain.predictedHasCode === true : code !== "0x";
}

// ---------------------------------------------------------------------------------------------------------------

export function createDeployMachine(deps: DeployDeps): DeployMachine {
  const { inputs, clock } = deps;

  let state: DeployState = IDLE;
  const listeners = new Set<(s: DeployState) => void>();
  const EMPTY_STEP: MissingStep = { chainId: null, preparing: false, running: false, items: [] };
  let missing: MissingStep = EMPTY_STEP;
  const missingListeners = new Set<(s: MissingStep) => void>();

  /** Bumped whenever the review's own work (simulation, sign) should stop mattering. */
  let epoch = 0;
  let missingEpoch = 0;
  /** Aborts the missing-contracts step's current send (dispose, another project). */
  let missingAbort: AbortController | null = null;
  let tracker: Tracker | null = null;
  /** The key the last successful simulation ran with: Sign needs the current inputs to match it. */
  let simulatedKey: string | null = null;
  /** The key the last "can't simulate" answer came with: Sign without a simulation needs the inputs to match it. */
  let unavailableKey: string | null = null;
  /** The key the review last saw, so `changed()` from several callers simulates once. */
  let seenKey: string | null = null;
  /** The plan of what's in flight, when this session built it (`proposed`, sign). */
  let flightPlan: PlanSource = null;

  let records: Deployment[] = [];
  let recordsFor: string | null = inputs.project().id;
  let lastRecipe: { projectId: string; hash: Hex } | null = null;
  let wasOnline = inputs.online();
  const checking = new Set<string>();
  const reported = new Set<string>();
  const details = new Map<string, FacetDetail>();
  let detailsFor: Hex | null = null;
  const work = new Set<Promise<unknown>>();
  let disposed = false;

  // -------------------------------------------------------------------------------------------------------------
  // State, output, records

  const publish = (next: DeployState): void => {
    state = Object.freeze(next);
    for (const listener of Array.from(listeners)) listener(state);
  };

  const patch = (changes: StateChanges): void => {
    const next: Record<string, unknown> = { ...state };
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined) delete next[key];
      else next[key] = value;
    }
    publish(next as DeployState);
  };

  const setMissing = (next: MissingStep): void => {
    missing = next;
    for (const listener of Array.from(missingListeners)) listener(missing);
    const shown = next.items.filter((item) => item.status !== "missing");
    patch({
      missing: shown.length > 0
        ? shown.map((item) => ({ name: item.name, status: item.status === "missing" ? "pending" : item.status }))
        : undefined,
    });
  };

  /** Stops the missing-contracts step where it is: its send is aborted, nothing reads as pending or running. */
  const stopMissing = (): void => {
    missingEpoch += 1;
    missingAbort?.abort();
    missingAbort = null;
    if (missing.running || missing.preparing) {
      setMissing({
        ...missing,
        preparing: false,
        running: false,
        items: missing.items.map((item) => (item.status === "pending" ? { ...item, status: "missing" as const } : item)),
      });
    }
  };

  const track = <T>(promise: Promise<T>): Promise<T> => {
    work.add(promise);
    void promise.finally(() => work.delete(promise)).catch(() => {});
    return promise;
  };

  const iso = (): string => new Date(clock.now()).toISOString();

  const chainName = (chainId: number): string => inputs.chainName(chainId);

  /**
   * A console line. Deploy output (Deploy and Verify lines, and Error lines that start "Deploy") is announced by the
   * console as the deploy-announcements setting says (spec L778, S5e's `deploy-announce.ts`), so each line is read
   * once. The machine announces only what the console doesn't: an Error of its own, unless announcements are off.
   * An alert (a record the browser refused to save) interrupts (spec L785); anything less, such as why Sign came
   * back to Review ("You canceled in your wallet."), waits its turn.
   */
  const emit = (line: LineDraft, level: Level = line.tag === "Error" ? "alert" : "info"): void => {
    deps.say.log(line);
    const consoleSays = line.tag === "Deploy" || line.tag === "Verify" || (line.tag === "Error" && line.text.startsWith("Deploy"));
    if (consoleSays || deps.settings().deployAnnouncements === "none") return;
    deps.say.announce(line.text.replaceAll("`", ""), { politeness: level === "alert" ? "assertive" : "polite" });
  };

  const note = (text: string, level: Level = "info"): void => emit({ tag: "Deploy", text }, level);

  const banner = (show: boolean): void => {
    if (show) deps.say.showBanner(DEPLOY_BANNER_ID, { text: DEPLOYING_BANNER, tone: "info", actions: [{ id: "deploy.showProgress" }] });
    else deps.say.hideBanner(DEPLOY_BANNER_ID);
  };

  const remember = (record: Deployment): void => {
    if (record.projectId !== recordsFor) return;
    records = [record, ...records.filter((d) => recordKey(d) !== recordKey(record))];
  };

  const forget = (record: Deployment): void => {
    records = records.filter((d) => recordKey(d) !== recordKey(record));
  };

  /**
   * Writes a record and returns what was written. A stored verification result (S8d, maybe from another tab) is
   * kept: the store replaces whole records, and this machine only ever knows "pending". A refusal (storage full, a
   * newer Studio) is said aloud and tracking goes on in memory.
   */
  const save = async (record: Deployment): Promise<Deployment> => {
    let next = record;
    if (record.verification === "pending") {
      try {
        const stored = (await deps.records.list(record.projectId)).find((d) => recordKey(d) === recordKey(record));
        if (stored && stored.verification !== "pending") next = { ...record, verification: stored.verification };
      } catch {
        // Can't read the store: write what we have.
      }
    }
    remember(next);
    try {
      await deps.records.put(next);
    } catch (error) {
      emit({ tag: "Error", text: recordNotSaved(sentence(message(error))) }, "alert");
    }
    return next;
  };

  const loadPort = async (): Promise<Result<DeployChainPort, string>> => {
    try {
      return { ok: true, value: await deps.chain() };
    } catch (error) {
      return { ok: false, error: sentence(message(error)) };
    }
  };

  // -------------------------------------------------------------------------------------------------------------
  // Snapshot and simulation

  const snapshotOf = (): Result<Snapshot, string> => {
    const catalog = inputs.catalog();
    if (!catalog) return { ok: false, error: "The catalog hasn't loaded." };
    const chainId = inputs.chainId();
    if (chainId === null) return { ok: false, error: "Choose a chain first." };
    const prediction = inputs.prediction();
    if (prediction.status !== "ready") return { ok: false, error: prediction.reason };
    const project = inputs.project();
    const analysis = inputs.analysis();
    if (analysis.init !== null && analysis.init.data === undefined) {
      return { ok: false, error: "The init call isn't ready: its references don't resolve yet." };
    }
    const init = analysis.init === null ? { target: ZERO, data: "0x" as Hex } : { target: analysis.init.target, data: analysis.init.data ?? "0x" };
    const key = [analysis.recipeHash, chainId, prediction.from.toLowerCase(), prediction.path, prediction.salt, init.data].join("|");
    return {
      ok: true,
      value: {
        key,
        projectId: project.id,
        recipeHash: analysis.recipeHash,
        recipe: project.recipe,
        catalog,
        plan: analysis.plan,
        placed: project.recipe.facets,
        init,
        chainId,
        chain: chainName(chainId),
        path: prediction.path,
        from: prediction.from,
        salt: prediction.salt,
        address: prediction.address,
      },
    };
  };

  /** Changes that make the review "Changed since review": the recipe, the account, the chain or the salt. */
  const reviewKey = (): string => {
    const prediction = inputs.prediction();
    const from = prediction.status === "ready" ? `${prediction.from.toLowerCase()}|${prediction.path}|${prediction.salt}` : prediction.reason;
    return `${inputs.analysis().recipeHash}|${inputs.chainId() ?? ""}|${from}`;
  };

  /** Everything that decides whether and what to simulate: the review key plus blockers and the init call. */
  const inputKey = (): string => {
    const analysis = inputs.analysis();
    const blocking = analysis.problems.filter((p) => p.severity === "blocker").map((p) => p.id).join(",");
    return `${reviewKey()}|${blocking}|${analysis.init?.data ?? ""}|${inputs.online()}`;
  };

  const buildTx = async (snap: Snapshot, chain: ChainState): Promise<Result<{ tx: TxRequest; address: Address }, string>> => {
    let proxyCreationCode: Hex | undefined;
    if (snap.path === "createx") {
      const code = await deps.files.code("Lattice");
      if (!code.ok) return code;
      proxyCreationCode = code.value;
    }
    const built = buildDiamondDeploy({
      recipe: snap.recipe,
      catalog: snap.catalog,
      plan: snap.plan,
      init: snap.init,
      path: snap.path,
      from: snap.from,
      salt: snap.salt,
      chainId: snap.chainId,
      chain,
      ...(proxyCreationCode === undefined ? {} : { proxyCreationCode }),
    });
    if (!built.ok) return built;
    if (!sameAddress(built.value.address, snap.address)) {
      return { ok: false, error: `The deploy would land at ${built.value.address}, not the predicted ${snap.address}. Review again.` };
    }
    return { ok: true, value: { tx: built.value.tx, address: built.value.address } };
  };

  /** ABI shards `decodeRevert` looks errors up in: the proxy, the factory, the registry, placed facets and inits. */
  const revertDetails = async (catalog: Catalog, placed: readonly string[]): Promise<Record<string, FacetDetail>> => {
    if (detailsFor !== catalog.hash) {
      details.clear();
      detailsFor = catalog.hash;
    }
    const names = new Set<string>(["Lattice", "LatticeFactory", "LatticeRegistry", ...placed]);
    for (const init of catalog.inits) if (init.release) names.add(init.contract);
    const wanted = [...names].filter((name) => !details.has(name));
    const loaded = await Promise.all(wanted.map((name) => deps.files.detail(name)));
    wanted.forEach((name, i) => {
      const result = loaded[i];
      if (result?.ok) details.set(name, result.value);
    });
    return Object.fromEntries([...names].flatMap((name) => {
      const detail = details.get(name);
      return detail ? [[name, detail] as const] : [];
    }));
  };

  /**
   * "Deploy reverted in LatticeRegistry: `LatticeRegistry__RecordNotFound(lattice.ERC20, 0.4.0)`." (spec L727).
   * `explain` may replace the decoder's hint with what the chain shows about the error, when it has more to say.
   */
  const revertLine = async (
    data: Hex, catalog: Catalog,
    context: { placed: readonly string[]; path: DeployPath; init?: Hex; explain?: (error: string) => Promise<string | null> },
  ): Promise<LineDraft> => {
    const found = await revertDetails(catalog, context.placed);
    const init = context.init && context.init !== "0x" ? decodeInit(context.init, catalog) : null;
    const decoded = decodeRevert(data, catalog, {
      details: found,
      placed: [...context.placed],
      path: context.path,
      ...(init?.ok ? { init: init.value } : {}),
    });
    const note = (await context.explain?.(decoded.error)) ?? decoded.hint;
    return lines.reverted({
      module: decoded.module,
      error: decoded.error,
      args: decoded.args.map((arg) => arg.value).join(", "),
      ...(note ? { note } : {}),
    });
  };

  /**
   * CreateX's `FailedContractCreation` carries no reason (spec L75): read code at the salt's CREATE3 proxy and at the
   * diamond's address, and say which has it. After a mined transaction `replay` has already replayed the creation
   * with `eth_call` and the sentence says so; a simulation (`replayed: null`) is that `eth_call` itself. NET-05 reads
   * only the diamond's address, so a used proxy shows only here.
   */
  const creationCheck = async (
    port: DeployChainPort, at: Pick<Deployment, "chainId" | "deployer" | "salt" | "address">, replayed?: string | null,
  ): Promise<string> => {
    const chain = chainName(at.chainId);
    let proxy: Address;
    try {
      proxy = createxProxy({ from: at.deployer, salt: at.salt, chainId: at.chainId });
    } catch (error) {
      return creationUnread(chain, message(error), replayed);
    }
    const [atProxy, atDiamond] = await Promise.all([port.codeAt(at.chainId, proxy), port.codeAt(at.chainId, at.address)]);
    if (!atProxy.ok) return creationUnread(chain, atProxy.error, replayed);
    if (!atDiamond.ok) return creationUnread(chain, atDiamond.error, replayed);
    return creationFailed({ proxy, diamond: at.address, chain, proxyCode: atProxy.value !== "0x", diamondCode: atDiamond.value !== "0x" }, replayed);
  };

  /** `FailedContractCreation` on the CreateX path is the one revert whose explanation needs the chain. */
  const unexplainedCreation = (path: DeployPath, error: string): boolean => path === "createx" && error === "FailedContractCreation";

  const simulate = async (): Promise<void> => {
    const mine = ++epoch;
    const alive = (): boolean => mine === epoch && !disposed;
    seenKey = inputKey();
    simulatedKey = null;
    unavailableKey = null;
    // "Changed since review" stays through all of this: it marks the review until it's signed or starts over.
    const snap = snapshotOf();
    if (!snap.ok) {
      patch({ phase: "review", error: snap.error, simulation: undefined });
      return;
    }
    if (!inputs.online()) {
      patch({ phase: "review", error: DEPLOY_NEEDS_CONNECTION, simulation: undefined });
      return;
    }
    // Blockers first: a simulation of a recipe that can't deploy would only repeat them as a revert.
    if (blockers(inputs.analysis()) > 0) {
      patch({ phase: "review", error: undefined, simulation: undefined, snapshot: snap.value.recipeHash });
      return;
    }
    const s = snap.value;
    patch({ phase: "simulating", snapshot: s.recipeHash, chainId: s.chainId, address: s.address, from: s.from, error: undefined, simulation: undefined });
    const done = patch;
    const port = await loadPort();
    if (!alive()) return;
    if (!port.ok) return done({ phase: "review", error: port.error });
    const probed = await port.value.probe(s.chainId, { path: s.path });
    if (!alive()) return;
    if (!probed.ok) return done({ phase: "review", error: probed.error });
    const built = await buildTx(s, probed.value);
    if (!alive()) return;
    if (!built.ok) return done({ phase: "review", error: built.error });
    const outcome = await port.value.simulate(s.chainId, { from: s.from, tx: built.value.tx, simulateV1: probed.value.simulate });
    if (!alive()) return;
    if (outcome.kind === "error") return done({ phase: "review", error: outcome.message });
    if (outcome.kind === "unavailable") {
      // Spec L575: say so; the review asks for one extra tick and then signs without a simulation.
      unavailableKey = s.key;
      const text = cantSimulate(s.chain);
      done({ phase: "review", error: text, simulation: { ok: false, unavailable: true } });
      note(text, "warn");
      return;
    }
    const block = groupDigits(outcome.block);
    if (outcome.kind === "ok") {
      port.value.noteEstimate(s.chainId, outcome.gas);
      simulatedKey = s.key;
      const selectors = s.plan.reduce((n, entry) => n + entry.selectors.length, 0);
      const summary = simulationSummary({
        block, address: s.address, facets: s.plan.length, selectors, ...(outcome.events === undefined ? {} : { events: outcome.events }),
      });
      done({ phase: "ready", simulation: { ok: true, block: outcome.block, summary } });
      emit(outcome.events === undefined ? { tag: "Deploy", text: simulatedWithCall(block) } : lines.simulated({ block: outcome.block, events: outcome.events }));
      return;
    }
    port.value.noteEstimate(s.chainId, null);
    // The simulation or the gas estimate reverted before anything was signed: explained as after a sent one (L75).
    const explain = async (error: string): Promise<string | null> => unexplainedCreation(s.path, error)
      ? creationCheck(port.value, { chainId: s.chainId, deployer: s.from, salt: s.salt, address: s.address }, null)
      : null;
    const line = await revertLine(outcome.data, s.catalog, { placed: s.placed, path: s.path, init: s.init.data, explain });
    if (!alive()) return;
    done({ phase: "review", simulation: { ok: false, block: outcome.block, revert: line.text } });
    emit(line, "alert");
  };

  // -------------------------------------------------------------------------------------------------------------
  // Tracking a transaction

  const stopTracking = (): void => {
    if (!tracker) return;
    clock.clearTimeout(tracker.timer);
    tracker.abort.abort();
    tracker = null;
  };

  const armStale = (t: Tracker): void => {
    clock.clearTimeout(t.timer);
    const seconds = deps.settings().receiptTimeout;
    t.timer = clock.setTimeout(() => {
      if (tracker !== t || state.phase !== "pending") return;
      const text = notSeenFor(seconds);
      patch({ phase: "stale", error: text });
      note(text, "warn");
    }, seconds * 1000);
  };

  /**
   * The plan a landed diamond is judged against: the session's own; else the sheet's when the record is for the same
   * recipe; else a Studio recipe with the record's hash. Null when none of these is the record's recipe.
   */
  const planFor = (record: Deployment, source: PlanSource, catalog: Catalog): readonly PlanEntry[] | null => {
    if (source) return source.plan;
    const analysis = inputs.analysis();
    if (analysis.recipeHash.toLowerCase() === record.recipeHash.toLowerCase()) return analysis.plan;
    return templatePlan(catalog, record.recipeHash);
  };

  /** Reads `facets()` a few times: a load-balanced RPC can answer from a node a block behind the receipt. */
  const readFacets = async (
    port: DeployChainPort, chainId: number, address: Address, alive: () => boolean, retry: boolean,
  ): Promise<Result<LoupeFacet[], string>> => {
    let last: Result<LoupeFacet[], string> = { ok: false, error: "" };
    for (const wait of retry ? FACET_READS : [0]) {
      if (wait > 0) await new Promise<void>((resolve) => clock.setTimeout(resolve, wait));
      if (!alive()) return last;
      last = await port.readFacets(chainId, address);
      if (last.ok) return last;
    }
    return last;
  };

  /** Once per record and reason, so a window regaining focus doesn't repeat itself. */
  const reportOnce = (record: Deployment, text: string): void => {
    const key = `${recordKey(record)}|${text}`;
    if (reported.has(key)) return;
    reported.add(key);
    note(text, "warn");
  };

  /**
   * The diamond landed (a receipt, Review again finding it, a proposal executed), or a record is re-read: read
   * `facets()`, compare, record Confirmed or Mismatch. The record is always written; `drive` also moves the phase
   * while the review still shows this deploy. `probed` is a fresh probe of the record's chain, when the caller has one.
   */
  const settle = async (record: Deployment, source: PlanSource, drive: boolean, block?: number, probed?: ChainState): Promise<void> => {
    const alive = (): boolean => !disposed;
    // A review opened or closed since (same salt, same address) belongs to someone else: this settle only records.
    const started = epoch;
    const driving = (): boolean => drive && !disposed && epoch === started && state.chainId === record.chainId
      && state.address !== undefined && sameAddress(state.address, record.address);
    const catalog = inputs.catalog();
    const port = await loadPort();
    if (!port.ok || !catalog) {
      if (driving()) patch({ phase: "confirmed", error: port.ok ? "The catalog hasn't loaded." : port.error });
      return;
    }
    const chain = chainName(record.chainId);
    if (driving()) {
      banner(false);
      patch({ phase: "confirmed", chainId: record.chainId, address: record.address, error: undefined });
    }
    const plan = planFor(record, source, catalog);
    if (plan === null && record.fromFile === true) {
      // A file can't vouch for itself: without its recipe's plan, it stays From file (spec L501, L857).
      reportOnce(record, fileRecordUnchecked(record.address, chain));
      return;
    }
    let chainState: ChainState | string;
    if (probed) chainState = probed;
    else {
      const read = await port.value.probe(record.chainId, { refresh: true, path: record.path });
      chainState = read.ok ? read.value : read.error;
    }
    const facets = await readFacets(port.value, record.chainId, record.address, alive, drive);
    if (!alive()) return;
    if (!facets.ok || typeof chainState === "string") {
      const reason = !facets.ok ? facets.error : typeof chainState === "string" ? chainState : "";
      if (driving()) patch({ error: reason || couldntReadRecord(chain) });
      if (!drive) reportOnce(record, `${couldntReadRecord(chain)} ${reason}`.trim());
      return;
    }
    const verdict = judgeDiamond({ facets: facets.value, chain: chainState, catalog, plan });
    const { fromFile: _dropped, ...rest } = record;
    const next = await save({
      ...rest,
      status: verdict.matches ? "confirmed" : "mismatch",
      ...(block === undefined ? {} : { block }),
    });
    if (record.fromFile) {
      note(verdict.matches ? fileRecordConfirmed(record.address, chain) : fileRecordMismatch(record.address, chain), verdict.matches ? "info" : "warn");
    } else if (verdict.matches) {
      emit(next.block === undefined
        ? { tag: "Deploy", text: `Deployed at ${formatAddress(record.address)}. Matches the sheet.` }
        : lines.confirmed({ address: record.address, block: next.block }));
    } else {
      emit(lines.mismatch({ address: record.address, differing: verdict.differing }), "warn");
    }
    if (!driving()) return;
    if (!verdict.matches) {
      patch({ phase: "mismatch", error: MISMATCH });
      return;
    }
    patch({ phase: next.verification === "pending" ? "verifying" : "live", error: undefined });
  };

  /** A transaction the wallet sent (or one resumed from its record): wait for it, following speed-ups. */
  const follow = async (record: Deployment, source: PlanSource): Promise<void> => {
    stopTracking();
    const t: Tracker = { abort: new AbortController(), timer: null, record, plan: source };
    tracker = t;
    armStale(t);
    const port = await loadPort();
    if (tracker !== t) return;
    if (!port.ok) {
      // Nothing can watch it now: say so as Stale, whose Keep waiting (or focus, or back online) picks the
      // transaction up again from its record through `refresh()`.
      clock.clearTimeout(t.timer);
      tracker = null;
      patch({ phase: "stale", error: port.error });
      note(port.error, "warn");
      return;
    }
    const chain = chainName(record.chainId);
    const outcome = await port.value.watch(record.chainId, record.tx ?? "0x", {
      from: record.deployer,
      signal: t.abort.signal,
      onRepriced: (hash) => {
        if (tracker !== t) return;
        t.record = { ...t.record, tx: hash };
        void track(save(t.record));
        patch({ tx: hash });
        note(spedUp(truncateHex6(hash)));
      },
    });
    if (tracker !== t) return;
    clock.clearTimeout(t.timer);
    tracker = null;
    const current = t.record;
    if (outcome.kind === "aborted") return;
    if (outcome.kind === "replaced") {
      // The record keeps the deploy's own hash, not the transaction that took its nonce.
      const text = outcome.reason === "cancelled" ? CANCELED_TRANSACTION : REPLACED_TRANSACTION;
      await save({ ...current, status: "failed" });
      banner(false);
      patch({ phase: "failed", error: text });
      note(text, "alert");
      return;
    }
    if (outcome.status === "reverted") {
      const catalog = inputs.catalog();
      const data = await port.value.replay(record.chainId, outcome.hash);
      const placed = source?.placed ?? inputs.project().recipe.facets;
      const explain = async (error: string): Promise<string | null> =>
        record.path === "createx" && error === "FailedContractCreation" ? creationCheck(port.value, record) : null;
      const line = catalog && data
        ? await revertLine(data, catalog, { placed, path: record.path, explain })
        : { tag: "Error" as const, text: `Deploy reverted on ${chain} in block ${groupDigits(outcome.block)}.` };
      await save({ ...current, status: "failed", tx: outcome.hash, block: outcome.block });
      banner(false);
      if (!disposed) patch({ phase: "failed", tx: outcome.hash, error: line.text });
      emit(line, "alert");
      return;
    }
    await settle({ ...current, tx: outcome.hash, block: outcome.block }, source, true, outcome.block);
  };

  // -------------------------------------------------------------------------------------------------------------
  // Controller calls

  const open = (): void => {
    if (disposed) return;
    if (TRACKING.includes(state.phase)) {
      note(ALREADY_IN_FLIGHT);
      return;
    }
    epoch += 1;
    flightPlan = null;
    const chainId = inputs.chainId();
    publish({
      phase: "review",
      snapshot: inputs.analysis().recipeHash,
      ...(chainId === null ? {} : { chainId }),
    });
    if (chainId !== null) {
      emit(lines.reviewOpened({ chain: chainName(chainId), path: inputs.project().deploy.path, facets: inputs.analysis().plan.length }));
    }
    void track(simulate());
  };

  const changed = (): void => {
    if (disposed || !REVIEWING.includes(state.phase)) return;
    const key = inputKey();
    if (key === seenKey) return;
    const reviewed = seenKey?.startsWith(`${reviewKey()}|`) ?? true;
    if (!reviewed) patch({ changedSinceReview: true, error: undefined });
    void track(simulate());
  };

  const signable = (withoutSimulation: boolean): string | null => {
    const readOnly = inputs.readOnly();
    if (readOnly !== null) return readOnly;
    if (withoutSimulation) {
      if (state.phase !== "review" || state.simulation?.unavailable !== true) {
        return "Signing without a simulation is only for an RPC that can't simulate.";
      }
    } else if (state.phase !== "ready" && !(state.phase === "review" && state.simulation?.ok === true)) {
      return state.phase === "idle" ? "Open the review first." : "Simulate the deploy first.";
    }
    const analysis = inputs.analysis();
    const count = blockers(analysis);
    if (count > 0) return `Resolve ${plural(count, "blocker")} to deploy.`;
    const acks = new Set(inputs.acks());
    const open = analysis.problems.filter((p) => p.ack === true && !acks.has(p.id)).length;
    if (open > 0) return `Tick ${plural(open, "acknowledgement")} in the review first.`;
    if (!inputs.online()) return DEPLOY_NEEDS_CONNECTION;
    return null;
  };

  /**
   * Sign stopped before anything went out: back to Review, never silently. The review shows why (while the simulation
   * stands) and the console logs it as an Error, the deploy not having gone out, so the default "errors"
   * announcements read it (spec L778). Politely: a refusal in the wallet is the person's own choice. The phase moves
   * first, so the console doesn't read it too. An edit, account or chain change during the wallet round-trip wasn't
   * watched (a new simulation then would have cut the send short), so it marks the review and simulates now (L562).
   */
  const stopSign = (error: string, keepSimulation = false): void => {
    banner(false);
    if (!keepSimulation) {
      simulatedKey = null;
      unavailableKey = null;
    }
    patch({ phase: "review", error, since: undefined, ...(keepSimulation ? {} : { simulation: undefined }) });
    emit({ tag: "Error", text: error }, "warn");
    const key = inputKey();
    if (seenKey === null || key === seenKey) return;
    if (!seenKey.startsWith(`${reviewKey()}|`)) patch({ changedSinceReview: true });
    void track(simulate());
  };

  const sign = async (options?: { withoutSimulation?: true }): Promise<void> => {
    if (disposed) return;
    const withoutSimulation = options?.withoutSimulation === true;
    const refused = signable(withoutSimulation);
    if (refused !== null) {
      note(refused);
      return;
    }
    const snap = snapshotOf();
    if (!snap.ok) return stopSign(snap.error);
    const s = snap.value;
    // The salt's first 20 bytes must be the sending account (spec L286, L574): checked before anything else at Sign,
    // so a salt that disagrees is said in the console rather than only simulated again.
    const salt = assertSaltSender(s.salt, s.from);
    if (!salt.ok) return stopSign(salt.error);
    if (s.key !== (withoutSimulation ? unavailableKey : simulatedKey)) {
      note(SIMULATE_FIRST);
      await track(simulate());
      return;
    }
    const mine = ++epoch;
    const alive = (): boolean => mine === epoch && !disposed;
    const port = await loadPort();
    if (!alive()) return;
    if (!port.ok) return stopSign(port.error, true);
    const account = port.value.account();
    if (!account) return stopSign(CONNECT_A_WALLET, true);
    if (!sameAddress(account.address, s.from)) {
      note(SIMULATE_FIRST);
      await track(simulate());
      return;
    }
    if (account.chainId !== s.chainId) return stopSign(walletOn(chainName(account.chainId)), true);
    patch({ phase: "awaitingSignature", since: iso(), error: undefined, changedSinceReview: undefined });
    banner(true);
    const back = stopSign;
    // The predicted address itself, read now: the session's prediction may already be for another account.
    const probed = await port.value.probe(s.chainId, { refresh: true, path: s.path, codeAt: [s.address] });
    if (!alive()) return;
    if (!probed.ok) return back(probed.error);
    if (hasCode(probed.value, s.address)) {
      // A transaction of ours with this salt landed after all (pending, or given up as dropped): show that diamond.
      const known = records.find((d) => d.chainId === s.chainId && sameAddress(d.address, s.address) && d.tx !== undefined
        && (d.status === "pending" || (d.status === "failed" && sameAddress(d.deployer, s.from))));
      if (known) {
        note(landedAfterAll(s.address, s.chain));
        await settle(known, null, true);
        return;
      }
      return back(addressTaken(s.address, s.chain));
    }
    // An earlier transaction with this salt still waiting: a second would overwrite its record (same address) and
    // lose its hash, and the factory would hand back whichever lands first.
    const waiting = records.find((d) => d.chainId === s.chainId && sameAddress(d.address, s.address) && d.status === "pending"
      && d.tx !== undefined && d.fromFile !== true);
    if (waiting?.tx !== undefined) return back(stillWaiting(truncateHex6(waiting.tx), s.chain), true);
    const built = await buildTx(s, probed.value);
    if (!alive()) return;
    if (!built.ok) return back(built.error);
    // Only the reviewed transaction goes out: the wallet's account and chain again, right before asking it.
    const now = port.value.account();
    if (!now || !sameAddress(now.address, s.from)) return back(SIMULATE_FIRST);
    if (now.chainId !== s.chainId) return back(walletOn(chainName(now.chainId)), true);
    const sent = await port.value.send(s.chainId, { from: now.address, tx: built.value.tx });
    if (sent.kind !== "sent") {
      if (!alive()) return;
      // A rejection keeps the simulation: nothing changed, so Sign again asks the wallet without simulating again.
      if (sent.kind === "rejected") back(CANCELED_IN_WALLET, true);
      else back(sent.message);
      return;
    }
    // A sent transaction is recorded whatever happened meanwhile: it's on its way.
    const hash = sent.value;
    const record: Deployment = {
      projectId: s.projectId,
      chainId: s.chainId,
      address: toChecksum(s.address),
      path: s.path,
      deployer: toChecksum(now.address),
      salt: s.salt,
      status: "pending",
      tx: hash,
      recipeHash: s.recipeHash,
      catalogHash: s.catalog.hash,
      at: iso(),
      verification: "pending",
      revision: 1,
    };
    const source: PlanSource = { plan: s.plan, placed: s.placed };
    await save(record);
    // Another project opened (or this machine went away) during the wallet prompt: the record resumes it there.
    if (!alive()) return;
    flightPlan = source;
    epoch += 1;
    patch({ phase: "pending", tx: hash, since: record.at, chainId: s.chainId, address: record.address, from: record.deployer, error: undefined });
    emit(lines.submitted({ tx: hash, chain: s.chain }));
    void track(follow(record, source));
  };

  const keepWaiting = (): void => {
    if (!tracker && (state.phase === "pending" || state.phase === "stale")) {
      // The watch let go (the chain module didn't load): pick the transaction up again from its record.
      patch({ phase: "pending", error: undefined });
      note(`Waiting for ${truncateHex6(state.tx ?? "0x")} again.`);
      void track(refresh());
      return;
    }
    if (state.phase !== "stale" || !tracker) {
      note("Nothing is waiting for a receipt.");
      return;
    }
    patch({ phase: "pending", error: undefined });
    armStale(tracker);
    note(`Waiting for ${truncateHex6(state.tx ?? "0x")} again.`);
  };

  const checkWallet = (): void => {
    const hash = state.tx;
    const chainId = state.chainId;
    if (hash === undefined || chainId === undefined || (state.phase !== "stale" && state.phase !== "pending")) {
      note("No transaction is waiting for your wallet.");
      return;
    }
    void track((async () => {
      const port = await loadPort();
      if (!port.ok) return note(port.error, "warn");
      const status = await port.value.transactionStatus(chainId, hash);
      note(status.ok ? checkWalletText(status.value, chainName(chainId)) : status.error, "warn");
    })());
  };

  const reviewAgain = (): void => {
    // The tracker's record; or, when nothing could watch it (the chain module didn't load), the stale record itself.
    const address = state.address;
    const record = tracker?.record ?? (address === undefined ? undefined
      : records.find((d) => d.chainId === state.chainId && sameAddress(d.address, address) && d.status === "pending"));
    if (state.phase !== "stale" || !record) {
      note("Review again applies to a transaction not seen for a while.");
      return;
    }
    const source = tracker?.plan ?? null;
    stopTracking();
    banner(false);
    epoch += 1;
    void track((async () => {
      const port = await loadPort();
      if (!port.ok) {
        patch({ phase: "review", error: port.error });
        return;
      }
      // Same salt: if the first transaction landed after all, show that diamond instead of sending a second.
      await port.value.probe(record.chainId, { refresh: true, path: record.path });
      const code = await port.value.codeAt(record.chainId, record.address);
      if (code.ok && code.value !== "0x") {
        note(landedAfterAll(record.address, chainName(record.chainId)));
        await settle(record, source, true);
        return;
      }
      // Nothing there. A transaction the node no longer knows was dropped: record it, so no reload resumes it.
      if (record.tx !== undefined) {
        const status = await port.value.transactionStatus(record.chainId, record.tx);
        if (status.ok && status.value === "unknown") {
          await save({ ...record, status: "failed" });
          note(droppedRecorded(truncateHex6(record.tx), chainName(record.chainId)), "warn");
        } else {
          // Still known to the node: its record stays, and Sign won't send a second with this salt while it waits.
          note(stillWaiting(truncateHex6(record.tx), chainName(record.chainId)), "warn");
        }
      }
      publish({ phase: "review", snapshot: inputs.analysis().recipeHash, chainId: record.chainId });
      await simulate();
    })());
  };

  const proposed = (batch: { safe: Address; chainId: number; address: Address; salt: Hex }): void => {
    const catalog = inputs.catalog();
    if (disposed || !catalog) return;
    if (state.phase === "awaitingSignature" || state.phase === "pending" || state.phase === "stale") {
      note(ALREADY_IN_FLIGHT);
      return;
    }
    const project = inputs.project();
    const analysis = inputs.analysis();
    epoch += 1;
    const record: Deployment = {
      projectId: project.id,
      chainId: batch.chainId,
      address: toChecksum(batch.address),
      path: project.deploy.path,
      deployer: toChecksum(batch.safe),
      salt: batch.salt,
      status: "proposed",
      recipeHash: analysis.recipeHash,
      catalogHash: catalog.hash,
      at: iso(),
      verification: "pending",
      revision: 1,
    };
    flightPlan = { plan: analysis.plan, placed: project.recipe.facets };
    publish({ phase: "proposed", chainId: batch.chainId, address: record.address, safe: record.deployer, since: record.at, snapshot: analysis.recipeHash });
    void track((async () => {
      await save(record);
      emit(lines.proposed({ safe: record.deployer, chain: chainName(batch.chainId) }));
      await recheckProposal(record, true);
    })());
  };

  /** A proposal's address: code there means the Safe executed the batch. */
  const recheckProposal = async (record: Deployment, drive: boolean): Promise<void> => {
    const key = recordKey(record);
    if (checking.has(key)) return;
    checking.add(key);
    try {
      const port = await loadPort();
      if (!port.ok) return;
      const code = await port.value.codeAt(record.chainId, record.address);
      if (!code.ok || code.value === "0x") return;
      const driving = drive && state.phase === "proposed" && state.address !== undefined && sameAddress(state.address, record.address);
      note(proposalExecuted(record.address, chainName(record.chainId)));
      await settle(record, driving ? flightPlan : null, driving);
    } finally {
      checking.delete(key);
    }
  };

  const discardProposal = (): void => {
    if (state.phase !== "proposed" || state.address === undefined || state.chainId === undefined) {
      // Ruling R9: no fix clause. Nothing is wrong; there's just no proposal waiting.
      note("There's no proposal to discard.");
      return;
    }
    const address = state.address;
    const chainId = state.chainId;
    const found = records.find((d) => d.chainId === chainId && sameAddress(d.address, address));
    const safe = state.safe ?? found?.deployer ?? ZERO;
    flightPlan = null;
    void track((async () => {
      if (found) {
        forget(found);
        try {
          await deps.records.delete(found);
        } catch (error) {
          emit({ tag: "Error", text: recordNotSaved(sentence(message(error))) }, "alert");
        }
      }
      note(discardedProposal(safe, chainName(chainId)));
    })());
    publish({ phase: "review", snapshot: inputs.analysis().recipeHash, chainId });
    void track(simulate());
  };

  const retry = (): void => {
    if (disposed) return;
    if (state.phase === "confirmed" && state.address !== undefined && state.chainId !== undefined) {
      const found = records.find((d) => d.chainId === state.chainId && state.address !== undefined && sameAddress(d.address, state.address));
      if (found) {
        void track(settle(found, flightPlan, true));
        return;
      }
    }
    if (TRACKING.includes(state.phase)) {
      note("A deploy is in flight; retry once it settles.");
      return;
    }
    // Failed → Review: fix and retry. Also a review whose simulation or read failed.
    flightPlan = null;
    const chainId = inputs.chainId();
    publish({ phase: "review", snapshot: inputs.analysis().recipeHash, ...(chainId === null ? {} : { chainId }) });
    void track(simulate());
  };

  const close = (): void => {
    // Tracking goes on with the dialog closed; a settled deploy (even one still verifying) just goes back to idle.
    if (TRACKING.includes(state.phase)) return;
    epoch += 1;
    simulatedKey = null;
    unavailableKey = null;
    seenKey = null;
    if (state.phase !== "idle") publish(IDLE);
  };

  // -------------------------------------------------------------------------------------------------------------
  // Missing contracts (Flow 12 step 3)

  const itemOf = (catalog: Catalog, name: string, status: MissingItem["status"] = "missing"): MissingItem | null => {
    const release = releaseOf(catalog, name);
    return release ? { name, address: toChecksum(release.address), status } : null;
  };

  const loadCodes = async (catalog: Catalog, names: readonly string[]): Promise<Result<Record<string, Hex>, string>> => {
    const all = withDependencies(catalog, names);
    const loaded = await Promise.all(all.map((name) => deps.files.code(name)));
    const code: Record<string, Hex> = {};
    for (const [i, name] of all.entries()) {
      const result = loaded[i];
      if (!result) continue;
      if (!result.ok) return { ok: false, error: sentence(result.error) };
      code[name] = result.value;
    }
    return { ok: true, value: code };
  };

  const arachnidCall = (catalog: Catalog, name: string, code: Record<string, Hex>): TxRequest | null => {
    const release = releaseOf(catalog, name);
    const bytes = code[name];
    if (!release || !bytes) return null;
    return { to: ARACHNID_PROXY, data: `${release.salt}${bytes.slice(2)}` as Hex, value: 0n };
  };

  const estimates = async (
    port: DeployChainPort, chainId: number, from: Address, catalog: Catalog, names: readonly string[], code: Record<string, Hex>,
  ): Promise<Record<string, bigint>> => {
    const gas: Record<string, bigint> = {};
    await Promise.all(names.map(async (name) => {
      const tx = arachnidCall(catalog, name, code);
      if (!tx) return;
      const estimate = await port.estimateGas(chainId, { from, tx });
      if (estimate.ok) gas[name] = estimate.value;
    }));
    return gas;
  };

  const prepareMissing = async (chainId: number, names: readonly string[]): Promise<void> => {
    if (missing.running) return;
    const mine = ++missingEpoch;
    const alive = (): boolean => mine === missingEpoch && !disposed;
    const catalog = inputs.catalog();
    if (!catalog) {
      setMissing({ chainId, preparing: false, running: false, items: [], error: "The catalog hasn't loaded." });
      return;
    }
    const all = withDependencies(catalog, names);
    const items = all.flatMap((name) => itemOf(catalog, name) ?? []);
    setMissing({ chainId, preparing: true, running: false, items });
    const port = await loadPort();
    if (!alive()) return;
    if (!port.ok) {
      setMissing({ ...missing, preparing: false, error: port.error });
      return;
    }
    const probed = await port.value.probe(chainId, { refresh: true });
    if (!alive()) return;
    if (!probed.ok) {
      setMissing({ ...missing, preparing: false, error: probed.error });
      return;
    }
    const present = (name: string): boolean => probed.value.shared[name]?.present === true;
    const account = port.value.account();
    const code = await loadCodes(catalog, all);
    const gas = account && code.ok
      ? await estimates(port.value, chainId, account.address, catalog, all.filter((name) => !present(name)), code.value)
      : {};
    if (!alive()) return;
    setMissing({
      chainId,
      preparing: false,
      running: false,
      items: items.map((item) => ({
        ...item,
        status: present(item.name) ? "deployed" : "missing",
        ...(gas[item.name] === undefined ? {} : { gas: gas[item.name] }),
      })),
      ...(code.ok ? {} : { error: code.error }),
    });
  };

  const deployMissing = async (names: string[]): Promise<void> => {
    if (disposed) return;
    if (missing.running) {
      note("The missing contracts are already deploying.");
      return;
    }
    const mine = ++missingEpoch;
    const abort = new AbortController();
    missingAbort = abort;
    const alive = (): boolean => mine === missingEpoch && !disposed;
    const catalog = inputs.catalog();
    const chainId = missing.chainId ?? inputs.chainId();
    const stop = (error: string, items = missing.items): void => {
      const settled = items.map((item) => (item.status === "pending" ? { ...item, status: "missing" as const } : item));
      setMissing({ chainId, preparing: false, running: false, items: settled, error });
      note(error, "warn");
    };
    const readOnly = inputs.readOnly();
    if (readOnly !== null) return stop(readOnly);
    if (!catalog) return stop("The catalog hasn't loaded.");
    if (chainId === null) return stop("Choose a chain first.");
    const port = await loadPort();
    if (!alive()) return;
    if (!port.ok) return stop(port.error);
    const chain = chainName(chainId);
    const account = port.value.account();
    if (!account) return stop(CONNECT_A_WALLET);
    if (account.chainId !== chainId) return stop(walletOn(chainName(account.chainId)));

    const wanted = withDependencies(catalog, names);
    const byName = new Map<string, MissingItem>(missing.items.map((item) => [item.name, item]));
    for (const name of wanted) {
      const item = itemOf(catalog, name, "pending");
      if (item) byName.set(name, { ...byName.get(name), ...item, status: "pending" });
    }
    const items = (): MissingItem[] => [...byName.values()];
    const mark = (name: string, status: MissingItem["status"], reason?: string): void => {
      const item = byName.get(name) ?? itemOf(catalog, name);
      if (!item) return;
      const { reason: _old, ...rest } = item;
      byName.set(name, { ...rest, status, ...(reason === undefined ? {} : { reason }) });
    };
    setMissing({ chainId, preparing: false, running: true, items: items() });

    const code = await loadCodes(catalog, wanted);
    if (!alive()) return;
    if (!code.ok) return stop(code.error, items());
    const atomic = await port.value.atomicBatch(chainId, account.address);

    let remaining = [...names];
    let deployed = 0;
    let failed = 0;
    let mode: MissingStep["mode"];
    // Each round re-reads the chain and rebuilds: a collision at Arachnid's proxy burns all the gas sent to it.
    for (let round = 0; round <= wanted.length && remaining.length > 0; round++) {
      const probed = await port.value.probe(chainId, { refresh: true });
      if (!alive()) return;
      if (!probed.ok) return stop(probed.error, items());
      const canonical = probed.value.multicall3?.codehash?.toLowerCase() === MULTICALL3_CODEHASH;
      const gasCap = probed.value.gasCap === undefined ? undefined : BigInt(probed.value.gasCap);
      const absent = withDependencies(catalog, remaining).filter((name) => probed.value.shared[name]?.present !== true);
      const gas = canonical && gasCap !== undefined ? await estimates(port.value, chainId, account.address, catalog, absent, code.value) : undefined;
      if (!alive()) return;
      const built = buildMissingDeploys({
        catalog, names: remaining, chain: probed.value, code: code.value, multicall3Canonical: canonical, atomicCalls: atomic,
        ...(gasCap === undefined ? {} : { gasCap }), ...(gas === undefined ? {} : { gas }),
      });
      if (!built.ok) return stop(built.error, items());
      for (const name of built.value.skipped) if (byName.get(name)?.status !== "deployed") mark(name, "deployed");
      mode = built.value.mode;
      const groups = built.value.mode === "calls" ? [{ names: built.value.txs.flatMap((t) => t.names), txs: built.value.txs.map((t) => t.tx) }]
        : built.value.txs.slice(0, 1).map((t) => ({ names: t.names, txs: [t.tx] }));
      // aggregate3 with failures allowed never reverts, so the wallet's own estimate would starve its last entries.
      const batchGas = (batch: readonly string[]): bigint | undefined => {
        if (batch.length < 2 || built.value.mode !== "multicall") return undefined;
        const each = batch.map((name) => gas?.[name]);
        if (each.some((g) => g === undefined)) return gasCap;
        const total = multicallGas(each as bigint[]);
        return gasCap !== undefined && total > gasCap ? gasCap : total;
      };
      const group = groups[0];
      if (!group) break;
      for (const name of group.names) mark(name, "pending");
      setMissing({ chainId, preparing: false, running: true, items: items(), ...(mode ? { mode } : {}) });

      const outcome = await sendGroup(port.value, chainId, account.address, group.txs, batchGas(group.names), abort.signal);
      if (!alive() || outcome === STOPPED) return;
      if (outcome !== null) {
        // Not deployed, and nothing to diagnose: the wallet said no, the account moved, it was replaced or never seen.
        for (const name of group.names) mark(name, byName.get(name)?.status === "deployed" ? "deployed" : "failed", outcome);
        failed += group.names.length;
        setMissing({ chainId, preparing: false, running: false, items: items(), ...(mode ? { mode } : {}), error: outcome });
        note(outcome, outcome === CANCELED_IN_WALLET ? "info" : "warn");
        return;
      }
      const after = await port.value.probe(chainId, { refresh: true });
      if (!alive()) return;
      for (const name of group.names) {
        if (after.ok && after.value.shared[name]?.present === true) {
          mark(name, "deployed");
          deployed += 1;
          continue;
        }
        const reason = await diagnose(port.value, chainId, account.address, catalog, name, code.value);
        if (!alive()) return;
        if (reason === null) {
          mark(name, "deployed");
          deployed += 1;
        } else {
          mark(name, "failed", reason);
          failed += 1;
        }
      }
      const handled = new Set([...group.names, ...built.value.skipped]);
      remaining = remaining.filter((name) => !handled.has(name));
      setMissing({ chainId, preparing: false, running: true, items: items(), ...(mode ? { mode } : {}) });
    }
    if (!alive()) return;
    if (missingAbort === abort) missingAbort = null;
    setMissing({ chainId, preparing: false, running: false, items: items(), ...(mode ? { mode } : {}) });
    if (deployed === 0 && failed === 0) note(NOTHING_MISSING);
    else note(missingDone(deployed, failed, chain), failed > 0 ? "warn" : "info");
    // The NET checks read the chain again, so NET-03 clears once everything is there.
    void port.value.probe(chainId, { refresh: true });
  };

  /**
   * Sends one group and waits for it, up to the receipt timeout (spec L844). Null when it went through; `STOPPED`
   * when the step was stopped; else why it didn't: the wallet said no, moved account or chain, the transaction was
   * canceled or replaced, or it wasn't seen in time.
   */
  const sendGroup = async (
    port: DeployChainPort, chainId: number, from: Address, txs: readonly TxRequest[], gas: bigint | undefined, stopped: AbortSignal,
  ): Promise<string | null> => {
    const now = port.account();
    if (!now) return CONNECT_A_WALLET;
    if (!sameAddress(now.address, from)) return ACCOUNT_CHANGED;
    if (now.chainId !== chainId) return walletOn(chainName(now.chainId));
    const seconds = deps.settings().receiptTimeout;
    const abort = new AbortController();
    const onStop = (): void => abort.abort();
    stopped.addEventListener("abort", onStop);
    let timedOut = false;
    let timer: unknown = null;
    // Each (re)arm replaces the deadline: a speed-up starts the wait again for its new hash.
    const arm = (): void => {
      clock.clearTimeout(timer);
      timer = clock.setTimeout(() => {
        timedOut = true;
        abort.abort();
      }, seconds * 1000);
    };
    try {
      if (txs.length > 1) {
        const sent = await port.sendCalls(chainId, { from, calls: txs });
        if (stopped.aborted) return STOPPED;
        if (sent.kind === "rejected") return CANCELED_IN_WALLET;
        if (sent.kind === "error") return sent.message;
        arm();
        const done = await port.waitCalls(chainId, sent.value, abort.signal);
        if (timedOut) return notSeenFor(seconds);
        if (stopped.aborted || done.kind === "aborted") return STOPPED;
        return done.kind === "error" ? done.message : null;
      }
      const [tx] = txs;
      if (!tx) return null;
      const sent = await port.send(chainId, { from, tx, ...(gas === undefined ? {} : { gas }) });
      if (stopped.aborted) return STOPPED;
      if (sent.kind === "rejected") return CANCELED_IN_WALLET;
      if (sent.kind === "error") return sent.message;
      arm();
      const outcome = await port.watch(chainId, sent.value, { from, signal: abort.signal, onRepriced: () => arm() });
      if (timedOut) return notSeenFor(seconds);
      if (stopped.aborted || outcome.kind === "aborted") return STOPPED;
      if (outcome.kind === "replaced") return outcome.reason === "cancelled" ? CANCELED_TRANSACTION : REPLACED_TRANSACTION;
      return null;
    } finally {
      clock.clearTimeout(timer);
      stopped.removeEventListener("abort", onStop);
    }
  };

  /** Arachnid's proxy reverts without a reason: check the address for code, then replay the creation (spec L572). */
  const diagnose = async (
    port: DeployChainPort, chainId: number, from: Address, catalog: Catalog, name: string, code: Record<string, Hex>,
  ): Promise<string | null> => {
    const release = releaseOf(catalog, name);
    if (!release) return `${name} isn't a shared contract in this catalog.`;
    const at = await port.codeAt(chainId, release.address);
    if (at.ok && at.value !== "0x") return null;
    const tx = arachnidCall(catalog, name, code);
    if (!tx) return `${name}'s creation code isn't loaded.`;
    const replay = await port.call(chainId, { from, tx });
    return replay.ok ? missingWouldDeploy(name) : missingReverts(name);
  };

  // -------------------------------------------------------------------------------------------------------------
  // Resume, re-checks and watching the inputs

  /** From file records re-read in the background: one probe per chain, then `facets()` per record. */
  const recheckFileRecords = async (list: readonly Deployment[]): Promise<void> => {
    const fresh = list.filter((d) => !checking.has(recordKey(d)));
    if (fresh.length === 0) return;
    for (const d of fresh) checking.add(recordKey(d));
    try {
      const port = await loadPort();
      if (!port.ok) return;
      const chains = [...new Set(fresh.map((d) => d.chainId))];
      await Promise.all(chains.map(async (chainId) => {
        const probed = await port.value.probe(chainId, { refresh: true });
        for (const d of fresh.filter((r) => r.chainId === chainId)) {
          if (!probed.ok) {
            reportOnce(d, `${couldntReadRecord(chainName(chainId))} ${probed.error}`.trim());
            continue;
          }
          await settle(d, null, false, undefined, probed.value);
        }
      }));
    } finally {
      for (const d of fresh) checking.delete(recordKey(d));
    }
  };

  const refresh = async (): Promise<void> => {
    if (disposed) return;
    const projectId = inputs.project().id;
    let list: Deployment[];
    try {
      list = await deps.records.list(projectId);
    } catch {
      list = [];
    }
    if (disposed || inputs.project().id !== projectId) return;
    recordsFor = projectId;
    records = [...list].sort(newestFirst);
    if (!inputs.online()) return;

    // Resume the newest pending transaction or proposal (spec L558: from its transaction hash, or for a Safe, the address).
    const resumable = records.find((d) => d.fromFile !== true && ((d.status === "pending" && d.tx !== undefined) || d.status === "proposed"));
    const driving = (d: Deployment): boolean =>
      state.address !== undefined && state.chainId === d.chainId && sameAddress(state.address, d.address);
    let resumed: Deployment | null = null;
    if (resumable && (state.phase === "idle" || (TRACKING.includes(state.phase) && driving(resumable)))) {
      resumed = resumable;
      if (resumable.status === "pending" && !(tracker && driving(resumable))) {
        publish({
          phase: "pending", chainId: resumable.chainId, address: resumable.address, tx: resumable.tx ?? "0x", since: resumable.at,
          from: resumable.deployer, snapshot: resumable.recipeHash,
        });
        banner(true);
        void track(follow(resumable, driving(resumable) ? flightPlan : null));
      } else if (resumable.status === "proposed") {
        if (state.phase === "idle") {
          publish({
            phase: "proposed", chainId: resumable.chainId, address: resumable.address, safe: resumable.deployer, since: resumable.at,
            snapshot: resumable.recipeHash,
          });
        }
        await recheckProposal(resumable, true);
      }
    }
    // The rest in the background: From file records are re-read, proposals checked for code. A failed file record is history.
    const rest = records.filter((d) => d !== resumed);
    void track(recheckFileRecords(rest.filter((d) => d.fromFile === true && d.status !== "failed" && d.status !== "proposed")));
    void track(Promise.all(rest.filter((d) => d.status === "proposed").map((d) => recheckProposal(d, false))));
  };

  /** Verifying → Live once the record's verification leaves "pending" (S8d writes it). */
  const onRecords = (projectId: string): void => {
    if (disposed || projectId !== recordsFor) return;
    void track(deps.records.list(projectId).then((list) => {
      if (disposed || projectId !== recordsFor) return;
      records = [...list].sort(newestFirst);
      if (state.phase !== "verifying" || state.address === undefined) return;
      const address = state.address;
      const found = records.find((d) => d.chainId === state.chainId && sameAddress(d.address, address));
      if (found && found.status === "confirmed" && found.verification !== "pending") patch({ phase: "live" });
    }, () => {}));
  };

  const onInputs = (): void => {
    if (disposed) return;
    const project = inputs.project();
    const hash = inputs.analysis().recipeHash;
    if (lastRecipe && lastRecipe.projectId !== project.id) {
      // Another project: stop what this one was doing; its records resume it when it's open again.
      stopTracking();
      stopMissing();
      banner(false);
      epoch += 1;
      flightPlan = null;
      records = [];
      recordsFor = null;
      if (state.phase !== "idle") publish(IDLE);
      setMissing(EMPTY_STEP);
      lastRecipe = { projectId: project.id, hash };
      void track(refresh());
      return;
    }
    lastRecipe = { projectId: project.id, hash };

    const online = inputs.online();
    if (online !== wasOnline) {
      wasOnline = online;
      const tracking = state.phase === "pending" || state.phase === "stale" || state.phase === "proposed";
      if (!online && tracking) {
        patch({ error: OFFLINE_TRACKING });
        note(OFFLINE_TRACKING, "warn");
      } else if (online) {
        if (state.error === OFFLINE_TRACKING) patch({ error: undefined });
        void track(refresh());
      }
    }
    if (REVIEWING.includes(state.phase)) {
      const key = inputKey();
      if (key !== seenKey) {
        if (seenKey !== null && !seenKey.startsWith(`${reviewKey()}|`)) patch({ changedSinceReview: true });
        void track(simulate());
      }
    }
  };

  const stopInputs = inputs.subscribe(onInputs);
  const stopRecords = deps.records.subscribe(onRecords);
  lastRecipe = { projectId: inputs.project().id, hash: inputs.analysis().recipeHash };

  return {
    state: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    open,
    changed,
    sign: (options) => track(sign(options)),
    proposed,
    deployMissing: (names) => track(deployMissing(names)),
    keepWaiting,
    checkWallet,
    reviewAgain,
    discardProposal,
    retry,
    close,
    refresh: () => track(refresh()),
    prepareMissing: (chainId, names) => track(prepareMissing(chainId, names)),
    missingStep: () => missing,
    subscribeMissing(listener) {
      missingListeners.add(listener);
      return () => {
        missingListeners.delete(listener);
      };
    },
    async settled() {
      while (work.size > 0) await Promise.allSettled(work);
    },
    dispose() {
      stopMissing();
      disposed = true;
      stopTracking();
      stopInputs();
      stopRecords();
      listeners.clear();
      missingListeners.clear();
    },
  };
}
