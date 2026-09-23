/**
 * The CSP and hosting headers (spec L862-L880, L834-L837), as pure functions over the built `index.html`.
 * `csp.ts` runs them at build time; `verify-headers.ts` and the tests run them again over `dist/`.
 *
 * The policy allows no `unsafe-inline` and no `unsafe-eval`. Every inline `<script>` (the SRI import map, and
 * any first-paint script) and every inline `<style>` (the critical CSS) is allowed by its SHA-256 hash, so the
 * hashes must be computed from the final HTML, after vite-plugin-sri-gen has written the import map.
 */
import { createHash } from "node:crypto";
import { isE2EFlag } from "../src/contracts/e2e-flag.ts";

export type InlineHashes = {
  /** `sha256-…` of each inline script's text, in document order, without repeats. */
  scripts: string[];
  /** `sha256-…` of each inline style's text, in document order, without repeats. */
  styles: string[];
};

/** `sha256-<base64>` of `text` as UTF-8: the CSP hash source for an inline element with exactly this text. */
export function cspHash(text: string): string {
  return `sha256-${createHash("sha256").update(text, "utf8").digest("base64")}`;
}

const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const STYLE = /<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi;

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** The hashes of every inline script (no `src`) and inline style in `html`. */
export function inlineHashes(html: string): InlineHashes {
  const scripts: string[] = [];
  for (const [, attrs = "", body = ""] of html.matchAll(SCRIPT)) {
    if (/\ssrc\s*=/i.test(` ${attrs}`)) continue;
    scripts.push(cspHash(body));
  }
  const styles: string[] = [];
  for (const [, , body = ""] of html.matchAll(STYLE)) styles.push(cspHash(body));
  return { scripts: unique(scripts), styles: unique(styles) };
}

/**
 * Markup a hash can't allow: inline event handlers (`onload=`) and `style` attributes need `'unsafe-hashes'`,
 * which the policy doesn't grant, so the browser would drop them. Returns one line per offender.
 */
export function inlineAttributeProblems(html: string): string[] {
  const markup = html.replace(SCRIPT, "<script></script>").replace(STYLE, "<style></style>");
  const problems: string[] = [];
  for (const [tag = ""] of markup.matchAll(/<[a-z][^>]*>/gi)) {
    const attr = /\s(on[a-z]+|style)\s*=/i.exec(tag);
    if (attr) problems.push(`${tag.slice(0, 80)} has a ${attr[1]} attribute`);
  }
  return problems;
}

/** The WalletConnect verify and auth frames (spec L873). */
const FRAME_SOURCES = "https://verify.walletconnect.org https://secure.walletconnect.org";

/** The local Anvil nodes an end-to-end build's page talks to (contracts §5.5). Loopback only. */
export const E2E_CONNECT_SOURCE = "http://127.0.0.1:*";

/**
 * Whether this process builds or serves the end-to-end build: `VITE_STUDIO_E2E` is set. `vite.config.ts`'s guard
 * refuses a build with the flag in any mode but `e2e`, so a production (Vercel) or IPFS build never gets here.
 */
export function isE2EBuild(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return isE2EFlag(env.VITE_STUDIO_E2E);
}

export type PolicyOptions = {
  /** Off for the IPFS `<meta>`, which can't carry `frame-ancestors`. */
  frameAncestors: boolean;
  /** The end-to-end build: `connect-src` also allows `E2E_CONNECT_SOURCE`. Default: `isE2EBuild()`. */
  e2e?: boolean;
};

/**
 * The policy of spec L871-L875, with the page's hashes. `frameAncestors: false` for the IPFS `<meta>`, which
 * can't carry `frame-ancestors` (browsers ignore it there). In `--mode e2e` only, `connect-src` also allows the
 * loopback Anvil nodes the end-to-end tests start (Q0).
 */
export function contentSecurityPolicy(hashes: InlineHashes, options: PolicyOptions): string {
  const e2e = options.e2e ?? isE2EBuild();
  const sources = (list: string[]) => list.map((h) => ` '${h}'`).join("");
  const directives = [
    "default-src 'self'",
    `script-src 'self'${sources(hashes.scripts)}`,
    `style-src 'self'${sources(hashes.styles)}`,
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    `connect-src 'self' https: wss:${e2e ? ` ${E2E_CONNECT_SOURCE}` : ""}`,
    `frame-src ${FRAME_SOURCES}`,
  ];
  if (options.frameAncestors) directives.push("frame-ancestors 'none'");
  return directives.join("; ");
}

