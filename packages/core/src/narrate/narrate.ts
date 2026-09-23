import type { NarrateFn } from "../model/api";
import type { Analysis } from "../model/analysis";
import type { LineDraft } from "../model/console";
import type { Anchor, Problem, ProblemCode, ProblemParams } from "../model/problems";
import { joinOr } from "../format/text";
import { lines } from "./lines";

/**
 * Codes whose rendered `message` ends with a separate instruction sentence, and that sentence's exact text
 * (leading space included). A generic "Resolved:" line drops it: the spec's resolved examples (L713, L715)
 * state only what happened, never repeat the instruction that led to the fix. Explicit per code, not a
 * heuristic: every other code's message ends in a statement of fact, which a "Resolved:" line keeps.
 */
const TRAILING_INSTRUCTION: Partial<Record<ProblemCode, string>> = {
  "SEL-01": " Choose one owner.",
  "SEL-03": " Remove it.",
  "AUTH-01": " If it's a Safe that isn't deployed yet, deploy it first.",
};

/** `message` with its code's trailing instruction sentence dropped, when it has one and ends with it. */
function withoutInstruction(p: Problem): string {
  const suffix = TRAILING_INSTRUCTION[p.code];
  return suffix && p.message.endsWith(suffix) ? p.message.slice(0, -suffix.length) : p.message;
}

function resolvedLine(p: Problem): LineDraft {
  return withAnchor({ tag: "Resolved", text: `Resolved: ${withoutInstruction(p)}` }, p.where[0]);
}

function withAnchor(draft: LineDraft, anchor: Anchor | undefined): LineDraft {
  return anchor ? { ...draft, anchor } : draft;
}

function groupBy<T, K>(items: readonly T[], keyOf: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

function sel01Params(p: Problem): ProblemParams["SEL-01"] {
  return p.params as ProblemParams["SEL-01"];
}

function dep01Params(p: Problem): ProblemParams["DEP-01"] {
  return p.params as ProblemParams["DEP-01"];
}

/**
 * New SEL-01 problems, grouped by contender set (spec L712): one Collision line per group, in the order the
 * group's first problem appears in `next.problems`.
 */
function narrateNewCollisions(problems: readonly Problem[]): LineDraft[] {
  const groups = groupBy(problems, (p) => sel01Params(p).contenders.join("\u0000"));
  return [...groups.values()].map((group) => {
    const first = group[0] as Problem;
    const selectors = group.map((p) => ({ hex: sel01Params(p).selector, signature: sel01Params(p).signature }));
    return withAnchor(lines.collision({ contenders: sel01Params(first).contenders, selectors }), first.where[0]);
  });
}

/** New DEP-01 problems: one Missing line each (spec L714). */
function narrateNewDependencies(problems: readonly Problem[]): LineDraft[] {
  return problems.map((p) => {
    const params = dep01Params(p);
    return withAnchor(lines.missing({ facet: params.facet, requires: joinOr(params.anyOf), reason: params.reason }), p.where[0]);
  });
}

/**
 * Resolved SEL-01 problems, grouped by the routing's new owner (spec L713): one Resolved line per owner. A
 * selector with no owner in `next.routing` (both contenders removed, not just one chosen) falls back to a
 * generic Resolved line for that one problem.
 */
function narrateResolvedCollisions(problems: readonly Problem[], next: Analysis): LineDraft[] {
  const groups = groupBy(problems, (p) => next.routing[sel01Params(p).selector]?.owner ?? "");
  const out: LineDraft[] = [];
  for (const [owner, group] of groups) {
    if (!owner) {
      for (const p of group) out.push(resolvedLine(p));
      continue;
    }
    const first = group[0] as Problem;
    const selectors = group.map((p) => ({ hex: sel01Params(p).selector, signature: sel01Params(p).signature }));
    out.push(withAnchor(lines.resolved({ selectors, owner }), first.where[0]));
  }
  return out;
}

/** Resolved DEP-01 problems: one "Dependency met" line each (spec L715). */
function narrateResolvedDependencies(problems: readonly Problem[]): LineDraft[] {
  return problems.map((p) => withAnchor(lines.dependencyMet({ facet: dep01Params(p).facet }), p.where[0]));
}

/**
 * The difference between two analyses (spec L304): new problems appear, resolved ones say "Resolved:". SEL-01
 * (Collision, grouped by contender set) and DEP-01 (Missing/Dependency met) get the console's named lines
 * (spec L712-L715); every other code narrates generically, tagged Note when new and Resolved when gone, from
 * `runChecks`'s already-rendered `message`. `prev = null` narrates nothing: a load resets the baseline.
 */
export const narrate: NarrateFn = (prev, next, cause) => {
  if (prev === null) return [];

  const prevById = new Map(prev.problems.map((p) => [p.id, p]));
  const nextById = new Map(next.problems.map((p) => [p.id, p]));
  const added = next.problems.filter((p) => !prevById.has(p.id));
  const resolved = prev.problems.filter((p) => !nextById.has(p.id));

  const addedSel01 = added.filter((p) => p.code === "SEL-01");
  const addedDep01 = added.filter((p) => p.code === "DEP-01");
  const addedRest = added.filter((p) => p.code !== "SEL-01" && p.code !== "DEP-01");

  const resolvedSel01 = resolved.filter((p) => p.code === "SEL-01");
  const resolvedDep01 = resolved.filter((p) => p.code === "DEP-01");
  const resolvedRest = resolved.filter((p) => p.code !== "SEL-01" && p.code !== "DEP-01");

  const out: LineDraft[] = [
    ...narrateNewCollisions(addedSel01),
    ...narrateNewDependencies(addedDep01),
    ...addedRest.map((p) => withAnchor({ tag: "Note", text: p.message }, p.where[0])),
    ...narrateResolvedCollisions(resolvedSel01, next),
    ...narrateResolvedDependencies(resolvedDep01),
    ...resolvedRest.map(resolvedLine),
  ];

  return cause?.kind === "undo" || cause?.kind === "redo" ? out.map((line) => ({ ...line, dim: true })) : out;
};
