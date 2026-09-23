/**
 * The deploy machine's dependencies in the app: the open document, S1's analysis and prediction, the session's chain
 * and acknowledgements, the connection service, S7a's deployment records (outside the document and its edit lock,
 * so a demoted tab keeps recording, spec L503), the catalog's files, the console, announcements and banners, the
 * settings and the injected clock. The chain comes from `runtime-port.ts`, loaded on first use.
 */
import {
  announce, chainService, doc, getAnalysis, getCatalog, hideBanner, isOnline, listDeployments, loadCreationCode, loadFacetDetail, log, now,
  putDeployment, session, settings, showBanner, subscribeAnalysis, subscribeCatalog, subscribeDeployments, subscribeOnline,
} from "@/contracts";
import { prediction } from "@/state";
import type { DeployDeps, DeployInputs } from "./ports";

function inputs(): DeployInputs {
  return {
    project: () => doc.get(),
    analysis: getAnalysis,
    catalog: getCatalog,
    chainId: () => session.get().chainId,
    prediction: () => {
      const p = prediction();
      return p.status === "ready"
        ? { status: "ready", address: p.address, chainId: p.chainId, path: p.path, from: p.from, salt: p.salt }
        : { status: "none", reason: p.reason };
    },
    acks: () => session.get().acks[getAnalysis().recipeHash] ?? [],
    online: isOnline,
    subscribe(listener) {
      let stopped = false;
      const stops: (() => void)[] = [
        doc.subscribe(() => listener()),
        session.subscribe((state, previous) => {
          if (state.chainId !== previous.chainId || state.acks !== previous.acks) listener();
        }),
        subscribeAnalysis(() => listener()),
        subscribeCatalog(() => listener()),
        subscribeOnline(() => listener()),
      ];
      // An account switch: the chain module is loaded by then whenever a deploy needs it.
      chainService().then(
        (service) => {
          if (stopped) return;
          stops.push(service.subscribeAccount(() => listener()));
        },
        () => {},
      );
      return () => {
        stopped = true;
        for (const stop of stops.splice(0)) stop();
      };
    },
  };
}

export function appDeployDeps(): DeployDeps {
  return {
    inputs: inputs(),
    chain: () => import("./runtime-port").then((m) => m.runtimePort()),
    records: { list: listDeployments, put: putDeployment, subscribe: subscribeDeployments },
    files: { detail: loadFacetDetail, code: loadCreationCode },
    say: { log, announce, showBanner, hideBanner },
    settings: () => {
      const s = settings.get();
      return { receiptTimeout: s.receiptTimeout, deployAnnouncements: s.deployAnnouncements };
    },
    clock: {
      now,
      setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
      clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
    },
  };
}
