/**
 * Flow 12's state machine (spec L532-L557), as the deploy controller of contracts §5.2: review, simulate, sign, track,
 * compare with the plan, record, and resume after a reload. Free of React and the DOM: everything it touches comes
 * through `DeployDeps` (`ports.ts`), so unit tests drive it with fakes and the Anvil tests with a local node.
 *
 * - **Review → Simulating → Ready.** `open()` snapshots the recipe hash and simulates by itself once the chain, the
 *   account and the inputs are known and nothing blocks. Any edit, account or chain change while the review is open
 *   marks it "Changed since review" and simulates again (the machine watches its inputs; `changed()` does the same).
 * - **Sign.** Re-probes the chain first (the predicted address must still be empty), rebuilds the transaction,
 *   asserts that the salt's first 20 bytes are the sending account, then asks the wallet. Rejected → Review with
 *   "You canceled in your wallet."; sent → Pending, with a record written at once.
 * - **Pending → Stale → …** The machine owns the receipt timeout (Settings, 180 s): no receipt by then reads
 *   "Not seen for 3 minutes. It may have been dropped." while the watcher keeps going, so a late receipt is still
 *   recorded. A sped-up transaction is followed under its new hash; a canceled or replaced one fails.
 * - **Confirmed → Verifying | Mismatch.** Reads `facets()` at the address (re-probing first: predicted-address code
 *   is cached) and compares it with the plan per facet as sets, codehashes included. A repeat (sender, salt) at
 *   LatticeFactory returns the older diamond without an event, so the comparison is what catches it.
 * - **Verifying → Live** once the record's `verification` leaves "pending" (S8d writes it).
 * - **Proposed.** A Safe batch was downloaded: the record waits until code appears at the address.
 * - **Resume.** `refresh()` (project open, window focus, back online) re-reads the records: it resumes tracking a
 *   pending transaction or a proposal, and re-reads From file records and proposals on-chain.
 *
 * Deployment records are written at every transition, outside the document (and its edit lock).
 */
import type {
  Address, Analysis, Catalog, ChainState, Deployment, DeployPath, FacetDetail, Hex, LineDraft, LoupeFacet, PlanEntry, Recipe,
  Result, TxRequest,
} from "@lattice-studio/core";
import {
  ARACHNID_PROXY, assertSaltSender, buildDiamondDeploy, buildMissingDeploys, decodeInit, decodeRevert, formatAddress, lines,
  MULTICALL3_CODEHASH, plural, sameAddress, toChecksum,
} from "@lattice-studio/core";
import type { DeployController, DeployPhase, DeployState } from "@/contracts";
import {
  addressTaken, CANCELED_IN_WALLET, CANCELED_TRANSACTION, checkWalletText, CONNECT_A_WALLET, couldntReadRecord,
  DEPLOY_BANNER_ID, DEPLOY_NEEDS_CONNECTION, DEPLOYING_BANNER, discardedProposal, groupDigits, truncateHex6, fileRecordConfirmed, fileRecordMismatch,
  landedAfterAll, MISMATCH, missingDone, missingReverts, missingWouldDeploy, notSeenFor, NOTHING_MISSING, OFFLINE_TRACKING,
  proposalExecuted, recordNotSaved, REPLACED_TRANSACTION, SIMULATE_FIRST, simulatedWithCall, simulationSummary, spedUp, walletOn,
} from "./copy";
import { judgeDiamond, releaseOf, withDependencies } from "./judge";
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

/** What a deploy is compared against: its exact plan when this session built it, else what the record allows. */
type PlanSource = { plan: readonly PlanEntry[] } | null;

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
/** Phases that carry a deploy the dialog can close on without stopping it. */
const IN_FLIGHT: readonly DeployPhase[] = ["awaitingSignature", "pending", "stale", "proposed", "confirmed", "verifying"];
/** Tries of `facets()` after a receipt: a load-balanced RPC can answer from a node a block behind. */
const FACET_READS = [0, 1_000, 3_000] as const;

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

// ---------------------------------------------------------------------------------------------------------------

