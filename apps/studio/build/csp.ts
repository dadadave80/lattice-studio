/**
 * The CSP plugin (spec L862-L880, L834-L837). After the bundle is written, and so after vite-plugin-sri-gen has
 * put its import map into `index.html`, it hashes every inline script and style of the built page and:
 *
 * - IPFS build (`--mode ipfs`): sets `base: './'` and writes the policy into `index.html` as a `<meta>`, without
 *   `frame-ancestors`, which a `<meta>` can't carry.
 * - Vercel build: the policy is a header. The import map lists every chunk's integrity, so its hash changes with
 *   any code change; `vercel-output.ts`, the last step of Vercel's build command, writes the header from the
 *   finished page. Here the build only refuses markup a hash can't allow.
 *
 * `vite preview` sends the same headers, so a preview behaves like the host. The plugin runs before
 * vite-plugin-pwa writes `sw.js` (in `closeBundle`), so the precached `index.html` is the final one.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, type ConfigEnv, type Plugin, type PluginOption, type ResolvedConfig } from "vite";
import { isE2EFlag } from "../src/contracts/e2e-flag.ts";
import { contentSecurityPolicy, inlineAttributeProblems, inlineHashes, injectCspMeta, securityHeaders } from "./headers.ts";
import { buildVariant, isTestMode, type BuildVariant } from "./variant.ts";

/** `apps/studio/`, where the mode's `.env` files live. */
const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Whether this is the end-to-end build (contracts §5.5): `--mode e2e` with `VITE_STUDIO_E2E` set. Only then does
 * `connect-src` also allow the loopback Anvil nodes the end-to-end tests start (Q0). `vite.config.ts`'s guard
 * refuses the flag in any other build mode, and this checks the mode as well.
 */
export function isE2EBuild(env: Pick<ConfigEnv, "mode">, flag: string | undefined): boolean {
  return env.mode === "e2e" && isE2EFlag(flag);
}

export type SecureOptions = {
  /** The end-to-end build (`isE2EBuild`). Default false. */
  e2e?: boolean;
};

/** What the build does to a finished `index.html`: the policy, and the page to write back (IPFS only). */
export function secureHtml(html: string, variant: BuildVariant, options: SecureOptions = {}): { csp: string; html: string } {
  const e2e = options.e2e ?? false;
  const problems = inlineAttributeProblems(html);
  if (problems.length) {
    throw new Error(
      `index.html has markup the CSP can't allow by hash (spec L876):\n  ${problems.join("\n  ")}\n` +
        "Move inline styles into the critical <style> block and handlers into modules.",
    );
  }
  const hashes = inlineHashes(html);
  if (variant === "ipfs") {
    const csp = contentSecurityPolicy(hashes, { frameAncestors: false, e2e });
    return { csp, html: injectCspMeta(html, csp) };
  }
  return { csp: contentSecurityPolicy(hashes, { frameAncestors: true, e2e }), html };
}

export function studioCsp(env: ConfigEnv): PluginOption[] {
  if (isTestMode(env)) return [];
  const variant = buildVariant(env);
  // The flag as the config reads it: `.env` files for the mode, then the process (Vite's loadEnv covers both).
  const e2e = isE2EBuild(env, loadEnv(env.mode, APP_DIR, "VITE_").VITE_STUDIO_E2E);
  let config: ResolvedConfig | undefined;
  const outDir = () => (config ? resolve(config.root, config.build.outDir) : resolve("dist"));

  const plugin: Plugin = {
    name: "lattice-studio:csp",
    config: () => (variant === "ipfs" ? { base: "./" } : undefined),
    configResolved(resolved) {
      config = resolved;
    },
    writeBundle: {
      order: "post",
      sequential: true,
      handler() {
        const file = join(outDir(), "index.html");
        if (!existsSync(file)) return;
        const built = secureHtml(readFileSync(file, "utf8"), variant, { e2e });
        if (variant === "ipfs") writeFileSync(file, built.html);
      },
    },
    configurePreviewServer(server) {
      server.middlewares.use((_req, res, next) => {
        const file = join(outDir(), "index.html");
        if (existsSync(file)) {
          const { csp } = secureHtml(readFileSync(file, "utf8"), variant, { e2e });
          const headers = variant === "ipfs" ? [] : securityHeaders(csp);
          for (const { key, value } of headers) res.setHeader(key, value);
        }
        next();
      });
    },
  };
  return [plugin];
}
