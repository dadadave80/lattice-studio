/**
 * Going to a problem (IR L17, spec L300, L437): F8 and ⇧F8 in problem order, `problem.focus` from the Structure
 * tree and the deploy review, and Resolve collision…. Loaded with the command that runs it, never in the entry.
 *
 * Going to a problem selects its card and shows the problem in the inspector in one session update (S5c keeps
 * a view routed together with a selection change), then moves focus:
 * - to its note, which scrolls into view with its card (`note-focus.ts`, served by the note when it shows);
 * - for an init problem, to the field in the init plan (`init.open`, which focuses the field or step);
 * - otherwise to its card, scrolled clear of the floating UI; with no card, the status region reads it.
 */
import type { Anchor, Problem } from "@lattice-studio/core";
import {
  announce, doc, getAnalysis, getCatalog, log, runCommand, session, type CommandSource,
} from "@/contracts";
import { ensureVisible } from "@/sheet/canvas";
import { anchorFacets, buildNotes, noteOf } from "./note-model";
import { requestNoteFocus } from "./note-focus";
import { stepProblem, type ProblemCursor } from "./problem-order";

const SEVERITY_WORD = { blocker: "Blocker", warning: "Warning", info: "Info" } as const;

/** "No problems." (spec L362's state, as a sentence). */
export const NO_PROBLEMS = "No problems.";
export const NO_COLLISIONS = "No selector collisions to resolve.";
export const PROBLEM_GONE = "This problem no longer applies.";

let cursor: ProblemCursor | null = null;

/** Where F8 goes from: set when a problem is shown, or a note is focused by hand. */
export function setProblemCursor(id: string): void {
  const index = getAnalysis().problems.findIndex((p) => p.id === id);
  cursor = { id, index: Math.max(index, 0) };
}

/** Where F8 goes from, if anywhere yet. */
export function problemCursor(): ProblemCursor | null {
  return cursor;
}

/** Forgets where F8 was (tests; a new project). */
export function resetProblemCursor(): void {
  cursor = null;
}

function say(text: string): void {
  log({ tag: "Note", text });
  announce(text);
}

function initAnchor(problem: Problem): Extract<Anchor, { kind: "init" }> | undefined {
  return problem.where.find((a): a is Extract<Anchor, { kind: "init" }> => a.kind === "init");
}

function nodeElement(facet: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(facet)}"]`);
}

/**
 * Goes to `problemId`: selects its card, shows it in the inspector and focuses its note (or its field, or its
 * card). `open` also opens the note's choice (Resolve collision…). False when the problem no longer applies.
 */
export function focusProblem(problemId: string, options: { open?: boolean; source?: CommandSource } = {}): boolean {
  const problem = getAnalysis().problems.find((p) => p.id === problemId);
  if (!problem) {
    say(PROBLEM_GONE);
    return false;
  }
  setProblemCursor(problem.id);
  // Typed in the console (`next`), the answer is a line there too (IR L153).
  if (options.source === "console") log({ tag: "Note", text: `${SEVERITY_WORD[problem.severity]}: ${problem.message}` });
  const placed = doc.get().recipe.facets;
  const note = noteOf(buildNotes(getAnalysis(), getCatalog()), problem.id);
  const card = [...(note?.facets ?? []), ...anchorFacets(problem)].find((facet) => placed.includes(facet));

  session.set((s) => ({
    ...(card !== undefined ? { selection: [card] } : {}),
    panes: { ...s.panes, inspector: { ...s.panes.inspector, view: { kind: "problem", id: problem.id } } },
  }));

  if (note) {
    requestNoteFocus({ noteId: note.id, problemId: problem.id, open: options.open === true });
    return true;
  }
  const init = initAnchor(problem);
  if (init) {
    void runCommand({ id: "init.open", args: { focus: init.path } }, options.source ?? "api");
    return true;
  }
  if (card !== undefined) {
    ensureVisible(card);
    const element = nodeElement(card);
    if (element) {
      element.focus({ preventScroll: true });
      return true;
    }
  }
  // Nothing on the sheet to focus: the inspector shows it, and the status region reads it; focus stays put.
  announce(`${SEVERITY_WORD[problem.severity]}: ${problem.message}`);
  return true;
}

/** F8 (`dir` 1) and ⇧F8 (`dir` -1). */
export function stepToProblem(dir: 1 | -1, source: CommandSource = "keys"): void {
  const ids = getAnalysis().problems.map((p) => p.id);
  const next = stepProblem(ids, cursor, dir);
  if (next === undefined) {
    say(NO_PROBLEMS);
    return;
  }
  focusProblem(next, { source });
}

/** Resolve collision…: the first unresolved collision's note, with its choice open (spec L437). */
export function resolveCollision(source: CommandSource = "palette"): void {
  const first = buildNotes(getAnalysis(), getCatalog()).find((note) => note.kind === "collision");
  const problemId = first?.problemIds[0];
  if (problemId === undefined) {
    say(NO_COLLISIONS);
    return;
  }
  focusProblem(problemId, { open: true, source });
}
