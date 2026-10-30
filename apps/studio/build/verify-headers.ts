/**
 * Refuses an IPFS build whose CSP `<meta>` doesn't fit the page (spec L871-L877), which would block the import map
 * (and so SRI) or the critical CSS:
 *
 *   bun apps/studio/build/verify-headers.ts <dist>
 *
 * Exits 1 with the difference and the fix.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cspMismatch, metaCspOf } from "./headers.ts";

export type Verdict = { ok: true; text: string } | { ok: false; text: string };

export function verifyIpfs(html: string): Verdict {
  const mismatch = cspMismatch(html, metaCspOf(html), { frameAncestors: false });
  if (!mismatch) return { ok: true, text: "index.html's CSP <meta> matches its inline scripts and styles." };
  return { ok: false, text: `${mismatch}\nRebuild with bun run build --mode ipfs.` };
}

function main(args: string[]): number {
  const [dist = "dist"] = args;
  const htmlFile = join(dist, "index.html");
  if (!existsSync(htmlFile)) {
    console.error(`${htmlFile} doesn't exist: run the build first.`);
    return 1;
  }
  const verdict = verifyIpfs(readFileSync(htmlFile, "utf8"));
  (verdict.ok ? console.log : console.error)(verdict.text);
  return verdict.ok ? 0 : 1;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
