/**
 * Which hosting a build targets (spec L834-L837). `vite build` makes the Vercel build: absolute base, CSP and
 * security headers sent by Vercel from `vercel.json`. `vite build --mode ipfs` (run as `bun run build --mode ipfs`)
 * makes the IPFS mirror: `base: './'` so it works under any stable origin (an ENS name through eth.limo, or
 * DNSLink), hash routing, and the CSP as a `<meta>` tag, which can't carry `frame-ancestors`.
 */
import type { ConfigEnv } from "vite";

export type BuildVariant = "vercel" | "ipfs";

export function buildVariant(env: Pick<ConfigEnv, "mode">): BuildVariant {
  return env.mode === "ipfs" ? "ipfs" : "vercel";
}

/** Vitest loads the app's Vite config too; the build plugins stay out of it (notes from K2). */
export function isTestMode(env: Pick<ConfigEnv, "mode">): boolean {
  return env.mode === "test";
}
