import { analyzeUpgrade, canonicalJson, err, ok, recipeHash, resolveUpgrade, tidy, type Address, type Hex, type Project, type Result } from "@lattice-studio/core";
import { getChainId, getCode } from "viem/actions";
import {
  chainService, createProject, doc, env, getCatalog, getCatalogStatus, getDeployment, isOnline, layoutMetrics, randomBytes,
  session, setCatalogStatus, settings, subscribeAnalysis, subscribeCatalog, subscribeOnline, updateDeployment,
} from "@/contracts";
import { fetchManifest, findEntry } from "@/catalog/lookup";
import { resetForProjectSwitch } from "@/projects/cmd/shared";
import { studioState } from "@/state/runtime";
import { appPort } from "../deploy/app-port";
import { chainInfo, chainName, pickerChains } from "../infra/chains";
import { fixtureBlock } from "../review/entry-copy";
import { getInspectionEngine, inspectionCatalogs } from "./app";
import { invalidateInspectionCalls } from "./call-runtime";
import type { InspectionTarget } from "./engine";
import { openTransactionReview, showTransactionProgress } from "./transaction-review-actions";
import { getTransactionReview, subscribeTransactionReview } from "./transaction-review-state";
import { createUpgradeTransaction, type UpgradeExecutionPorts } from "./upgrade-controller";
import { createUpgradePlan } from "./upgrade-plan";
import { prepareUpgrade, type UpgradePreflightPorts } from "./upgrade-preflight";
import { requestUpgradeReview, setUpgradePreparation } from "./upgrade-review-ports";
import { createUpgradeObserver } from "./upgrade-tracking";
import { readUpgradeReceipt, readUpgradeTransaction } from "./upgrade-transport";

/** No block timestamp/gas estimate enters the key, so an unchanged chain observation can advance. */
export function currentUpgradeContextKey(): string {
  const project = doc.get(), catalog = getCatalog();
  try {
    const hash = catalog ? recipeHash(project.recipe, catalog) : "no-catalog";
    const context = studioState().analysis.context();
    return canonicalJson({ projectId: project.id, recipeHash: hash, catalogHash: catalog?.hash ?? null, origin: project.upgrade ?? null,
      provenance: project.provenance, known: context.known, refs: context.refs ?? {}, codeAt: context.chain?.codeAt ?? {},
      chainId: session.get().chainId, acks: hash.startsWith("0x") ? session.get().acks[hash as `0x${string}`] ?? [] : [] });
  } catch { return `${project.id}:invalid-upgrade-context`; }
}

function preflightPorts(): UpgradePreflightPorts {
  return {
    inspect: async (target, signal) => (await chainService()).inspectDiamond(target.chainId, target.address, { signal }),
    catalogs: inspectionCatalogs,
    call: async (target, data, options) => (await chainService()).call(target.chainId, target.address, data, options),
    chainName: (chainId) => chainName(chainId, env.e2e),
    async codeAt(chainId, address, blockHash) {
      try {
        const { loadChainRuntime } = await import("../infra");
        const client = (await loadChainRuntime()).publicClient(chainId);
        if (client.chain.id !== chainId || await getChainId(client) !== chainId) return err("The runtime-code client serves a different chain.");
        const code = await getCode(client, { address, blockHash, requireCanonical: true });
        return ok(code ?? "0x");
      } catch { return err("The RPC couldn't read hash-pinned runtime code."); }
    },
  };
}

function executionPorts(): UpgradeExecutionPorts {
  return {
    ...preflightPorts(), chains: pickerChains(env.e2e).map(chainInfo), chain: appPort,
    context: () => ({ key: currentUpgradeContextKey(), online: isOnline(), readOnly: session.get().readOnly }),
    subscribe(listener) {
      let disposed = false;
      const stops = [doc.subscribe(listener), session.subscribe(listener), subscribeCatalog(listener), subscribeAnalysis(listener), subscribeOnline(listener)];
      void chainService().then((service) => { if (!disposed) stops.push(service.subscribeAccount(listener)); }, () => undefined);
      return () => { disposed = true; for (const stop of stops) stop(); };
    },
    records: { update: updateDeployment, now: () => Date.now(), reviewId: () => [...randomBytes(16)].map((byte) => byte.toString(16).padStart(2, "0")).join("") },
    clock: { now: () => Date.now(), setTimeout: (run, ms) => globalThis.setTimeout(run, ms), clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>) },
    receiptTimeout: () => settings.get().receiptTimeout,
    async receipt(chainId, hash) { const { loadChainRuntime } = await import("../infra"); return readUpgradeReceipt((await loadChainRuntime()).publicClient(chainId), chainId, hash); },
    async transaction(chainId, hash) { const { loadChainRuntime } = await import("../infra"); return readUpgradeTransaction((await loadChainRuntime()).publicClient(chainId), chainId, hash); },
  };
}

