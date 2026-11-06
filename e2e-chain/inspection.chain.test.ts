/** Keep deployed-diamond chain proofs in the normal Foundry CI gate. Each owns a separate port offset. */
import { announceSkip, anvilPort, SKIP_REASON } from "./harness/env";

announceSkip("deployed diamond workflows", SKIP_REASON);
if (SKIP_REASON === undefined) {
  process.env.ANVIL_PORT_BASE ??= String(anvilPort(0));
  // These sources are typechecked by the app, whose alias map differs from the chain harness's.
  for (const suite of ["reads", "transaction", "history", "upgrade-runtime"]) {
    await import(`../apps/studio/src/chain/inspect/${suite}.anvil.test`);
  }
}
