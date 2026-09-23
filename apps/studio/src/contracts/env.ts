/**
 * Build flags (contracts §5.5). Read them here, never from `import.meta.env` directly, so a module has one
 * place to look. Under `bun test` `import.meta.env` is the process environment, so both read false.
 */
const viteEnv: Partial<ImportMetaEnv> = import.meta.env ?? {};

export const env: {
  /** `VITE_STUDIO_E2E=1`: the Anvil chain (31337) and wagmi's `mock` connector. Production builds refuse it. */
  readonly e2e: boolean;
  /** A dev server: enables the `#/__ui` primitives gallery. */
  readonly dev: boolean;
} = {
  e2e: viteEnv.VITE_STUDIO_E2E === "1",
  dev: viteEnv.DEV === true,
};
