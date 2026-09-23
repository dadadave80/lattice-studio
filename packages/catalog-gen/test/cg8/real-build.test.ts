/**
 * Integration: `bun run catalog`'s pipeline against the pinned Lattice reproduces the committed catalog byte for
 * byte (which is what `verify.ts` checks, here on the checkout itself rather than a clean copy, to stay inside the
 * merge gate's time). Runs in a checkout this run owns (CG1's `realBuildGate`); skipped otherwise, and in the
 * main checkout's read-only `lattice/`. The build is incremental: seconds when `out/` is current, about two
 * minutes from nothing.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { studioEnv } from "../../src/anvil";
import { CATALOG_DIR, generateCatalog } from "../../src/main";
import { compareWithCommitted, formatVerifyReport } from "../../src/verify";
import { realBuildGate } from "../cg1/real-build-gate";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");
const gate = realBuildGate((name) => studioEnv(name, REPO_ROOT), REPO_ROOT, (bin) => Bun.which(bin));
const BUILD_TIMEOUT_MS = 15 * 60_000;

const title = "bun run catalog against the pinned Lattice";
describe.skipIf(!gate.run)(gate.run ? title : `${title} (skipped: ${gate.reason})`, () => {
  test(
    "reproduces the committed catalog byte for byte, provisional at 0.2.0",
    async () => {
      const generated = await generateCatalog({ latticeDir: gate.latticeDir });
      if (!generated.ok) throw new Error(generated.error);
      const report = await compareWithCommitted(CATALOG_DIR, generated.value);
      expect(formatVerifyReport(report)).toBe(`Catalog ${generated.value.id} matches the rebuild byte for byte · hash ${report.hash}.`);
      expect(generated.value.assembled.catalog.provisional).toBe("Lattice 0.2.0 at dev f4a32c8; v1 targets 0.4.0");
      expect(generated.value.summary.join("\n")).toContain("Overlay lint: 0 errors");
    },
    BUILD_TIMEOUT_MS,
  );
});