/** Fresh facts become a separate, saved project before the current pin, chain or navigation changes. */
export async function editInspectedDiamondAsPlan(target: InspectionTarget): Promise<Result<Project, string>> {
  const before = doc.get();
  const status = getCatalogStatus();
  const manifest = status.status === "ready" && status.manifest ? ok(status.manifest) : await fetchManifest();
  if (!manifest.ok) return err("The bundled catalog list couldn't be loaded. Retry opening the upgrade plan.");
  if (doc.get() !== before) return err("The current project changed. Open the diamond as a plan again.");
  const ports = preflightPorts();
  return createUpgradePlan(target, {
    chains: pickerChains(env.e2e).map(chainInfo), current: () => doc.get(), inspect: ports.inspect, catalogs: ports.catalogs, create: createProject,
    layout(recipe, catalog, origin, current) {
      const resolved = resolveUpgrade(recipe, catalog);
      const analysis = analyzeUpgrade(recipe, catalog, origin);
      if (!resolved.ok || !analysis.ok) throw new Error("The observed plan couldn't be laid out.");
      return tidy({ ...current, recipe, upgrade: origin, layout: {} }, resolved.value.catalog, analysis.value, layoutMetrics);
    },
    activate(_project, catalog) {
      const entry = findEntry(manifest.value, catalog.hash);
      resetForProjectSwitch();
      setCatalogStatus({ status: "ready", id: entry?.id ?? catalog.lattice.tag, catalog, manifest: manifest.value });
      session.set({ chainId: target.chainId });
    },
  });
}

let active: { controller: ReturnType<typeof createUpgradeTransaction>["controller"]; stop: () => void } | null = null;

let observer: ReturnType<typeof createUpgradeObserver> | null = null;
function upgradeObserver() {
  return observer ??= createUpgradeObserver({
    ...preflightPorts(), get: getDeployment, update: updateDeployment, chain: appPort,
    async transaction(chainId, hash) { const { loadChainRuntime } = await import("../infra"); return readUpgradeTransaction((await loadChainRuntime()).publicClient(chainId), chainId, hash); },
    async receipt(chainId, hash) { const { loadChainRuntime } = await import("../infra"); return readUpgradeReceipt((await loadChainRuntime()).publicClient(chainId), chainId, hash); },
    async afterSuccess(target) { invalidateInspectionCalls(); await getInspectionEngine().refresh(target); },
  });
}
/** Reload recovery observes saved intent; it never asks the wallet to resend. */
export function resumeUpgrade(chainId: number, address: Address, options: { txHash?: Hex } = {}): Promise<Result<void, string>> { return upgradeObserver().resume({ chainId, address }, options); }
export function stopUpgradeObservation(chainId: number, address: Address): void { upgradeObserver().stop({ chainId, address }); }
export function getUpgradeTracking(chainId: number, address: Address) { return upgradeObserver().get({ chainId, address }); }
export function subscribeUpgradeTracking(listener: () => void): () => void { return upgradeObserver().subscribe(listener); }
export function discardUpgradeProposal(chainId: number, address: Address): Promise<Result<void, string>> { return upgradeObserver().discardProposal({ chainId, address }); }

