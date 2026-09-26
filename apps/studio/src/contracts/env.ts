/**
 * Build flags (contracts §5.5). Read them here, never from `import.meta.env` directly, so a module has one
 * place to look. Vite replaces each `import.meta.env.X` with a literal at build time; under `bun test`,
 * `import.meta.env` is the process environment, so `dev` reads false there.
 *
 * Keep e2e-only code (the Anvil chain, wagmi's `mock` connector) behind a dynamic `import()` guarded by
 * `env.e2e`, so a production build never fetches it.
 */
import { isE2EFlag } from "./e2e-flag";

export const env: {
  /**
   * `VITE_STUDIO_E2E` set to any non-empty value: the Anvil chain (31337) and wagmi's `mock` connector.
   * Only `--mode e2e` builds may set it (`vite.config.ts`'s guard reads it the same way).
   */
  readonly e2e: boolean;
  /** A dev server: enables the `#/__ui` primitives gallery. */
  readonly dev: boolean;
  /** Vitest (`mode === "test"`): modules skip registering real browser-storage services; CCR from S7a. */
  readonly test: boolean;
  /** The IPFS build (`--mode ipfs`, relative base): routes live in the hash; CCR from S11a. */
  readonly hashRouting: boolean;
  /** `VITE_WALLETCONNECT_PROJECT_ID`: WalletConnect Cloud's public project id; unset, "Other wallets (QR)" says it isn't set up (CCR from FX34). */
  readonly walletConnectProjectId: string | undefined;
} = {
  e2e: isE2EFlag(import.meta.env.VITE_STUDIO_E2E),
  dev: import.meta.env.DEV === true,
  test: import.meta.env.MODE === "test",
  hashRouting: import.meta.env.MODE === "ipfs",
  walletConnectProjectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || undefined,
};
