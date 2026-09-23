#!/usr/bin/env bun
/**
 * The catalog verifier (spec L849 "independent roots", L921 `verify-catalog`): rebuilds the catalog from a
 * Lattice checkout and compares it with the committed one, file by file and by hash.
 *
 *   bun packages/catalog-gen/src/verify.ts [--lattice <dir>] [--catalog <dir>] [--in-place]
 *
 * The rebuild runs `generateCatalog` (the same pipeline as `bun run catalog`) in a temporary copy of the
 * checkout's tracked files, from a clean build, so nothing the checkout already built is trusted and nothing is
 * written into it. The rebuilt catalog is compared in memory with `catalog/<id>/` and its `manifest.json` entry,
 * where `<id>` follows from the checkout (its release tag, else `dev-<commit7>`).
 *
 * Exit codes follow the CLI's (spec L921): 0 the catalogs match, 2 the rebuild couldn't run (invalid input: no
 * checkout, the wrong Foundry, a failing build), 3 catalog mismatch. The CLI's `verify-catalog` reuses
 * `verifyCatalog` and `verifyExitCode`.
 */
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { err, type Hex, ok, type Result, validateCatalogManifest } from "@lattice-studio/core";
import { keccak256 } from "viem";
import { studioEnv } from "./anvil";
import { CATALOG_DIR, type GenerateOptions, type Generated, generateCatalog } from "./main";
import type { CatalogFile } from "./write";

export const EXIT_MATCH = 0;
export const EXIT_INVALID = 2;
export const EXIT_MISMATCH = 3;

/** One way the rebuilt catalog differs from the committed one. */
export type CatalogDifference = {
  /** Relative to `catalog/<id>/`, or `manifest.json` for the manifest's entry. */
  path: string;
  /**
   * `missing`: committed, not rebuilt. `extra`: rebuilt, not committed. `changed`: both, different bytes.
   * `unreadable`: the committed file can't be read or doesn't validate (only `manifest.json`), so nothing can be
   * compared with it.
   */
  problem: "missing" | "extra" | "changed" | "unreadable";
  /** Why a committed file is `unreadable`. */
  reason?: string;
  /** keccak256 of the committed and the rebuilt bytes, when there are both. */
  committed?: Hex;
  rebuilt?: Hex;
};

export type VerifyReport = {
  id: string;
  /** The rebuilt index's `hash`. */
  hash: Hex;
  /** The committed manifest's hash for `id`, if it lists one. */
  committedHash?: Hex;
  /** Sorted by path, `manifest.json` included; empty when the catalogs match byte for byte. */
  differences: CatalogDifference[];
  matches: boolean;
};

/** Every file under `dir`, keyed by its path relative to `dir` (forward slashes). An absent `dir` is empty. */
export async function readCatalogFiles(dir: string): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  let entries: string[];
  try {
    entries = await readdir(dir, { recursive: true });
  } catch {
    return out;
  }
  for (const entry of entries.sort()) {
    const path = entry.split("\\").join("/");
    try {
      out.set(path, new Uint8Array(await readFile(join(dir, entry))));
    } catch {
      // A directory: its files are listed on their own.
    }
  }
  return out;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Compares the committed files with the rebuilt ones, byte for byte. Pure. */
