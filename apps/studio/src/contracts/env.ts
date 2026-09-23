/**
 * Build flags (contracts §5.5). Read them here, never from `import.meta.env` directly, so a module has one
 * place to look. Vite replaces each `import.meta.env.X` with a literal at build time; under `bun test`,
 * `import.meta.env` is the process environment, so `dev` reads false there.
 *
 * Keep e2e-only code (the Anvil chain, wagmi's `mock` connector) behind a dynamic `import()` guarded by
 * `env.e2e`, so a production build never fetches it.
 */
export const env: {
  /** `VITE_STUDIO_E2E=1`: the Anvil chain (31337) and wagmi's `mock` connector. Production builds refuse it. */
  readonly e2e: boolean;
  /** A dev server: enables the `#/__ui` primitives gallery. */
  readonly dev: boolean;
} = {
  e2e: import.meta.env.VITE_STUDIO_E2E === "1",
  dev: import.meta.env.DEV === true,
};
