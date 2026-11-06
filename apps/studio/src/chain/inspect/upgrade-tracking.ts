import { canonicalJson, err, ok, sameAddress, settleUpgradeRecord, type Address, type Deployment, type Hex, type Result } from "@lattice-studio/core";
import { validateDeployment } from "@lattice-studio/core/schema";
import type { DeployChainPort } from "../deploy/ports";
import type { InspectionTarget } from "./engine";
import { verifyUpgradeEvidence, verifyUpgradeTransaction, type UpgradeObservedReceipt, type UpgradeObservedTransaction } from "./upgrade-evidence";
import { upgradeBaseline, type UpgradePreflightPorts } from "./upgrade-preflight";
import type { UpgradeRecordPorts } from "./upgrade-records";

export type UpgradeTrackingState = { status: "idle" | "watching" | "error" | "verified"; reason?: string; hash?: Hex };
class UpgradeObservationError extends Error {}
const IDLE: UpgradeTrackingState = Object.freeze({ status: "idle" });
export type UpgradeTrackingPorts = UpgradePreflightPorts & {
  get(chainId: number, address: Address): Promise<Deployment | null>;
  update: UpgradeRecordPorts["update"];
  chain(): Promise<DeployChainPort>;
  transaction(chainId: number, hash: Hex): Promise<Result<UpgradeObservedTransaction, string>>;
  receipt(chainId: number, hash: Hex): Promise<Result<UpgradeObservedReceipt, string>>;
  afterSuccess?(target: InspectionTarget): Promise<void>;
};
const key = (target: InspectionTarget) => `${target.chainId}:${target.address.toLowerCase()}`;
const reservation = (record: Deployment) => {
  const pending = record.pendingUpgrade;
  if (!pending) return "none";
  const { phase: _phase, tx: _tx, ...intent } = pending;
  return canonicalJson({ owner: record.projectId, revision: record.revision, recipeHash: record.recipeHash, catalogHash: record.catalogHash, intent });
};
function alreadySettled(current: Deployment, captured: Deployment): boolean {
  const intent = captured.pendingUpgrade;
  return intent !== undefined && current.pendingUpgrade === undefined && current.projectId === captured.projectId
    && current.chainId === captured.chainId && sameAddress(current.address, captured.address) && current.revision === captured.revision + 1
    && current.recipeHash.toLowerCase() === intent.desiredRecipeHash.toLowerCase() && current.catalogHash.toLowerCase() === intent.catalogHash.toLowerCase();
}

