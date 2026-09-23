/**
 * End-to-end builds only (contracts §5.5): wagmi's `mock` connector with Anvil's first default account, which
 * Anvil signs for when a transaction is sent unsigned. Loaded through `import()` behind `env.e2e`, so a
 * production build never fetches it.
 */
import { mock, type CreateConnectorFn } from "@wagmi/core";

/** Anvil's default account 0 (its well-known test mnemonic). */
export const ANVIL_ACCOUNT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as const;

export function e2eConnectors(): CreateConnectorFn[] {
  return [mock({ accounts: [ANVIL_ACCOUNT], features: { reconnect: true } })];
}
