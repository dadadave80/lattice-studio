/**
 * What the analysis says, drawn on the sheet (WP-S4c). `services.ts` registers the "dependency" and "tie" edge
 * types, the notes layer (order 10: after S4d's tool strip, before its title block) and Choose per selector;
 * `commands.ts` registers F8, ⇧F8, `problem.focus`, Resolve collision… and Choose per selector….
 *
 * For other modules:
 * - Go to a problem with `problem.focus {problemId}` (the Structure tree, the deploy review): it selects the
 *   card, shows the problem in the inspector and focuses its note, its init field or its card.
 * - A note carries `data-note-id`, `data-problems` (its problem ids) and, for a collision, `data-tour="collision"`
 *   (S10's coach mark).
 * - `buildNotes` says which problems have notes and what they offer.
 */
export { buildNotes, COLLISION_RULE, noteOf } from "./note-model";
export type { NoteKind, NoteModel, NoteSelector } from "./note-model";
export { TIE_EDGE_TYPE, TRACE_EDGE_TYPE } from "./edge-data";
