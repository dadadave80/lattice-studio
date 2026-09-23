/**
 * `problems` (IR L153, `problem.list`): the analysis's problems as console lines. A header counts them, then one
 * line per problem in the analysis's order (blockers first), each naming its severity in words and its code, and
 * carrying its anchor so a click locates it.
 */
import type { LineDraft, Problem, Severity } from "@lattice-studio/core";
import { formatProblemSummary } from "@lattice-studio/core";

export const NO_PROBLEMS = "No problems.";

const SEVERITY_WORD: Record<Severity, string> = { blocker: "Blocker", warning: "Warning", info: "Info" };

/** The console tag a problem reads under: the named lines' tags (spec L712-L714), else Note. */
function tagOf(problem: Problem): LineDraft["tag"] {
  if (problem.code === "SEL-01") return "Collision";
  if (problem.code === "DEP-01") return "Missing";
  if (problem.code.startsWith("INIT-")) return "Init";
  return "Note";
}

export function problemLines(problems: readonly Problem[]): LineDraft[] {
  if (!problems.length) return [{ tag: "Note", text: NO_PROBLEMS }];
  const blockers = problems.filter((p) => p.severity === "blocker").length;
  const warnings = problems.filter((p) => p.severity === "warning").length;
  const info = problems.length - blockers - warnings;
  const counts = blockers || warnings ? formatProblemSummary({ blockers, warnings }) : "";
  const header = [counts, info ? `${info} info` : ""].filter(Boolean).join(" · ");
  return [
    { tag: "Note", text: `${header}.` },
    ...problems.map((p): LineDraft => {
      const line: LineDraft = { tag: tagOf(p), text: `${SEVERITY_WORD[p.severity]} · ${p.code} · ${p.message}` };
      const anchor = p.where[0];
      return anchor ? { ...line, anchor } : line;
    }),
  ];
}
