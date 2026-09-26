/**
 * Where F8, `problem.focus` and Resolve collision… hand focus to a note. The note may not be drawn yet (the
 * layer is its own chunk, and a note is placed after its problem appears), so the command records a request
 * and the note takes it when it shows, or at once if it already does. A request expires after
 * `NOTE_FOCUS_TTL_MS`, so a note that never shows can't steal focus later.
 */
import { now } from "@/contracts";

export const NOTE_FOCUS_TTL_MS = 3000;

export type NoteFocusRequest = {
  noteId: string;
  /** The problem the focus is for (a collision note stands for several). */
  problemId: string;
  /** Resolve collision…: open the note's choice as well. */
  open: boolean;
};

let pending: (NoteFocusRequest & { at: number }) | null = null;

function strip(request: NoteFocusRequest): NoteFocusRequest {
  return { noteId: request.noteId, problemId: request.problemId, open: request.open };
}
const listeners = new Set<() => void>();

export function requestNoteFocus(request: NoteFocusRequest): void {
  pending = { ...request, at: now() };
  for (const listener of Array.from(listeners)) listener();
}

/** Takes the live request for `noteId`, if there is one. */
export function takeNoteFocus(noteId: string): NoteFocusRequest | null {
  if (pending && now() - pending.at > NOTE_FOCUS_TTL_MS) pending = null;
  if (!pending || pending.noteId !== noteId) return null;
  const request = strip(pending);
  pending = null;
  return request;
}

/** The live request, if any (tests). */
export function pendingNoteFocus(): NoteFocusRequest | null {
  if (pending && now() - pending.at > NOTE_FOCUS_TTL_MS) pending = null;
  return pending ? strip(pending) : null;
}

export function clearNoteFocus(): void {
  pending = null;
}

/** Calls back on each new request. */
export function subscribeNoteFocus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