export function compareCatalogFiles(committed: ReadonlyMap<string, Uint8Array>, rebuilt: readonly CatalogFile[]): CatalogDifference[] {
  const differences: CatalogDifference[] = [];
  const seen = new Set<string>();
  for (const file of rebuilt) {
    seen.add(file.path);
    const before = committed.get(file.path);
    if (before === undefined) differences.push({ path: file.path, problem: "extra", rebuilt: keccak256(file.bytes) });
    else if (!sameBytes(before, file.bytes)) {
      differences.push({ path: file.path, problem: "changed", committed: keccak256(before), rebuilt: keccak256(file.bytes) });
    }
  }
  for (const [path, bytes] of committed) {
    if (!seen.has(path)) differences.push({ path, problem: "missing", committed: keccak256(bytes) });
  }
  return differences.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * The committed manifest's hash for `id`: `ok(undefined)` when the manifest doesn't list it (or doesn't exist, so
 * lists nothing), an error saying why when `manifest.json` can't be read or doesn't validate.
 */
async function manifestHash(catalogDir: string, id: string): Promise<Result<Hex | undefined, string>> {
  let text: string;
  try {
    text = await readFile(join(catalogDir, "manifest.json"), "utf8");
  } catch (e) {
    if (typeof e === "object" && e !== null && (e as { code?: unknown }).code === "ENOENT") return ok(undefined);
    return err(`it can't be read: ${e instanceof Error ? e.message : String(e)}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return err("it isn't JSON.");
  }
  const parsed = validateCatalogManifest(json);
  if (!parsed.ok) return err(`it doesn't match the manifest schema (${parsed.error.map((i) => `${i.path || "(root)"} ${i.message}`).join("; ")}).`);
  return ok(parsed.value.catalogs.find((c) => c.id === id)?.hash);
}

/** Compares a rebuilt catalog with `<catalogDir>/<id>/` and the manifest's entry for it. */
export async function compareWithCommitted(catalogDir: string, generated: Pick<Generated, "id" | "assembled">): Promise<VerifyReport> {
  const { id, assembled } = generated;
  const committed = await readCatalogFiles(join(catalogDir, id));
  const differences = compareCatalogFiles(committed, assembled.files);
  const hash = assembled.catalog.hash;
  const listed = await manifestHash(catalogDir, id);
  const committedHash = listed.ok ? listed.value : undefined;
  if (!listed.ok) {
    differences.push({ path: "manifest.json", problem: "unreadable", reason: listed.error, rebuilt: hash });
  } else if (committedHash !== hash) {
    // No entry for this id: the rebuilt catalog is one the manifest doesn't list ("extra").
    differences.push({ path: "manifest.json", problem: committedHash === undefined ? "extra" : "changed", ...(committedHash !== undefined ? { committed: committedHash } : {}), rebuilt: hash });
  }
  differences.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { id, hash, ...(committedHash !== undefined ? { committedHash } : {}), differences, matches: differences.length === 0 };
}

export type VerifyOptions = {
  latticeDir: string;
  /** Where the committed catalogs are (default `catalog/`). */
  catalogDir?: string;
  /**
   * Build incrementally in the checkout itself, trusting its `out/`, instead of clean in a fresh temporary copy.
   * The main checkout's `lattice/` is read-only, so it's copied either way (and so built from nothing).
   */
  inPlace?: boolean;
  log?: (line: string) => void;
  /** The generator; injectable for tests. */
  generate?: (options: GenerateOptions) => Promise<Result<Generated, string>>;
};

/**
 * Rebuilds the catalog from `latticeDir` and compares it with the committed one. An error means the rebuild
 * couldn't run at all; a report with differences means the catalogs don't match.
 */
export async function verifyCatalog(options: VerifyOptions): Promise<Result<VerifyReport, string>> {
  const generate = options.generate ?? generateCatalog;
  const generated = await generate({
    latticeDir: options.latticeDir,
    ...(options.inPlace === true ? {} : { copy: true, clean: true }),
    ...(options.log !== undefined ? { log: options.log } : {}),
  });
  if (!generated.ok) return err(generated.error);
  return ok(await compareWithCommitted(options.catalogDir ?? CATALOG_DIR, generated.value));
}

/** 0 when the catalogs match, 3 when they don't, 2 when the rebuild couldn't run. */
export function verifyExitCode(result: Result<VerifyReport, string>): number {
  if (!result.ok) return EXIT_INVALID;
  return result.value.matches ? EXIT_MATCH : EXIT_MISMATCH;
}

/** The verifier's report: one line when they match, else every difference. */
export function formatVerifyReport(report: VerifyReport): string {
  if (report.matches) return `Catalog ${report.id} matches the rebuild byte for byte · hash ${report.hash}.`;
  const lines = [
    `Catalog ${report.id} doesn't match the rebuild: ${report.differences.length} difference${report.differences.length === 1 ? "" : "s"}. ` +
      `Rebuilt hash ${report.hash}; committed ${report.committedHash ?? "none"}.`,
  ];
  for (const d of report.differences) {
    const hashes = [d.committed !== undefined ? `committed ${d.committed}` : "", d.rebuilt !== undefined ? `rebuilt ${d.rebuilt}` : ""].filter((x) => x !== "");
    const what =
      d.problem === "missing"
        ? "committed but not rebuilt"
        : d.problem === "extra"
          ? "rebuilt but not committed"
          : d.problem === "unreadable"
            ? `the committed file can't be compared: ${d.reason ?? "it's unreadable."}`
            : "differs";
    lines.push(`  ${d.path}: ${what}${hashes.length > 0 ? ` (${hashes.join(", ")})` : ""}`);
  }
  return lines.join("\n");
}

export type VerifyArgs = { latticeDir: string; catalogDir: string; inPlace: boolean; help: boolean };

export const VERIFY_USAGE = `Usage: bun packages/catalog-gen/src/verify.ts [--lattice <dir>] [--catalog <dir>] [--in-place]

Rebuilds the catalog from a Lattice checkout, in a clean temporary copy, and compares it with the committed one.
Exit codes: 0 match, 2 the rebuild couldn't run, 3 catalog mismatch.
  --lattice <dir>   the checkout (default: LATTICE_DIR, else lattice/)
  --catalog <dir>   the committed catalogs (default: catalog/)
  --in-place        build incrementally in the checkout itself, trusting its out/, instead of clean in a
                    fresh temporary copy (the main checkout's lattice/ is read-only, so it's copied either way)`;

/** Parses the verifier's command line. */
export function parseVerifyArgs(argv: readonly string[], root: string = join(import.meta.dir, "..", "..", "..")): Result<VerifyArgs, string> {
  const args: VerifyArgs = {
    latticeDir: studioEnv("LATTICE_DIR", root) ?? join(root, "lattice"),
    catalogDir: join(root, "catalog"),
    inPlace: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--in-place") args.inPlace = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--lattice" || a === "--catalog") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) return err(`${a} needs a directory.`);
      if (a === "--lattice") args.latticeDir = resolve(value);
      else args.catalogDir = resolve(value);
    } else return err(`Unknown argument ${a}.`);
  }
  return ok(args);
}

/** The verifier as a command; returns its exit code. */
export async function runVerify(argv: readonly string[], out: (line: string) => void = console.log, errOut: (line: string) => void = console.error): Promise<number> {
  const args = parseVerifyArgs(argv);
  if (!args.ok) {
    errOut(`${args.error}\n\n${VERIFY_USAGE}`);
    return EXIT_INVALID;
  }
  if (args.value.help) {
    out(VERIFY_USAGE);
    return EXIT_MATCH;
  }
  const result = await verifyCatalog({ latticeDir: args.value.latticeDir, catalogDir: args.value.catalogDir, inPlace: args.value.inPlace, log: out });
  if (!result.ok) errOut(`Couldn't rebuild the catalog to verify it. ${result.error}`);
  else if (result.value.matches) out(formatVerifyReport(result.value));
  else errOut(formatVerifyReport(result.value));
  return verifyExitCode(result);
}

if (import.meta.main) process.exit(await runVerify(Bun.argv.slice(2)));
