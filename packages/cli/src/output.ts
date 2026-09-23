/**
 * Human output in C10's formats (spec L678-L686): selectors, addresses (6 + 4, full where an address is the
 * point), cut indexes, "12/17 selectors", the problems chip. `--json` output is plain `JSON.stringify` with two
 * spaces; failures under `--json` are `{ "error": { exit, message, issues?, problems? } }` on stdout.
 */
import {
  type Analysis,
  type Catalog,
  formatAddress,
  formatCutIndex,
  formatParseIssue,
  formatProblemSummary,
  type Problem,
  plural,
  type Recipe,
  recipeStats,
} from "@lattice-studio/core";
import { latticeName } from "./catalogs";
import type { Deps } from "./deps";
import type { Failure } from "./failure";

export function writeJson(deps: Deps, value: unknown): void {
  deps.stdout(`${JSON.stringify(value, null, 2)}\n`);
}

export function writeLines(deps: Deps, lines: readonly string[]): void {
  if (lines.length > 0) deps.stdout(`${lines.join("\n")}\n`);
}

/** A note on stderr, so stdout stays the command's output (an export, JSON). */
export function note(deps: Deps, text: string): void {
  deps.stderr(`${text}\n`);
}

/** Prints the failure and returns its exit code. */
export function fail(deps: Deps, json: boolean, failure: Failure): number {
  if (json) {
    writeJson(deps, { error: failure });
    return failure.exit;
  }
  const lines = [failure.message];
  for (const issue of failure.issues ?? []) lines.push(`  ${formatParseIssue(issue)}`);
  lines.push(...problemLines(failure.problems ?? []));
  deps.stderr(`${lines.join("\n")}\n`);
  return failure.exit;
}

const SEVERITY: Record<Problem["severity"], string> = { blocker: "Blocker", warning: "Warning", info: "Info   " };

/** One line per problem, most severe first (the analysis already sorts them), with a confirm hint for LINK-01. */
export function problemLines(problems: readonly Problem[]): string[] {
  const lines: string[] = [];
  for (const p of problems) {
    lines.push(`  ${SEVERITY[p.severity]}  ${p.code.padEnd(7)}  ${p.message}`);
    if (p.code === "LINK-01" && typeof p.params["path"] === "string" && typeof p.params["address"] === "string") {
      lines.push(`  ${" ".repeat(18)}Check the full address, then confirm it: --confirm '${p.params["path"]}=${p.params["address"]}'`);
    }
  }
  return lines;
}

export function blockerCount(analysis: Pick<Analysis, "problems">): number {
  return analysis.problems.filter((p) => p.severity === "blocker").length;
}

/** The problems chip: "No problems", "2 blockers", "2 blockers · 1 warning". */
export function problemSummary(analysis: Pick<Analysis, "problems">): string {
  const warnings = analysis.problems.filter((p) => p.severity === "warning").length;
  return formatProblemSummary({ blockers: blockerCount(analysis), warnings });
}

/** "GovernedVault · recipe 0x… · Lattice dev-f4a32c8" */
export function headerLine(recipe: Recipe, catalog: Catalog, analysis: Analysis, fallbackName: string): string {
  return `${recipe.name ?? fallbackName} · recipe ${analysis.recipeHash} · ${latticeName(catalog)}`;
}

/** `check`'s human output. */
export function checkLines(recipe: Recipe, catalog: Catalog, analysis: Analysis, fallbackName: string): string[] {
  const stats = recipeStats(analysis, catalog);
  const lines = [headerLine(recipe, catalog, analysis, fallbackName), stats.text, problemSummary(analysis)];
  lines.push(...problemLines(analysis.problems));
  return lines;
}

function initName(catalog: Catalog, target: string): string | undefined {
  const lower = target.toLowerCase();
  return catalog.inits.find((init) => init.release?.address.toLowerCase() === lower)?.contract;
}

/** `plan`'s human output: the pinned footer's rows ("[00] ADD name, address, routed/total selectors", IR L125). */
export function planLines(recipe: Recipe, catalog: Catalog, analysis: Analysis, fallbackName: string): string[] {
  const stats = recipeStats(analysis, catalog);
  const lines = [headerLine(recipe, catalog, analysis, fallbackName), `Cut plan · ${stats.text}`];
  analysis.plan.forEach((entry, index) => {
    const count = stats.perFacet[entry.facet]?.text ?? plural(entry.selectors.length, "selector");
    lines.push(`${formatCutIndex(index)} ADD ${entry.facet} ${formatAddress(entry.address)} · ${count} · ${entry.version}`);
  });
  const planned = new Set(analysis.plan.map((entry) => entry.facet));
  const omitted = recipe.facets.filter((facet) => !planned.has(facet));
  if (omitted.length > 0) lines.push(`Not cut (they route nothing): ${omitted.join(", ")}`);
  if (analysis.init === null) {
    lines.push("Init: none");
  } else {
    const name = initName(catalog, analysis.init.target);
    const target = `${name === undefined ? "" : `${name} `}${formatAddress(analysis.init.target, { full: true })}`;
    const data = analysis.init.data;
    const detail =
      data !== undefined
        ? ` · ${plural((data.length - 2) / 2, "byte")} of calldata`
        : analysis.init.refs.length > 0
          ? ` · calldata resolves ${analysis.init.refs.map((ref) => (ref === "self" ? "this diamond" : "the deploying account")).join(" and ")} at deploy`
          : "";
    lines.push(`Init: calls ${target}${detail}`);
  }
  lines.push(problemSummary(analysis));
  lines.push(...problemLines(analysis.problems.filter((p) => p.severity !== "info")));
  return lines;
}
