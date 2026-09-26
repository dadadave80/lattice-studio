/**
 * Whether the tour is running and which of its five coach marks (spec L400, Flow 1) is showing. Not part of
 * the session store (contracts §5.1 doesn't carry a tour field): the tour is a transient, single-purpose
 * overlay, never persisted and never undoable. `settings/commands.ts` starts and ends it (`tour.start`,
 * `tour.end`); `Tour.tsx` reads and steps it.
 */
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";

export type TourState = { running: boolean; step: number };

const store: StoreApi<TourState> = createStore<TourState>(() => ({ running: false, step: 0 }));

/** Starts the tour at its first coach mark. */
export function startTour(): void {
  store.setState({ running: true, step: 0 });
}

/** Ends the tour at any step (Esc, End tour, or the last step's Done). */
export function endTour(): void {
  store.setState({ running: false, step: 0 });
}

/** Moves to a step; out-of-range steps are left to the caller (`Tour.tsx` clamps to the step count). */
export function setTourStep(step: number): void {
  store.setState({ step });
}

/** Non-reactive read, for `settings/commands.ts`'s `enabled()`. */
export function tourState(): TourState {
  return store.getState();
}

/** A hook: re-renders when the selected slice changes. */
export function useTourState<T>(selector: (state: TourState) => T): T {
  return useStore(store, selector);
}

/** @internal Resets the tour (tests). */
export function resetTour(): void {
  store.setState({ running: false, step: 0 });
}