/** Observation only: there is deliberately no send, sign, timeout lease, or automatic retry path. */
export function createUpgradeObserver(ports: UpgradeTrackingPorts) {
  const states = new Map<string, UpgradeTrackingState>();
  const active = new Map<string, AbortController>();
  const listeners = new Set<() => void>();
  const publish = (target: InspectionTarget, state: UpgradeTrackingState) => { states.set(key(target), state); for (const listener of listeners) listener(); };
  const load = async (target: InspectionTarget): Promise<Result<Deployment, string>> => {
    const saved = await ports.get(target.chainId, target.address);
    const checked = validateDeployment(saved);
    if (!checked.ok || checked.value.value.chainId !== target.chainId || !sameAddress(checked.value.value.address, target.address)) return err("The saved deployment is unavailable or malformed.");
    return ok(checked.value.value);
  };
  const bound = (target: InspectionTarget, captured: Deployment, update: (current: Deployment) => Result<Deployment, string>) => ports.update(target.chainId, target.address, (current) => {
    if (current && alreadySettled(current, captured)) return ok(current);
    if (!current || reservation(current) !== reservation(captured)) return err("The saved upgrade changed. Its newer tracking wasn't overwritten.");
    return update(current);
  });
  const follow = async (target: InspectionTarget, captured: Deployment, first: UpgradeObservedTransaction, controller: AbortController) => {
    let hash = first.hash;
    try {
      const chain = await ports.chain();
      let writes = Promise.resolve<Result<Deployment, string>>(ok(captured));
      const outcome = await chain.watch(target.chainId, hash, { from: first.from, signal: controller.signal, onRepriced(next) {
        if (controller.signal.aborted) return;
        const previous = hash; hash = next;
        writes = writes.then((prior) => !prior.ok || controller.signal.aborted ? prior : bound(target, captured, (current) => current.pendingUpgrade?.tx?.toLowerCase() === previous.toLowerCase()
          ? ok({ ...current, pendingUpgrade: { ...current.pendingUpgrade, tx: next, phase: "pending" } }) : err("The tracked upgrade hash changed in another tab.")));
        publish(target, { status: "watching", hash: next });
      } });
      const saved = await writes;
      if (controller.signal.aborted || outcome.kind === "aborted") return;
      if (!saved.ok) throw new UpgradeObservationError(saved.error);
      if (outcome.kind === "replaced") {
        const cleared = await bound(target, captured, (current) => {
          if (current.pendingUpgrade?.tx?.toLowerCase() !== hash.toLowerCase()) return err("The upgrade hash changed before its replacement was recorded.");
          const { pendingUpgrade: _pending, ...confirmed } = current; return ok(confirmed);
        });
        if (!cleared.ok) throw new UpgradeObservationError(cleared.error);
        publish(target, { status: "idle", hash: outcome.hash, reason: "The upgrade was replaced or canceled. Its previous revision is still recorded." }); return;
      }
      const latest = await load(target);
      if (!latest.ok || (reservation(latest.value) !== reservation(captured) && !alreadySettled(latest.value, captured))) throw new UpgradeObservationError("The upgrade record changed before receipt verification.");
      const proofRecord = latest.value.pendingUpgrade ? latest.value : { ...captured, pendingUpgrade: { ...captured.pendingUpgrade!, tx: hash } };
      const [tx, receipt] = await Promise.all([ports.transaction(target.chainId, hash), ports.receipt(target.chainId, hash)]);
      if (!tx.ok) throw new UpgradeObservationError(tx.error); if (!receipt.ok) throw new UpgradeObservationError(receipt.error);
      const evidence = verifyUpgradeEvidence(proofRecord, tx.value, receipt.value);
      if (!evidence.ok) throw new UpgradeObservationError(evidence.error);
      if (controller.signal.aborted) return;
      if (evidence.value.status === "reverted") {
        const reverted = await bound(target, captured, (current) => settleUpgradeRecord(current, evidence.value));
        if (!reverted.ok) throw new UpgradeObservationError(reverted.error);
        publish(target, { status: "idle", hash, reason: "The upgrade reverted. Its previous revision is still recorded." }); return;
      }
      const verifying = await bound(target, captured, (current) => current.pendingUpgrade?.tx?.toLowerCase() === hash.toLowerCase()
        ? ok({ ...current, pendingUpgrade: { ...current.pendingUpgrade, phase: "verifying" } }) : err("The upgrade hash changed before its receipt was verified."));
      if (!verifying.ok) throw new UpgradeObservationError(verifying.error);
      const inspected = await ports.inspect(target, controller.signal);
      if (!inspected.ok) throw new UpgradeObservationError("The upgrade receipt succeeded, but the diamond couldn't be re-read. Its previous revision is still recorded.");
      const observed = upgradeBaseline(inspected.value, target.address);
      if (!observed.ok) throw new UpgradeObservationError(observed.error);
      if (controller.signal.aborted) return;
      const canonical = await ports.receipt(target.chainId, hash);
      if (!canonical.ok || canonical.value.blockHash.toLowerCase() !== receipt.value.blockHash.toLowerCase()
        || canonical.value.hash.toLowerCase() !== hash.toLowerCase() || canonical.value.block !== evidence.value.block || canonical.value.status !== evidence.value.status) throw new UpgradeObservationError("The upgrade receipt changed during verification. Retry observation; its previous revision is still recorded.");
      const independentlySettled = settleUpgradeRecord(proofRecord, evidence.value, observed.value);
      if (!independentlySettled.ok) throw new UpgradeObservationError(independentlySettled.error);
      const settled = await bound(target, captured, (current) => settleUpgradeRecord(current, evidence.value, observed.value));
      if (!settled.ok) throw new UpgradeObservationError(settled.error);
      publish(target, { status: "verified", hash });
      await ports.afterSuccess?.(target);
    } catch (error) {
      if (!controller.signal.aborted) publish(target, { status: "error", hash, reason: error instanceof UpgradeObservationError ? error.message : "The upgrade outcome couldn't be verified. Its previous revision is still recorded." });
    } finally { if (active.get(key(target)) === controller) active.delete(key(target)); }
  };
  return {
    get(target: InspectionTarget): UpgradeTrackingState { return states.get(key(target)) ?? IDLE; },
    subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async resume(target: InspectionTarget, options: { txHash?: Hex } = {}): Promise<Result<void, string>> {
      if (active.has(key(target))) return ok(undefined);
      const controller = new AbortController(); active.set(key(target), controller);
      const fail = (reason: string) => { if (active.get(key(target)) === controller) active.delete(key(target)); if (!controller.signal.aborted) publish(target, { status: "error", reason }); return err(reason); };
      try {
        const loaded = await load(target); if (!loaded.ok) return fail(loaded.error);
        let record = loaded.value; const pending = record.pendingUpgrade;
        if (!pending) return fail("This diamond has no unresolved upgrade to observe.");
        if (!pending.call) return fail("This saved upgrade has no exact transaction intent. Studio can't safely attach or verify a recovery hash.");
        const hash = options.txHash ?? pending.tx;
        if (!hash) return fail(pending.phase === "signing" ? "Wallet outcome unknown. Check the wallet and provide its transaction hash; Studio won't resend." : "This is an unexecuted Safe proposal. Provide the executed transaction hash to observe it.");
        if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return fail("Enter a 32-byte transaction hash.");
        if (pending.tx && pending.tx.toLowerCase() !== hash.toLowerCase()) return fail("A different transaction hash is already being tracked for this upgrade.");
        const tx = await ports.transaction(target.chainId, hash); if (!tx.ok) return fail(tx.error);
        if (tx.value.hash.toLowerCase() !== hash.toLowerCase()) return fail("The RPC returned a different transaction hash.");
        const direct = verifyUpgradeTransaction(record, tx.value);
        if (!direct.ok) return fail("This transaction isn't an exact direct call or single Safe Call envelope. Router and multisend recovery need an authenticated execution trace; Studio won't infer the caller from events.");
        if (controller.signal.aborted) return fail("Upgrade observation was stopped.");
        if (!pending.tx) {
          // A manually supplied mined call must already prove this attempt, before its hash is saved.
          // Only a transport-proven pending transaction may attach while no receipt is available.
          const receipt = await ports.receipt(target.chainId, hash);
          if (receipt.ok) {
            const evidence = verifyUpgradeEvidence(record, tx.value, receipt.value);
            if (!evidence.ok) return fail(evidence.error);
          } else if (tx.value.block !== null) return fail("This mined transaction needs an available canonical receipt before its hash can be attached.");
          if (controller.signal.aborted) return fail("Upgrade observation was stopped.");
          const attached = await bound(target, record, (current) => current.pendingUpgrade?.tx === undefined
            ? ok({ ...current, pendingUpgrade: { ...current.pendingUpgrade!, phase: "pending", tx: hash } }) : err("Another tab attached an upgrade hash first."));
          if (!attached.ok) return fail(attached.error); record = attached.value;
        }
        if (controller.signal.aborted) return fail("Upgrade observation was stopped.");
        publish(target, { status: "watching", hash }); void follow(target, record, tx.value, controller);
        return ok(undefined);
      } catch { return fail("The upgrade observation couldn't start. Check the connection and browser storage; Studio hasn't resent anything."); }
    },
    stop(target: InspectionTarget): void { active.get(key(target))?.abort(); active.delete(key(target)); publish(target, { status: "idle", reason: "Observation stopped. The unresolved upgrade is still saved." }); },
    async discardProposal(target: InspectionTarget): Promise<Result<void, string>> {
      const loaded = await load(target); if (!loaded.ok) return loaded;
      const pending = loaded.value.pendingUpgrade;
      if (pending?.phase !== "proposed" || pending.tx !== undefined || pending.callsId !== undefined) return err("Only an unexecuted Safe proposal can be discarded. An unknown wallet outcome must be recovered first.");
      const discarded = await bound(target, loaded.value, (current) => { const { pendingUpgrade: _pending, ...confirmed } = current; return ok(confirmed); });
      return discarded.ok ? ok(undefined) : discarded;
    },
    dispose(): void { for (const controller of active.values()) controller.abort(); active.clear(); listeners.clear(); },
  };
}
