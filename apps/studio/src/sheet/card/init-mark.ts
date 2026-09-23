/**
 * The init badge slot (IR L103: "init badge in init mode"). Init order mode is S4d's: it knows each facet's
 * step and draws the badge (dragged to reorder step inits, spec L56), and cards without a step dim to 35%.
 * The card only gives it a place in the header and applies the dimming.
 *
 * S4d calls `provideInitMark(hook)` at module evaluation (in its `services.ts`), before the first render, the
 * same way `provideSheetInteractions` works. The hook runs inside every card, so it must read narrowly.
 */
import type { ReactNode } from "react";

export type InitMark = {
  /** Shown after the card's name; null for none. */
  badge: ReactNode;
  /** Init order mode is on and this facet has no step. */
  dimmed: boolean;
};

const NONE: InitMark = { badge: null, dimmed: false };

function useNoInitMark(): InitMark {
  return NONE;
}

let useMark: (facet: string) => InitMark = useNoInitMark;

/** S4d provides the init badge for every card. Returns a disposer. */
export function provideInitMark(hook: (facet: string) => InitMark): () => void {
  const previous = useMark;
  useMark = hook;
  return () => {
    if (useMark === hook) useMark = previous;
  };
}

/** A hook: the card's init badge and dimming. */
export function useInitMark(facet: string): InitMark {
  return useMark(facet);
}
