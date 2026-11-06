import { chainService, doc, env, isOnline, session, settings, subscribeOnline } from "@/contracts";
import { appPort } from "../deploy/app-port";
import { chainInfo, pickerChains } from "../infra/chains";
import { getInspectionEngine, inspectionCatalogs } from "./app";
import { invalidateInspectionCalls } from "./call-runtime";
import { createTransactionController, transactionSnapshotIdentity, type TransactionController } from "./transaction";
import { authorizeKnownOwner } from "./transaction-owner";

/** The current project/view and observed contract facts, independently of mere block advance. */
export function currentTransactionContextKey(): string {
  const view = session.get().panes.inspector.view;
  const state = view?.kind === "deployed" ? getInspectionEngine().get(view) : null;
  const facts = state && "value" in state ? transactionSnapshotIdentity(state.value.snapshot) : "";
  return `${doc.get().id}:${JSON.stringify(view)}:${facts}`;
}

let transaction: TransactionController | null = null;

/** Independent of the fresh-deployment controller: an existing target, exact calldata and one wallet send. */
export function getTransactionController(): TransactionController {
  transaction ??= createTransactionController({
    chains: pickerChains(env.e2e).map(chainInfo),
    chain: appPort,
    inspect: async (chainId, address, signal) => (await chainService()).inspectDiamond(chainId, address, { signal }),
    context: () => ({ key: currentTransactionContextKey(), online: isOnline(), readOnly: session.get().readOnly }),
    subscribe(listener) {
      const stops = [session.subscribe(listener), doc.subscribe(listener), subscribeOnline(listener), getInspectionEngine().subscribe(listener)];
      let disposed = false;
      void chainService().then((service) => {
        if (!disposed) stops.push(service.subscribeAccount(listener));
      }, () => undefined);
      return () => { disposed = true; for (const stop of stops) stop(); };
    },
    clock: {
      now: () => Date.now(), setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
      clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
    receiptTimeout: () => settings.get().receiptTimeout,
    async authorize(review, snapshot) {
      const catalogs = await inspectionCatalogs();
      return catalogs.ok ? authorizeKnownOwner(review, snapshot, catalogs.value) : { ok: true, value: undefined };
    },
    async onSuccess(review) {
      invalidateInspectionCalls();
      const target = { chainId: review.chainId, address: review.tx.to };
      const engine = getInspectionEngine();
      await engine.refresh(target);
      if (!("value" in engine.get(target))) throw new Error("Inspection refresh didn't finish.");
    },
  });
  return transaction;
}
