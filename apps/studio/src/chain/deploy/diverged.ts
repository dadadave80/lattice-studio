/**
 * "The sheet now differs from what's live on Sepolia (r1)." (spec L728): the console line when an edit takes the
 * recipe hash away from a live record's. It watches the analysis and the open project's records from the entry chunk,
 * so it says so without loading the deploy engine or the chain module. Light.
 */
import type { Deployment, Hex } from "@lattice-studio/core";
import { announce, doc, getAnalysis, listDeployments, log, settings, subscribeAnalysis, subscribeDeployments } from "@/contracts";

/** Before any analysis: never a recipe the sheet had. */
const NO_HASH = "0x";

function live(d: Deployment, projectId: string, hash: Hex): boolean {
  return d.projectId === projectId && d.status === "confirmed" && d.fromFile !== true && d.recipeHash.toLowerCase() === hash.toLowerCase();
}

/** Per chain, the newest record that was live for `from` and has no live twin for `to`: the chains the edit left. */
export function divergedRecords(records: readonly Deployment[], projectId: string, from: Hex, to: Hex): Deployment[] {
  const out = new Map<number, Deployment>();
  for (const d of [...records].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))) {
    if (out.has(d.chainId) || !live(d, projectId, from)) continue;
    if (records.some((other) => other.chainId === d.chainId && live(other, projectId, to))) continue;
    out.set(d.chainId, d);
  }
  return [...out.values()].sort((a, b) => a.chainId - b.chainId);
}

/** Watches the open project's recipe hash against its live records. Returns a disposer. */
export function startDivergenceWatch(): () => void {
  let projectId = doc.get().id;
  let hash: Hex = getAnalysis().recipeHash;
  let records: Deployment[] = [];
  let loadedFor: string | null = null;
  let stopped = false;

  const load = (id: string): void => {
    listDeployments(id).then(
      (list) => {
        if (stopped || id !== doc.get().id) return;
        records = list;
        loadedFor = id;
      },
      () => {},
    );
  };

  const stopAnalysis = subscribeAnalysis((next) => {
    const id = doc.get().id;
    if (id !== projectId) {
      projectId = id;
      hash = next.recipeHash;
      load(id);
      return;
    }
    if (next.recipeHash === NO_HASH || next.recipeHash === hash) return;
    const from = hash;
    hash = next.recipeHash;
    if (from === NO_HASH || loadedFor !== id) return;
    const left = divergedRecords(records, id, from, next.recipeHash);
    if (left.length === 0) return;
    import("./diverged-line").then(({ divergedLine }) => {
      for (const d of left) {
        const line = divergedLine(d.chainId, d.revision);
        log(line);
        if (settings.get().deployAnnouncements === "all") announce(line.text, { politeness: "polite" });
      }
    }, (error: unknown) => console.error(error));
  });
  const stopRecords = subscribeDeployments((id) => {
    if (id === doc.get().id) load(id);
  });
  queueMicrotask(() => {
    if (!stopped) load(projectId);
  });
  return () => {
    stopped = true;
    stopAnalysis();
    stopRecords();
  };
}
