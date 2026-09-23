/**
 * Per-test overrides of registrations, undone after the test (or by calling the returned disposer).
 * Free of Vitest imports, so `bun test` can use them too.
 */
import type { Command, DeployState } from "@/contracts";
import { overrideCommands as override, snapshotCommands } from "@/contracts/commands";
import { seedDeployState as seed } from "@/contracts/deploy";
import { onCleanup } from "./cleanup";

/** Replaces commands (placeholders or real ones) for this test. */
export function overrideCommands(commands: readonly Command[]): () => void {
  const dispose = override(commands);
  onCleanup(dispose);
  return dispose;
}

/** Starts this test from a registry of placeholders only; the real registrations come back afterwards. */
export function pristineCommands(): () => void {
  const restore = snapshotCommands({ pristine: true });
  onCleanup(restore);
  return restore;
}

/** Sets what `useDeployState` and `deployState()` read, without loading a controller. */
export function seedDeployState(state: DeployState): () => void {
  const dispose = seed(state);
  onCleanup(dispose);
  return dispose;
}
