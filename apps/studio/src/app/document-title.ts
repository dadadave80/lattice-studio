/**
 * `document.title` names the project and its state (spec L780, WCAG 2.4.2):
 * "GovernedVault · 2 blockers · Lattice Studio".
 */
import { formatProblemSummary, type Problem } from "@lattice-studio/core";
import { useEffect } from "react";
import { useAnalysis, useDocument } from "@/contracts";

export const APP_NAME = "Lattice Studio";

/** "No problems", "2 blockers", "2 blockers · 1 warning" (spec L686). */
export function problemSummary(problems: readonly Problem[]): string {
  let blockers = 0;
  let warnings = 0;
  for (const problem of problems) {
    if (problem.severity === "blocker") blockers += 1;
    else if (problem.severity === "warning") warnings += 1;
  }
  return formatProblemSummary({ blockers, warnings });
}

export function documentTitle(project: string, problems: string): string {
  return `${project} · ${problems} · ${APP_NAME}`;
}

/** Keeps `document.title` in step with the project's name and problems. */
export function useDocumentTitle(): void {
  const name = useDocument((s) => s.project.name);
  const problems = useAnalysis((a) => problemSummary(a.problems));
  useEffect(() => {
    document.title = documentTitle(name, problems);
  }, [name, problems]);
}
