/**
 * `verify-catalog --lattice <path>` (spec L849, L921): rebuilds the catalog from a Lattice checkout with CG8's
 * verifier and compares it with the committed one (`--catalog <dir>`, default `./catalog`), then checks that
 * the catalog bundled into this CLI has the rebuilt hash too. Exit 0 match, 2 the rebuild couldn't run, 3
 * mismatch.
 *
 * It runs under Bun from a Lattice Studio checkout: catalog-gen drives Foundry through `Bun.spawn`, reads the
 * overlay with `Bun.YAML` and finds `overlay/` beside its own sources. catalog-gen is imported only here, and
 * lazily, so the other commands run under Node without it.
 */
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { Parsed } from "../args";
import { bundledCatalogs, BUNDLED_CATALOG_ID } from "../catalogs";
import type { Deps } from "../deps";
import { EXIT, type Failure, invalid } from "../failure";
import { fail, note, writeJson, writeLines } from "../output";

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function runVerifyCatalog(parsed: Parsed, deps: Deps): Promise<number> {
  const { values } = parsed;
  const json = values.json === true;
  if (parsed.args.length > 0) return fail(deps, json, invalid("verify-catalog takes no file. Pass the checkout with --lattice <dir>."));
  if (!deps.hasBun) {
    return fail(
      deps,
      json,
      invalid(
        "verify-catalog runs under Bun from a Lattice Studio checkout: it rebuilds the catalog with Foundry and the checkout's overlay/. " +
          "Run bun packages/cli/src/main.ts verify-catalog --lattice <dir> there.",
      ),
    );
  }
  if (values.lattice === undefined) return fail(deps, json, invalid("verify-catalog needs --lattice <dir>: the Lattice checkout at the catalog's tag."));
  const latticeDir = resolve(deps.cwd, values.lattice);
  if (!(await isDirectory(latticeDir))) return fail(deps, json, invalid(`--lattice ${values.lattice} isn't a directory.`));
  const catalogDir = resolve(deps.cwd, values.catalog ?? "catalog");
  if (!(await isDirectory(catalogDir))) {
    return fail(deps, json, invalid(`${catalogDir} isn't a directory. Run verify-catalog from the Lattice Studio checkout, or pass --catalog <dir>.`));
  }

  const { formatVerifyReport, verifyCatalog, verifyExitCode } = await import("@lattice-studio/catalog-gen/verify");
  const result = await verifyCatalog({
    latticeDir,
    catalogDir,
    log: (line) => note(deps, line),
    ...(deps.generate !== undefined ? { generate: deps.generate } : {}),
  });
  if (!result.ok) {
    const failure: Failure = invalid(`Couldn't rebuild the catalog to verify it. ${result.error}`);
    return fail(deps, json, failure);
  }
  const report = result.value;

  // The catalog this CLI checks against must be the rebuilt one too, when it's the same catalog id.
  const bundled = bundledCatalogs();
  const own = bundled.ok && report.id === BUNDLED_CATALOG_ID ? bundled.value.fallback.catalog.hash : undefined;
  const ownMatches = own === undefined || own.toLowerCase() === report.hash.toLowerCase();
  const exit = verifyExitCode(result) === EXIT.ok && !ownMatches ? EXIT.catalog : verifyExitCode(result);

  if (json) {
    writeJson(deps, { report, ...(own !== undefined ? { bundled: { id: BUNDLED_CATALOG_ID, hash: own, matches: ownMatches } } : {}) });
    return exit;
  }
  const lines = [formatVerifyReport(report)];
  if (own !== undefined) {
    lines.push(
      ownMatches
        ? `This CLI's bundled catalog ${BUNDLED_CATALOG_ID} has the rebuilt hash.`
        : `This CLI's bundled catalog ${BUNDLED_CATALOG_ID} has hash ${own}, not the rebuilt ${report.hash}. Rebuild the CLI (bun run --cwd packages/cli build).`,
    );
  }
  if (exit === EXIT.ok) writeLines(deps, lines);
  else deps.stderr(`${lines.join("\n")}\n`);
  return exit;
}
