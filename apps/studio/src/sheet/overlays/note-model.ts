/**
 * Margin notes as data (spec L434-L449, IR L108, PA bugs 21-22): which problems get a note, what each note
 * says and what it offers. Pure: the layer places and draws them, the commands find a problem's note here.
 *
 * - **Collision** (SEL-01): one note per contested set, the selectors a group of facets fights over together
 *   (grouped by the contender set, catalog order), never one per selector and never one per pair (PA bug 22).
 *   Its choice lists the card already on the sheet first, so the newcomer is the one being decided.
 * - **Seam** (SEM-01), **missing dependency** (DEP-01) and **convention** (DEP-02, quieter): one note per
 *   problem, with the problem's message and fixes.
 *
 * Every other problem has no note: F8 goes to its card, the init plan or the inspector instead.
 */
import type { Analysis, Catalog, CommandRef, Hex4, Problem, Severity } from "@lattice-studio/core";
import { isHex4 } from "@lattice-studio/core";

export type NoteKind = "collision" | "seam" | "missing" | "convention";

export type NoteSelector = { hex: Hex4; signature: string };

export type NoteModel = {
  /** Stable across edits: `collision:A+B`, else the problem id (spec L305). */
  id: string;
  kind: NoteKind;
  severity: Severity;
  /** The problems the note stands for, in problem order. */
  problemIds: string[];
  /** "Selector collision · 2", "Missing dependency". */
  caption: string;
  /** The cards it's about: where it sits and where Go to card goes (the first). */
  facets: string[];
  /** Collision: the contested selectors, in problem order. */
  selectors: NoteSelector[];
  /** Collision: the contenders, the card already on the sheet first (`arrivalOrder`), else catalog order. */
  contenders: string[];
  /** The sentence under the caption: the problem's message, or the collision's rule. */
  text: string;
  /** Seam, missing dependency and convention: the problem's fixes, as the checks offer them. */
  fixes: CommandRef[];
};

/** The collision note's rule (spec L435). */
export const COLLISION_RULE = "Only one facet can serve each selector.";

const CAPTIONS: Record<Exclude<NoteKind, "collision">, string> = {
  seam: "Seam",
  missing: "Missing dependency",
  convention: "Convention",
};

/** "Selector collision · 2"; a single selector has no count (Composer-Final). */
export function collisionCaption(count: number): string {
  return count > 1 ? `Selector collision · ${count}` : "Selector collision";
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** The facets a problem's anchors name, in order, once each. */
export function anchorFacets(problem: Problem): string[] {
  const out: string[] = [];
  for (const anchor of problem.where) {
    const facet = anchor.kind === "facet" || anchor.kind === "selector" ? anchor.facet : undefined;
    if (facet !== undefined && !out.includes(facet)) out.push(facet);
  }
  return out;
}

function signatureOf(catalog: Catalog | null, hex: Hex4, fallback: unknown): string {
  if (typeof fallback === "string" && fallback !== "") return fallback;
  for (const facet of catalog?.facets ?? []) {
    const found = facet.selectors.find((s) => s.hex === hex);
    if (found) return found.signature;
  }
  return hex;
}

function problemNote(problem: Problem, kind: Exclude<NoteKind, "collision">, facets: string[]): NoteModel {
  return {
    id: problem.id,
    kind,
    severity: problem.severity,
    problemIds: [problem.id],
    caption: CAPTIONS[kind],
    facets,
    selectors: [],
    contenders: [],
    text: problem.message,
    fixes: problem.fixes,
  };
}

/** The facets a seam note sits by: the stale owner, else the facets that export the selector. */
function seamFacets(problem: Problem): string[] {
  const owner = stringOf(problem.params["owner"]);
  return owner !== undefined ? [owner] : anchorFacets(problem);
}

/**
 * The sheet's facets in the order they came onto it: those already in `previous` keep their places, and the
 * rest follow in `facets`' own (catalog) order. A facet that left and came back counts as new. Returns
 * `previous` itself when nothing changed.
 */
export function arrivalOrder(previous: readonly string[], facets: readonly string[]): readonly string[] {
  const present = new Set(facets);
  const kept = previous.filter((facet) => present.has(facet));
  const known = new Set(kept);
  const next = [...kept, ...facets.filter((facet) => !known.has(facet))];
  return next.length === previous.length && next.every((facet, i) => facet === previous[i]) ? previous : next;
}

/** `contenders` with the earlier arrivals first; a facet `arrived` doesn't name keeps its place after them. */
function byArrival(contenders: readonly string[], arrived: readonly string[]): string[] {
  const at = (facet: string) => {
    const i = arrived.indexOf(facet);
    return i < 0 ? arrived.length : i;
  };
  return [...contenders].sort((a, b) => at(a) - at(b));
}

/**
 * The notes the analysis calls for, in the order of their first problem. `arrived` is the sheet's facets in
 * the order they came onto it (`arrivalOrder`): a collision's Keep and Route follow it. Without it, catalog order.
 */
export function buildNotes(analysis: Pick<Analysis, "problems">, catalog: Catalog | null, arrived: readonly string[] = []): NoteModel[] {
  const notes: NoteModel[] = [];
  const sets = new Map<string, NoteModel>();
  for (const problem of analysis.problems) {
    switch (problem.code) {
      case "SEL-01": {
        const selector = problem.params["selector"];
        const contenders = stringsOf(problem.params["contenders"]);
        if (!isHex4(selector) || contenders.length < 2) break;
        const key = contenders.join("+");
        const line = { hex: selector, signature: signatureOf(catalog, selector, problem.params["signature"]) };
        const existing = sets.get(key);
        if (existing) {
          existing.problemIds.push(problem.id);
          existing.selectors.push(line);
          existing.caption = collisionCaption(existing.selectors.length);
          break;
        }
        const note: NoteModel = {
          id: `collision:${key}`,
          kind: "collision",
          severity: problem.severity,
          problemIds: [problem.id],
          caption: collisionCaption(1),
          facets: [...contenders],
          selectors: [line],
          contenders: byArrival(contenders, arrived),
          text: COLLISION_RULE,
          fixes: [],
        };
        sets.set(key, note);
        notes.push(note);
        break;
      }
      case "SEM-01":
        notes.push(problemNote(problem, "seam", seamFacets(problem)));
        break;
      case "DEP-01": {
        const facet = stringOf(problem.params["facet"]);
        notes.push(problemNote(problem, "missing", facet ? [facet] : anchorFacets(problem)));
        break;
      }
      case "DEP-02": {
        const facet = stringOf(problem.params["facet"]);
        notes.push(problemNote(problem, "convention", facet ? [facet] : anchorFacets(problem)));
        break;
      }
      default:
        break;
    }
  }
  return notes;
}

/** The note that stands for `problemId`, if it has one. */
export function noteOf(notes: readonly NoteModel[], problemId: string): NoteModel | undefined {
  return notes.find((note) => note.problemIds.includes(problemId));
}

/** The DOM id of a note's element. */
export function noteElementId(noteId: string): string {
  return `lx-note-${noteId.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}