/** One explicit UI review followed by the existing simulate/estimate/wallet lifecycle. It never sends here. */
export async function reviewCurrentUpgrade(): Promise<Result<void, string>> {
  const project = doc.get(), catalog = getCatalog();
  const origin = project.upgrade;
  const hash = catalog ? recipeHash(project.recipe, catalog) : "0x";
  const state = { projectId: project.id, recipeHash: hash };
  setUpgradePreparation({ ...state, status: "checking" });
  const fail = (reason: string) => { setUpgradePreparation({ ...state, status: "error", reason }); return err(reason); };
  try {
    if (!origin || project.recipe.mode !== "upgrade" || !catalog) return fail("Open an upgrade plan with its pinned catalog first.");
    if (fixtureBlock(catalog.lattice.tag)) return fail("The fixture catalog is for demonstrations and cannot send upgrades.");
    if (!pickerChains(env.e2e).some((chain) => chain.id === origin.chainId && chain.testnet)) return fail("Choose a supported upgrade testnet.");
    if (!isOnline() || session.get().readOnly !== null || session.get().chainId !== origin.chainId) return fail(session.get().readOnly ?? "Select this plan's original chain and reconnect before upgrading.");
    const previous = getTransactionReview();
    if (previous && ["signing", "pending", "stale"].includes(previous.controller.get().phase)) { showTransactionProgress(); return fail("A transaction is already being tracked. Its progress is open."); }
    const key = currentUpgradeContextKey();
    const chain = await appPort();
    const account = chain.account();
    if (!account) return fail("Connect the intended upgrade account before review.");
    const record = await getDeployment(origin.chainId, origin.address);
    if (!record || record.status !== "confirmed") return fail("This diamond needs a confirmed observed record. Inspect it and open it as a plan again.");
    if (record.pendingUpgrade) return fail(record.pendingUpgrade.phase === "signing"
      ? "The previous wallet outcome is unknown. Check the wallet and recover its transaction hash; Studio won't resend it."
      : "This diamond already has an unresolved upgrade or Safe proposal. Check its outcome first.");
    const ports = executionPorts();
    const prepared = await prepareUpgrade({ project, catalog, from: account.address, context: studioState().analysis.context(), acks: session.get().acks[hash] ?? [] }, ports);
    if (!prepared.ok) return fail(prepared.error);
    if (currentUpgradeContextKey() !== key) return fail("The upgrade plan changed during preparation. Review it again.");
    const acceptance = await requestUpgradeReview(prepared.value.details);
    if (!acceptance.ok) return fail(acceptance.error);
    if (!acceptance.value.accepted) { setUpgradePreparation({ ...state, status: "idle" }); return err("Upgrade review was canceled."); }
    if (prepared.value.details.requiresOpaqueAcknowledgement && !acceptance.value.opaqueAcknowledged) return fail("Acknowledge the retained raw code's storage, initialization and authority coverage before upgrading.");
    if (currentUpgradeContextKey() !== key) return fail("The upgrade plan changed during review. Review it again.");
    if (active && !["signing", "pending", "stale"].includes(active.controller.get().phase)) { active.stop(); active.controller.dispose(); active = null; }
    ports.afterSuccess = async () => {
      invalidateInspectionCalls();
      const engine = getInspectionEngine(); await engine.refresh(origin);
      if (!("value" in engine.get(origin))) throw new Error("The confirmed diamond couldn't be refreshed.");
    };
    const runtime = createUpgradeTransaction(prepared.value, record, ports);
    const stopState = runtime.controller.subscribe(() => {
      const current = runtime.controller.get();
      if (current.error && ["failed", "rejected", "confirmed"].includes(current.phase)) setUpgradePreparation({ ...state, status: "error", reason: current.error });
      else if (["reviewing", "checking"].includes(current.phase)) setUpgradePreparation({ ...state, status: "checking" });
      else setUpgradePreparation({ ...state, status: "idle" });
    });
    const stopRequest = subscribeTransactionReview(() => {
      if (getTransactionReview()?.controller !== runtime.controller && !["signing", "pending", "stale"].includes(runtime.controller.get().phase)) {
        stopState(); stopRequest(); runtime.controller.dispose(); if (active?.controller === runtime.controller) active = null;
      }
    });
    active = { controller: runtime.controller, stop: () => { stopState(); stopRequest(); } };
    const opened = await openTransactionReview({ intent: runtime.intent, label: `Upgrade ${origin.address}`, controller: runtime.controller,
      beforeSafeExport: runtime.beforeSafeExport, onSafeExport: runtime.onSafeExport });
    return opened.ok ? ok(undefined) : fail(opened.error);
  } catch { return fail("The upgrade review couldn't be prepared. Check the connection and browser storage, then retry."); }
}
