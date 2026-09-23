/**
 * The CSP plugin (spec L862-L880). K2 ships this pass-through stub so `vite.config.ts` can freeze;
 * S11a replaces the body: hash the one inline style and the SRI import map, write the CSP into
 * `vercel.json` headers and, for the IPFS build, a `<meta>`. A plugin may set `base` and `build.outDir`
 * through its own `config` hook, so the IPFS variant needs no change to `vite.config.ts`.
 */
import type { ConfigEnv, PluginOption } from "vite";

export function studioCsp(_env: ConfigEnv): PluginOption[] {
  return [];
}
