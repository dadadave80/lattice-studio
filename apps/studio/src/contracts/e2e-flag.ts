/**
 * What `VITE_STUDIO_E2E` means, in one place: any non-empty value turns end-to-end mode on. `env.e2e` in the
 * app and the build guard in `vite.config.ts` both read the flag through this function, so they always agree.
 * Leaf module: no imports, safe for the Vite config.
 */
export function isE2EFlag(value: string | undefined): boolean {
  return value !== undefined && value !== "";
}
