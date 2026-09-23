/**
 * The few words S8c's commands need, apart from the engine's (`copy.ts`). The commands sit in the entry chunk, and a
 * module shared with a lazy chunk lands there whole, so nothing here imports the engine's copy or the chain module's
 * (whose money formatting would come along). Light.
 */

/** Flow 12 step 5 (the same words as the chain module's `CANCELED_IN_WALLET`). */
export const CANCELED_IN_WALLET = "You canceled in your wallet.";

/** Flow 14: Deploy disabled offline. */
export const DEPLOY_NEEDS_CONNECTION = "Deploy needs a connection.";

/** Show deploy progress before the review (S8b) registers its dialog. */
export const DEPLOY_NOT_BUILT = "Not built yet · WP-S8b";

/** Spec L575: the RPC can't simulate at all. The review asks for one more tick before signing. */
export function cantSimulate(chain: string): string {
  return `${chain}'s RPC can't simulate this deploy. Signing without a simulation needs one more tick.`;
}

/** Sign & deploy's reason when the machine gave no chain name with it. */
export const CANT_SIMULATE_HERE = "This chain's RPC can't simulate this deploy. Signing without a simulation needs one more tick.";
