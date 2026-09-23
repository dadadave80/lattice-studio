/**
 * @internal For the docs module's own browser tests only, never imported by production code (mirrors
 * `contracts/test-support.ts`): sets and clears `navigation.ts`'s "has the user interacted" signal, so a
 * test can put a doc view in either state before asserting whether it moves focus.
 */
import { setUserInteractedForTest } from "./navigation";

/** Simulates an interaction having already happened, for a test that isn't itself about it. */
export function markUserInteractedForTest(): void {
  setUserInteractedForTest(true);
}

/** Back to "nothing has happened yet", for a test of the restored-on-load case. */
export function resetUserInteractionForTest(): void {
  setUserInteractedForTest(false);
}
