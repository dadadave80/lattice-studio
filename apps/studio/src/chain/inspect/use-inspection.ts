import { useEffect, useSyncExternalStore } from "react";
import { getInspectionEngine } from "./app";
import type { InspectionEngine, InspectionState, InspectionTarget } from "./engine";

/** Both panes observe one cached snapshot; changing a local selection never reloads the chain. */
export function useInspection(target: InspectionTarget, engine: InspectionEngine = getInspectionEngine()): InspectionState {
  const { chainId, address } = target;
  useEffect(() => { void engine.ensure({ chainId, address }); }, [engine, chainId, address]);
  return useSyncExternalStore(engine.subscribe, () => engine.get({ chainId, address }));
}