export function createDeployMachine(deps: DeployDeps): DeployMachine {
  const { inputs, clock } = deps;

  let state: DeployState = IDLE;
  const listeners = new Set<(s: DeployState) => void>();
  let missing: MissingStep = { chainId: null, preparing: false, running: false, items: [] };
  const missingListeners = new Set<(s: MissingStep) => void>();

  /** Bumped whenever the review's own work (simulation, sign) should stop mattering. */
  let epoch = 0;
  let missingEpoch = 0;
  let tracker: Tracker | null = null;
  /** The key the last successful simulation ran with: Sign needs the current inputs to match it. */
  let simulatedKey: string | null = null;
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

  const track = <T>(promise: Promise<T>): Promise<T> => {
    work.add(promise);
    void promise.finally(() => work.delete(promise)).catch(() => {});
    return promise;
  };

  const iso = (): string => new Date(clock.now()).toISOString();

  const chainName = (port: DeployChainPort | null, chainId: number): string => port?.chainName(chainId) ?? `Chain ${chainId}`;

  /** A console line, announced as the deploy-announcements setting says (spec L778). */
  const emit = (line: LineDraft, level: Level = line.tag === "Error" ? "alert" : "info"): void => {
    deps.say.log(line);
    const mode = deps.settings().deployAnnouncements;
    if (mode === "none" || (mode === "errors" && level === "info")) return;
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

  /** Writes a record; a refusal (storage full, a newer Studio) is said aloud and tracking goes on in memory. */
  const save = async (record: Deployment): Promise<void> => {
    remember(record);
    try {
      await deps.records.put(record);
    } catch (error) {
      emit({ tag: "Error", text: recordNotSaved(sentence(message(error))) }, "alert");
    }
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
        chain: `Chain ${chainId}`,
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

  /** "Deploy reverted in LatticeRegistry: `LatticeRegistry__RecordNotFound(lattice.ERC20, 0.4.0)`." (spec L727). */
  const revertLine = async (data: Hex, catalog: Catalog, context: { placed: readonly string[]; path: DeployPath; init?: Hex }): Promise<LineDraft> => {
    const found = await revertDetails(catalog, context.placed);
    const init = context.init && context.init !== "0x" ? decodeInit(context.init, catalog) : null;
    const decoded = decodeRevert(data, catalog, {
      details: found,
      placed: [...context.placed],
      path: context.path,
      ...(init?.ok ? { init: init.value } : {}),
    });
    return lines.reverted({
      module: decoded.module,
      error: decoded.error,
      args: decoded.args.map((arg) => arg.value).join(", "),
      ...(decoded.hint ? { note: decoded.hint } : {}),
    });
  };

  const simulate = async (): Promise<void> => {
    const mine = ++epoch;
    const alive = (): boolean => mine === epoch && !disposed;
    seenKey = inputKey();
    simulatedKey = null;
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
    const port = await loadPort();
    if (!alive()) return;
    if (!port.ok) {
      patch({ phase: "review", error: port.error });
      return;
    }
    s.chain = chainName(port.value, s.chainId);
    const probed = await port.value.probe(s.chainId, { path: s.path });
    if (!alive()) return;
    if (!probed.ok) {
      patch({ phase: "review", error: probed.error });
      return;
    }
    const built = await buildTx(s, probed.value);
    if (!alive()) return;
    if (!built.ok) {
      patch({ phase: "review", error: built.error });
      return;
    }
    const outcome = await port.value.simulate(s.chainId, { from: s.from, tx: built.value.tx, simulateV1: probed.value.simulate });
    if (!alive()) return;
    if (outcome.kind === "error") {
      patch({ phase: "review", error: outcome.message });
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
      patch({ phase: "ready", simulation: { ok: true, block: outcome.block, summary } });
      emit(outcome.events === undefined ? { tag: "Deploy", text: simulatedWithCall(block) } : lines.simulated({ block: outcome.block, events: outcome.events }));
      return;
    }
    port.value.noteEstimate(s.chainId, null);
    const line = await revertLine(outcome.data, s.catalog, { placed: s.placed, path: s.path, init: s.init.data });
    if (!alive()) return;
    patch({ phase: "review", simulation: { ok: false, block: outcome.block, revert: line.text } });
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

  /** The plan a landed diamond is judged against (see `PlanSource`): the session's own, else the sheet's when it's the same recipe. */
  const planFor = (record: Deployment, source: PlanSource): readonly PlanEntry[] | null => {
    if (source) return source.plan;
    const analysis = inputs.analysis();
    return analysis.recipeHash.toLowerCase() === record.recipeHash.toLowerCase() ? analysis.plan : null;
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

  /**
   * The diamond landed (a receipt, Review again finding it, a proposal executed): read `facets()`, compare, record
   * Confirmed or Mismatch. `drive` moves the phase; a background re-check only writes the record and says so.
   */
  const settle = async (record: Deployment, source: PlanSource, drive: boolean, block?: number): Promise<void> => {
    const alive = (): boolean => !disposed && (!drive || (state.address !== undefined && sameAddress(state.address, record.address)));
    const catalog = inputs.catalog();
    const port = await loadPort();
    if (!port.ok || !catalog) {
      if (drive) patch({ phase: "confirmed", error: port.ok ? "The catalog hasn't loaded." : port.error });
      return;
    }
    const chain = chainName(port.value, record.chainId);
    if (drive) {
      banner(false);
      patch({ phase: "confirmed", chainId: record.chainId, address: record.address, error: undefined });
    }
    const probed = await port.value.probe(record.chainId, { refresh: true, path: record.path });
    const facets = await readFacets(port.value, record.chainId, record.address, alive, drive);
    if (!alive()) return;
    if (!facets.ok || !probed.ok) {
      const reason = !facets.ok ? facets.error : probed.ok ? "" : probed.error;
      if (drive) patch({ error: reason || couldntReadRecord(chain) });
      if (!drive && !reported.has(`${recordKey(record)}|${reason}`)) {
        reported.add(`${recordKey(record)}|${reason}`);
        note(`${couldntReadRecord(chain)} ${reason}`.trim(), "warn");
      }
      return;
    }
    const verdict = judgeDiamond({ facets: facets.value, chain: probed.value, catalog, plan: planFor(record, source) });
    const { fromFile: _dropped, ...rest } = record;
    const next: Deployment = {
      ...rest,
      status: verdict.matches ? "confirmed" : "mismatch",
      ...(block === undefined ? {} : { block }),
    };
    await save(next);
    if (record.fromFile) {
      note(verdict.matches ? fileRecordConfirmed(record.address, chain) : fileRecordMismatch(record.address, chain), verdict.matches ? "info" : "warn");
    } else if (verdict.matches) {
      emit(next.block === undefined
        ? { tag: "Deploy", text: `Deployed at ${formatAddress(record.address)}. Matches the sheet.` }
        : lines.confirmed({ address: record.address, block: next.block }));
    } else {
      emit(lines.mismatch({ address: record.address, differing: verdict.differing }), "warn");
    }
    if (!drive || !alive()) return;
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
      patch({ error: port.error });
      return;
    }
    const chain = chainName(port.value, record.chainId);
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
      const text = outcome.reason === "cancelled" ? CANCELED_TRANSACTION : REPLACED_TRANSACTION;
      await save({ ...current, status: "failed", tx: outcome.hash });
      banner(false);
      patch({ phase: "failed", error: text });
      note(text, "alert");
      return;
    }
    if (outcome.status === "reverted") {
      const catalog = inputs.catalog();
      const data = await port.value.replay(record.chainId, outcome.hash);
      const line = catalog && data
        ? await revertLine(data, catalog, { placed: inputs.project().recipe.facets, path: record.path })
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
    if (disposed || IN_FLIGHT.includes(state.phase)) return;
    epoch += 1;
    flightPlan = null;
    const chainId = inputs.chainId();
    publish({
      phase: "review",
      snapshot: inputs.analysis().recipeHash,
      ...(chainId === null ? {} : { chainId }),
    });
    void track(announceReview(chainId));
    void track(simulate());
  };

  const announceReview = async (chainId: number | null): Promise<void> => {
    if (chainId === null) return;
    const port = await loadPort();
    const name = chainName(port.ok ? port.value : null, chainId);
    emit(lines.reviewOpened({ chain: name, path: inputs.project().deploy.path, facets: inputs.analysis().plan.length }));
  };

  const changed = (): void => {
    if (disposed || !REVIEWING.includes(state.phase)) return;
    const key = inputKey();
    if (key === seenKey) return;
    const reviewed = seenKey?.startsWith(`${reviewKey()}|`) ?? true;
    if (!reviewed) patch({ changedSinceReview: true, error: undefined });
    void track(simulate());
  };

  const signable = (): string | null => {
    if (state.phase !== "ready" && !(state.phase === "review" && state.simulation?.ok === true)) {
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

  const sign = async (): Promise<void> => {
    if (disposed) return;
    const refused = signable();
    if (refused !== null) {
      note(refused);
      return;
    }
    const snap = snapshotOf();
    if (!snap.ok) {
      patch({ phase: "review", error: snap.error });
      return;
    }
    const s = snap.value;
    if (s.key !== simulatedKey) {
      note(SIMULATE_FIRST);
      await track(simulate());
      return;
    }
    const mine = ++epoch;
    const alive = (): boolean => mine === epoch && !disposed;
    const port = await loadPort();
    if (!alive()) return;
    if (!port.ok) {
      patch({ error: port.error });
      return;
    }
    s.chain = chainName(port.value, s.chainId);
    const account = port.value.account();
    if (!account) {
      patch({ error: CONNECT_A_WALLET });
      return;
    }
    if (!sameAddress(account.address, s.from)) {
      note(SIMULATE_FIRST);
      await track(simulate());
      return;
    }
    if (account.chainId !== s.chainId) {
      patch({ error: walletOn(chainName(port.value, account.chainId)) });
      return;
    }
    patch({ phase: "awaitingSignature", since: iso(), error: undefined, changedSinceReview: undefined });
    banner(true);
    const back = (error: string): void => {
      banner(false);
      patch({ phase: "review", error, since: undefined });
    };
    const probed = await port.value.probe(s.chainId, { refresh: true, path: s.path });
    if (!alive()) return;
    if (!probed.ok) return back(probed.error);
    if (probed.value.predictedHasCode === true) {
      const known = records.find((d) => d.chainId === s.chainId && sameAddress(d.address, s.address) && d.status === "pending");
      if (known) {
        note(landedAfterAll(s.address, s.chain));
        await settle(known, null, true);
        return;
      }
      return back(addressTaken(s.address, s.chain));
    }
    const built = await buildTx(s, probed.value);
    if (!alive()) return;
    if (!built.ok) return back(built.error);
    const salt = assertSaltSender(s.salt, account.address);
    if (!salt.ok) return back(salt.error);
    const sent = await port.value.send(s.chainId, { from: account.address, tx: built.value.tx });
    // A sent transaction is recorded whatever happened meanwhile: it's on its way.
    if (sent.kind === "rejected") {
      if (!alive()) return;
      back(CANCELED_IN_WALLET);
      note(CANCELED_IN_WALLET);
      return;
    }
    if (sent.kind === "error") {
      if (!alive()) return;
      back(sent.message);
      note(sent.message, "warn");
      return;
    }
    const hash = sent.value;
    const catalog = s.catalog;
    const record: Deployment = {
      projectId: s.projectId,
      chainId: s.chainId,
      address: toChecksum(s.address),
      path: s.path,
      deployer: toChecksum(account.address),
      salt: s.salt,
      status: "pending",
      tx: hash,
      recipeHash: s.recipeHash,
      catalogHash: catalog.hash,
      at: iso(),
      verification: "pending",
      revision: 1,
    };
    flightPlan = { plan: s.plan };
    await save(record);
    if (disposed) return;
    epoch += 1;
    patch({ phase: "pending", tx: hash, since: record.at, chainId: s.chainId, address: record.address, from: record.deployer, error: undefined });
    emit(lines.submitted({ tx: hash, chain: s.chain }));
    void track(follow(record, flightPlan));
  };

  const keepWaiting = (): void => {
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
      note(status.ok ? checkWalletText(status.value, chainName(port.value, chainId)) : status.error, "warn");
    })());
  };

  const reviewAgain = (): void => {
    if (state.phase !== "stale" || !tracker) {
      note("Review again applies to a transaction not seen for a while.");
      return;
    }
    const record = tracker.record;
    const source = tracker.plan;
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
        note(landedAfterAll(record.address, chainName(port.value, record.chainId)));
        await settle(record, source, true);
        return;
      }
      publish({ phase: "review", snapshot: inputs.analysis().recipeHash, chainId: record.chainId });
      await simulate();
    })());
  };

  const proposed = (batch: { safe: Address; chainId: number; address: Address; salt: Hex }): void => {
    const catalog = inputs.catalog();
    if (disposed || !catalog) return;
    const project = inputs.project();
    const analysis = inputs.analysis();
    stopTracking();
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
    flightPlan = { plan: analysis.plan };
    publish({ phase: "proposed", chainId: batch.chainId, address: record.address, safe: record.deployer, since: record.at, snapshot: analysis.recipeHash });
    void track((async () => {
      await save(record);
      const port = await loadPort();
      emit(lines.proposed({ safe: record.deployer, chain: chainName(port.ok ? port.value : null, batch.chainId) }));
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
      note(proposalExecuted(record.address, chainName(port.value, record.chainId)));
      await settle(record, driving ? flightPlan : null, driving);
    } finally {
      checking.delete(key);
    }
  };

  const discardProposal = (): void => {
    if (state.phase !== "proposed" || state.address === undefined || state.chainId === undefined) {
      note("There's no proposal to discard.");
      return;
    }
    const address = state.address;
    const chainId = state.chainId;
    const found = records.find((d) => d.chainId === chainId && sameAddress(d.address, address));
    const safe = state.safe ?? found?.deployer ?? ZERO;
    flightPlan = null;
    void track((async () => {
      // No delete in the records service yet (CCR): a discarded proposal is kept as failed, never proposed.
      if (found) await save({ ...found, status: "failed" });
      const port = await loadPort();
      note(discardedProposal(safe, chainName(port.ok ? port.value : null, chainId)));
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
    if (IN_FLIGHT.includes(state.phase)) {
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
    if (IN_FLIGHT.includes(state.phase)) return;
    epoch += 1;
    simulatedKey = null;
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
    const alive = (): boolean => mine === missingEpoch && !disposed;
    const catalog = inputs.catalog();
    const chainId = missing.chainId ?? inputs.chainId();
    const stop = (error: string, items = missing.items): void => {
      const settled = items.map((item) => (item.status === "pending" ? { ...item, status: "missing" as const } : item));
      setMissing({ chainId, preparing: false, running: false, items: settled, error });
      note(error, "warn");
    };
    if (!catalog) return stop("The catalog hasn't loaded.");
    if (chainId === null) return stop("Choose a chain first.");
    const port = await loadPort();
    if (!alive()) return;
    if (!port.ok) return stop(port.error);
    const chain = chainName(port.value, chainId);
    const account = port.value.account();
    if (!account) return stop(CONNECT_A_WALLET);
    if (account.chainId !== chainId) return stop(walletOn(chainName(port.value, account.chainId)));

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
      const group = groups[0];
      if (!group) break;
      for (const name of group.names) mark(name, "pending");
      setMissing({ chainId, preparing: false, running: true, items: items(), ...(mode ? { mode } : {}) });

      const sentOk = await sendGroup(port.value, chainId, account.address, group.txs);
      if (!alive()) return;
      if (sentOk !== null) {
        for (const name of group.names) mark(name, byName.get(name)?.status === "deployed" ? "deployed" : "failed", sentOk);
        failed += group.names.length;
        setMissing({ chainId, preparing: false, running: false, items: items(), ...(mode ? { mode } : {}), error: sentOk });
        note(sentOk, sentOk === CANCELED_IN_WALLET ? "info" : "warn");
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
    setMissing({ chainId, preparing: false, running: false, items: items(), ...(mode ? { mode } : {}) });
    if (deployed === 0 && failed === 0) note(NOTHING_MISSING);
    else note(missingDone(deployed, failed, chain), failed > 0 ? "warn" : "info");
    // The NET checks read the chain again, so NET-03 clears once everything is there.
    void port.value.probe(chainId, { refresh: true });
  };

  /** Sends one group; null when it went through, else why not. */
  const sendGroup = async (port: DeployChainPort, chainId: number, from: Address, txs: readonly TxRequest[]): Promise<string | null> => {
    if (txs.length > 1) {
      const sent = await port.sendCalls(chainId, { from, calls: txs });
      if (sent.kind === "rejected") return CANCELED_IN_WALLET;
      if (sent.kind === "error") return sent.message;
      const abort = new AbortController();
      const done = await port.waitCalls(chainId, sent.value, abort.signal);
      return done.kind === "error" ? done.message : null;
    }
    const [tx] = txs;
    if (!tx) return null;
    const sent = await port.send(chainId, { from, tx });
    if (sent.kind === "rejected") return CANCELED_IN_WALLET;
    if (sent.kind === "error") return sent.message;
    const abort = new AbortController();
    await port.watch(chainId, sent.value, { from, signal: abort.signal, onRepriced: () => {} });
    return null;
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
    if (resumable && (state.phase === "idle" || (IN_FLIGHT.includes(state.phase) && driving(resumable)))) {
      if (resumable.status === "pending" && !(tracker && driving(resumable))) {
        publish({
          phase: "pending", chainId: resumable.chainId, address: resumable.address, tx: resumable.tx ?? "0x", since: resumable.at,
          from: resumable.deployer, snapshot: resumable.recipeHash,
        });
        banner(true);
        void track(follow(resumable, null));
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
    // The rest in the background: From file records are re-read, other proposals checked for code.
    void track(Promise.all(records.map(async (d) => {
      if (d === resumable) return;
      if (d.fromFile === true) {
        const key = recordKey(d);
        if (checking.has(key)) return;
        checking.add(key);
        try {
          await settle(d, null, false);
        } finally {
          checking.delete(key);
        }
      } else if (d.status === "proposed") {
        await recheckProposal(d, false);
      }
    })));
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

  /** "The sheet now differs from what's live on Sepolia (r1)." when the recipe hash leaves a live record's (spec L728). */
  const diverged = (projectId: string, from: Hex, to: Hex): void => {
    const seen = new Set<number>();
    for (const d of records) {
      if (d.projectId !== projectId || d.status !== "confirmed" || d.fromFile === true || seen.has(d.chainId)) continue;
      if (d.recipeHash.toLowerCase() !== from.toLowerCase()) continue;
      const stillLive = records.some((other) => other.chainId === d.chainId && other.status === "confirmed" && other.fromFile !== true
        && other.recipeHash.toLowerCase() === to.toLowerCase());
      if (stillLive) continue;
      seen.add(d.chainId);
      void track(loadPort().then((port) => emit(lines.diverged({ chain: chainName(port.ok ? port.value : null, d.chainId), revision: d.revision }))));
    }
  };

  const onInputs = (): void => {
    if (disposed) return;
    const project = inputs.project();
    const hash = inputs.analysis().recipeHash;
    if (lastRecipe && lastRecipe.projectId !== project.id) {
      // Another project: stop what this one was doing; its records resume it when it's open again.
      stopTracking();
      banner(false);
      epoch += 1;
      missingEpoch += 1;
      flightPlan = null;
      records = [];
      recordsFor = null;
      if (state.phase !== "idle") publish(IDLE);
      lastRecipe = { projectId: project.id, hash };
      void track(refresh());
      return;
    }
    if (lastRecipe && lastRecipe.hash !== hash && recordsFor === project.id) diverged(project.id, lastRecipe.hash, hash);
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
    sign: () => track(sign()),
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
      disposed = true;
      stopTracking();
      stopInputs();
      stopRecords();
      listeners.clear();
      missingListeners.clear();
    },
  };
}
