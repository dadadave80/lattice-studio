/**
 * A field's edit cycle (spec L466): typing keeps a draft, Enter or blur commits it, Esc reverts to what's stored.
 * `commit` returns an error to keep on the field (the draft stays) or null once the value went to the document.
 */
import { useState, type FocusEvent, type KeyboardEvent } from "react";
import type { Arg } from "@lattice-studio/core";
import { commandRef, runCommand } from "@/contracts";

export type Draft = {
  /** What the input shows: the draft while editing, else the stored text. */
  text: string;
  editing: boolean;
  error: string | null;
  busy: boolean;
  change(text: string): void;
  commit(): Promise<void>;
  revert(): void;
  onKeyDown(event: KeyboardEvent<HTMLElement>): void;
  /** Commits when focus leaves `event.currentTarget` (the field's wrapper), not when it moves inside it. */
  onBlur(event: FocusEvent<HTMLElement>): void;
};

export function useDraft(stored: string, commitText: (text: string) => Promise<string | null> | string | null): Draft {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const commit = async (): Promise<void> => {
    if (draft === null) return;
    if (draft === stored) {
      setDraft(null);
      setError(null);
      return;
    }
    setBusy(true);
    const failed = await commitText(draft);
    setBusy(false);
    setError(failed);
    if (failed === null) setDraft(null);
  };
  const revert = () => {
    setDraft(null);
    setError(null);
  };
  return {
    text: draft ?? stored,
    editing: draft !== null,
    error,
    busy,
    change(text) {
      setDraft(text);
      setError(null);
    },
    commit,
    revert,
    onKeyDown(event) {
      if (event.key === "Enter" && !event.altKey && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        void commit();
      } else if (event.key === "Escape" && (draft !== null || error !== null)) {
        // Esc reverts the field; with nothing to revert it passes on (closes the pane's mode, clears the selection).
        event.preventDefault();
        event.stopPropagation();
        revert();
      }
    },
    onBlur(event) {
      const next = event.relatedTarget;
      if (next instanceof Node && event.currentTarget.contains(next)) return;
      // The field's unit list opening (a portaled listbox) isn't leaving the field.
      if (next instanceof Element && next.closest("[role='listbox']")) return;
      void commit();
    },
  };
}

/** Stores `value` at the init path through S1's `init.setArg`: one undo step, "Set Governor quorum to 4%.". */
export async function setArg(path: string, value: Arg): Promise<string | null> {
  const outcome = await runCommand(commandRef("init.setArg", { path, value }), "button");
  return outcome.ok ? null : outcome.reason;
}
