import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cspMismatch, cspOf, inlineAttributeProblems, type BuildOutputConfig } from "../../apps/studio/build/headers.ts";
import { writeBuildOutput } from "../../apps/studio/build/vercel-output.ts";

/** Check the packaged artifact while leaving the authoritative production dist available to other checks. */
export function verifyDeploymentOutput(dist: string): void {
  const html = readFileSync(join(dist, "index.html"), "utf8");
  const unsupported = inlineAttributeProblems(html);
  if (unsupported.length) throw new Error(unsupported.join("\n"));
  const scratch = mkdtempSync(join(tmpdir(), "studio-deployment-output-"));
  try {
    const copy = join(scratch, "dist");
    const output = join(scratch, "output");
    cpSync(dist, copy, { recursive: true });
    writeBuildOutput(copy, output);
    const page = readFileSync(join(output, "static", "index.html"), "utf8");
    const config = JSON.parse(readFileSync(join(output, "config.json"), "utf8")) as BuildOutputConfig;
    if (config.version !== 3 || page !== html) throw new Error("Build Output must preserve the built page and use version 3.");
    const mismatch = cspMismatch(page, cspOf(config), { frameAncestors: true });
    if (mismatch) throw new Error(mismatch);
    const first = config.routes[0];
    if (!first || !("headers" in first) || first.src !== "^/(.*)$" || first.continue !== true) {
      throw new Error("Security headers must run before terminal routes.");
    }
    if (first.headers["Cross-Origin-Opener-Policy"] !== "same-origin-allow-popups" || first.headers["X-Content-Type-Options"] !== "nosniff") {
      throw new Error("Build Output is missing its browser security headers.");
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const dist = process.argv[2] ?? join(import.meta.dir, "..", "..", "apps", "studio", "dist");
  try {
    verifyDeploymentOutput(dist);
    console.log(`Deployment output verified from ${dist}; production files were preserved.`);
  } catch (error) {
    console.error(`Deployment output verification failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