/** Keeps wallet popups working (spec L877). */
export const CROSS_ORIGIN_OPENER_POLICY = "same-origin-allow-popups";

/** Hashed assets never change; everything else revalidates (spec L836). */
export const IMMUTABLE = "public, max-age=31536000, immutable";
export const REVALIDATE = "no-cache";

export type Header = { key: string; value: string };

/** The security headers every response carries on Vercel. */
export function securityHeaders(csp: string): Header[] {
  return [
    { key: "Content-Security-Policy", value: csp },
    { key: "Cross-Origin-Opener-Policy", value: CROSS_ORIGIN_OPENER_POLICY },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  ];
}

export type VercelConfig = {
  $schema: string;
  framework: null;
  installCommand: string;
  buildCommand: string;
  outputDirectory: string;
  trailingSlash: boolean;
  rewrites: { source: string; destination: string }[];
  headers: { source: string; headers: Header[] }[];
};

/**
 * The whole of `apps/studio/vercel.json` (the Vercel project's root directory is `apps/studio`). The build
 * command rebuilds, carries the previous release's hashed chunks (spec L831) and refuses to deploy when this
 * file's CSP doesn't match the rebuilt `index.html`.
 */
export function vercelConfig(csp: string): VercelConfig {
  return {
    $schema: "https://openapi.vercel.sh/vercel.json",
    framework: null,
    installCommand: "cd ../.. && bun install --frozen-lockfile",
    buildCommand:
      "cd ../.. && bun run build" +
      " && bun apps/studio/build/carry-previous.ts --out apps/studio/dist --from \"$STUDIO_PREVIOUS_RELEASE\"" +
      " && bun apps/studio/build/verify-headers.ts apps/studio/dist apps/studio/vercel.json",
    outputDirectory: "dist",
    trailingSlash: false,
    // Files win over rewrites on Vercel. Missing assets, catalog files and schemas stay 404s, never index.html.
    rewrites: [{ source: "/((?!assets/|catalog/|schema/|icons/).*)", destination: "/index.html" }],
    headers: [
      { source: "/(.*)", headers: securityHeaders(csp) },
      { source: "/assets/(.*)", headers: [{ key: "Cache-Control", value: IMMUTABLE }] },
      { source: "/((?!assets/).*)", headers: [{ key: "Cache-Control", value: REVALIDATE }] },
    ],
  };
}

/** `vercel.json` as written: two-space JSON and a final newline, so rebuilding the same commit changes nothing. */
export function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** The CSP a `vercel.json` sends on every path, or null. */
export function cspOf(config: Pick<VercelConfig, "headers">): string | null {
  const all = config.headers.find((h) => h.source === "/(.*)");
  return all?.headers.find((h) => h.key === "Content-Security-Policy")?.value ?? null;
}

const META_CSP = /<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>\s*/i;

/**
 * Puts the policy in a `<meta>` at the top of `<head>` (after the charset), before anything it governs. An
 * existing CSP meta is replaced.
 */
export function injectCspMeta(html: string, csp: string): string {
  const tag = `<meta http-equiv="Content-Security-Policy" content="${csp.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}">`;
  const clean = html.replace(META_CSP, "");
  const charset = /<meta\s+charset=[^>]*>/i.exec(clean);
  if (charset) {
    const at = charset.index + charset[0].length;
    return `${clean.slice(0, at)}\n    ${tag}${clean.slice(at)}`;
  }
  const head = /<head[^>]*>/i.exec(clean);
  if (!head) throw new Error("index.html has no <head>, so the CSP <meta> has nowhere to go.");
  const at = head.index + head[0].length;
  return `${clean.slice(0, at)}\n    ${tag}${clean.slice(at)}`;
}

/** The policy in `html`'s CSP `<meta>`, or null. */
export function metaCspOf(html: string): string | null {
  const tag = META_CSP.exec(html)?.[0];
  const content = tag && /content="([^"]*)"/i.exec(tag)?.[1];
  return content ? content.replaceAll("&quot;", '"').replaceAll("&amp;", "&") : null;
}

/** Recomputes the policy from the built page; null when `sent` matches, else why not. */
export function cspMismatch(html: string, sent: string | null, options: PolicyOptions): string | null {
  const expected = contentSecurityPolicy(inlineHashes(html), options);
  if (sent === null) return "No Content-Security-Policy is set.";
  if (sent === expected) return null;
  return `The Content-Security-Policy doesn't match the built index.html.\n  sent:     ${sent}\n  expected: ${expected}`;
}
