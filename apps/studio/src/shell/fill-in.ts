/**
 * Whether **Fill in** shows (spec L362, L370): while a required init argument is missing or breaks its rule
 * (INIT-01, spec L327).
 */
import { useAnalysis } from "@/contracts";

export function useNeedsFillIn(): boolean {
  return useAnalysis((a) => a.problems.some((p) => p.code === "INIT-01"));
}
