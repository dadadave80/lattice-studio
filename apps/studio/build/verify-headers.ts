/**
 * Refuses a deploy whose CSP doesn't fit the page it would serve (spec L871-L877). The import map lists every
 * chunk's integrity, so its hash moves with any code change; a stale `vercel.json` would block the import map
 * (and so SRI) or the critical CSS. Vercel's build command runs this after the build:
 *
 *   bun apps/studio/build/verify-headers.ts <dist> <vercel.json>
 *
 * With a folder only, it checks an IPFS build's `<meta>` instead. Exits 1 with the difference and the fix.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cspMismatch, cspOf, metaCspOf, type VercelConfig } from "./headers.ts";

export type Verdict = { ok: true; text: string } | { ok: false; text: string };

export function verifyVercel(html: string, config: Pick<VercelConfig, "headers">): Verdict {
  const mismatch = cspMismatch(html, cspOf(config), { frameAncestors: true });
  if (!mismatch) return { ok: true, text: "vercel.json's CSP matches the built index.html." };
  return {
    ok: false,
    text: `${mismatch}\nRebuild with STUDIO_VERCEL_JSON=1 bun run build and commit apps/studio/vercel.json.`,
  };
}

export function verifyIpfs(html: string): Verdict {
  const mismatch = cspMismatch(html, metaCspOf(html), { frameAncestors: false });
  if (!mismatch) return { ok: true, text: "index.html's CSP <meta> matches its inline scripts and styles." };
  return { ok: false, text: `${mismatch}\nRebuild with bun run build --mode ipfs.` };
}

function main(args: string[]): number {
  const [dist = "dist", vercelJson] = args;
  const htmlFile = join(dist, "index.html");
  if (!existsSync(htmlFile)) {
    console.error(`${htmlFile} doesn't exist: run the build first.`);
    return 1;
  }
  const html = readFileSync(htmlFile, "utf8");
  const verdict = vercelJson
    ? verifyVercel(html, JSON.parse(readFileSync(vercelJson, "utf8")) as VercelConfig)
    : verifyIpfs(html);
  (verdict.ok ? console.log : console.error)(verdict.text);
  return verdict.ok ? 0 : 1;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
