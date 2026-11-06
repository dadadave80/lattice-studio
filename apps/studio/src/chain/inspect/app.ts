import { catalogHash, isAddress, toChecksum, type Catalog, type Result } from "@lattice-studio/core";
import { chainService, env, getCatalogStatus, session, type ChainInfo, type ChainService } from "@/contracts";
import { defaultEntry, fetchManifest, loadCatalogById } from "@/catalog/lookup";
import { requestInspectorFocus } from "@/panels/inspector/focus-request";
import { chainInfo, pickerChains } from "../infra/chains";
import { createInspectionEngine, type InspectionTarget } from "./engine";
import { parseInspectionTarget } from "./target";
import { normalize } from "viem/ens";
import { inspectionNavigationGeneration } from "./navigation";

export type InspectionAppPorts = {
  chains: readonly ChainInfo[];
  chain(): Promise<ChainService>;
  catalogs(): Promise<Result<readonly Catalog[], string>>;
  show(target: InspectionTarget): void;
};

const canceled = (): Result<never, string> => ({ ok: false, error: "Opening inspection was canceled." });

/** The resolution/navigation boundary; observing a deployment never changes the composition or its catalog. */
export function createInspectionApp(ports: InspectionAppPorts) {
  let intent = 0;
  let disposed = false;
  const engine = createInspectionEngine({
    chains: ports.chains,
    async read(target, signal) {
      const service = await ports.chain();
      if (signal.aborted) return { ok: false, error: { kind: "aborted", reason: "Inspection was canceled." } };
      return service.inspectDiamond(target.chainId, target.address, { signal });
    },
    catalogs: ports.catalogs,
    reverseName: async (target) => (await ports.chain()).reverseEns(target.address, target.chainId),
  });
  return {
    engine,
    async open(input: { target: string; chainId?: number }, signal?: AbortSignal): Promise<Result<void, string>> {
      const generation = ++intent;
      const navigation = inspectionNavigationGeneration();
      const current = () => !disposed && generation === intent && navigation === inspectionNavigationGeneration() && !signal?.aborted;
      if (!current()) return canceled();
      const parsed = parseInspectionTarget(input.target, input.chainId);
      if (!parsed.ok) return parsed;
      const chain = ports.chains.find((item) => item.id === parsed.value.chainId && item.testnet);
      if (!chain) return { ok: false, error: `Studio doesn't support chain ${parsed.value.chainId} yet.` };
      const text = parsed.value.target;
      const control = [...text].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
      if (!isAddress(text) && (/^0x/i.test(text) || !text.includes(".") || /\s/.test(text) || control)) {
        return { ok: false, error: "Enter a valid diamond address or ENS name." };
      }
      let name = text;
      if (!isAddress(text)) {
        try { name = normalize(text); }
        catch { return { ok: false, error: "Enter a valid diamond address or ENS name." }; }
      }
      try {
        let address = isAddress(text) ? toChecksum(text) : null;
        if (address === null) {
          const service = await ports.chain();
          if (!current()) return canceled();
          const resolved = await service.resolveEns(name, chain.id);
          if (!current()) return canceled();
          if (!resolved.ok) return resolved;
          if (resolved.value === null) return { ok: false, error: `No address is set for this ENS name on ${chain.name}.` };
          if (!isAddress(resolved.value)) return { ok: false, error: "ENS returned an invalid diamond address." };
          address = toChecksum(resolved.value);
        }
        if (!current()) return canceled();
        const target = { chainId: chain.id, address };
        ports.show(target);
        void engine.ensure(target);
        return { ok: true, value: undefined };
      } catch {
        return current() ? { ok: false, error: `Couldn't open the diamond on ${chain.name}. Retry opening it.` } : canceled();
      }
    },
    cancel(): void { intent++; },
    dispose(): void { disposed = true; intent++; engine.dispose(); },
  };
}

/** Bundled catalogs in deterministic default-first order, verified without changing the loaded catalog pin. */
export async function inspectionCatalogs(): Promise<Result<readonly Catalog[], string>> {
  const status = getCatalogStatus();
  const manifest = status.status === "ready" && status.manifest ? { ok: true as const, value: status.manifest } : await fetchManifest();
  if (!manifest.ok) return { ok: false, error: "The bundled catalog list couldn't be loaded. Retry inspection." };
  const first = defaultEntry(manifest.value);
  if (!first) return { ok: false, error: "The bundled catalog list has no default catalog." };
  const entries = [first, ...manifest.value.catalogs.filter((entry) => entry.id !== first.id)];
  const catalogs: Catalog[] = [];
  for (const entry of entries) {
    const result = status.status === "ready" && status.catalog.hash.toLowerCase() === entry.hash.toLowerCase()
      ? { ok: true as const, value: status.catalog } : await loadCatalogById(entry);
    if (!result.ok || result.value.hash.toLowerCase() !== entry.hash.toLowerCase()
      || catalogHash(result.value).toLowerCase() !== entry.hash.toLowerCase()) {
      return { ok: false, error: `Bundled catalog ${entry.id} couldn't be verified. Retry inspection.` };
    }
    catalogs.push(result.value);
  }
  return { ok: true, value: catalogs };
}

function show(target: InspectionTarget): void {
  session.set((state) => ({
    panes: { ...state.panes, drawer: "inspector", narrow: "inspector", inspector: { ...state.panes.inspector, open: true, view: { kind: "deployed", ...target } } },
  }));
  requestInspectorFocus({ kind: "heading" });
  if (typeof window !== "undefined") window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#d=${target.chainId}:${target.address}`);
}

let app: ReturnType<typeof createInspectionApp> | null = null;
function runtime() {
  app ??= createInspectionApp({ chains: pickerChains(env.e2e).map(chainInfo), chain: chainService, catalogs: inspectionCatalogs, show });
  return app;
}

export function getInspectionEngine() { return runtime().engine; }
export function openInspection(input: { target: string; chainId?: number }, signal?: AbortSignal): Promise<Result<void, string>> {
  return runtime().open(input, signal);
}
export function closeInspection(): void {
  app?.cancel();
  const view = session.get().panes.inspector.view;
  if (view?.kind === "deployed") session.set((state) => ({ panes: { ...state.panes, inspector: { ...state.panes.inspector, view: { kind: "diamond" } } } }));
  requestInspectorFocus({ kind: "heading" });
  if (typeof window !== "undefined" && (/^#(?:d|open)=/.test(window.location.hash))) {
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  }
}

/** @internal Tests can supply a runtime without starting real chain or catalog loaders. */
export function setInspectionApp(next: ReturnType<typeof createInspectionApp> | null): () => void {
  const previous = app;
  app = next;
  return () => {
    if (app === next) { next?.dispose(); app = previous; }
  };
}
