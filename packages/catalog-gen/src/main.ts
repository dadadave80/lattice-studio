#!/usr/bin/env bun
/**
 * `bun run catalog` (spec L898, L907-L915; contracts §4): rebuilds the catalog from the pinned Lattice checkout.
 *
 *   bun packages/catalog-gen/src/main.ts [--lattice <dir>] [--out <dir>] [--clean] [--copy] [--allow-main-checkout]
 *
 * One pipeline, in the order that fails cheapest first:
 * 1. Foundry must be 1.8.3 exactly (David, QUESTIONS Q1): every address depends on the compiler build.
 * 2. The checkout must be clean (the catalog records its commit). It's built with `FOUNDRY_PROFILE=ci` (CG2's
 *    `buildLattice`, incremental unless `--clean`; forge rebuilds only what's stale), then diamond-lib's
 *    initializers (CG4). The main checkout's `lattice/` is read-only (contracts §2), so it's built in a fresh
 *    temporary copy of its tracked files instead, from nothing every run (so `--clean` changes nothing there), as
 *    is any checkout with `--copy`.
 * 3. On a local Anvil: facets and their selectors (CG1), storage (CG3), inits (CG4) with the overlay (CG5),
 *    seams and templates (CG6), release data and the proxy (CG2), chain releases (`chains.ts`).
 * 4. The catalog is assembled (CG7), gated on template routing, recipe citations and script facets (CG6), and
 *    written to `catalog/<id>/`, which becomes the manifest's default.
 *
 * `generateCatalog` stops before writing, so `verify.ts` rebuilds and compares with the same code. Nothing that
 * varies between runs (ports, temp paths, timestamps, build-info file names) reaches the catalog.
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { copyFile, lstat, mkdir, mkdtemp, readlink, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import {
  AREAS,
  type Area,
  type Catalog,
  err,
  type FacetDetail,
  type Hex,
  ok,
  type ParseIssue,
  type Result,
  validateCatalog,
} from "@lattice-studio/core";
import { FACTORY, REGISTRY } from "./addressing";
import { type AnvilHandle, startAnvil, studioEnv } from "./anvil";
import {
  type Artifact,
  checkBuildOutputs,
  type FacetSelector,
  describeMismatch as describeSelectorMismatch,
  findArtifact,
} from "./artifacts";
import { readChainReleases } from "./chains";
import {
  buildSupplementaryInits,
  type InitOverlay as InitOverlayInput,
  type InitParamOverlay as InitParamOverlayInput,
  mergeInitOverlay,
  readInits,
  statelessInitContracts,
} from "./inits";
import { type FacetFacts, readFacets } from "./inventory";
import { natspecSummary } from "./natspec";
import { type FacetOverlayFields, facetOverlayFields, type InitParamOverlay, loadOverlay, OVERLAY_DIR, type Overlay } from "./overlay";
import { formatLintSummary, formatParseIssues, type KnownParam, type LintFacts, lintOverlay } from "./overlay-lint";
import {
  buildSeams,
  buildTemplates,
  checkRecipeSources,
  checkScriptFacets,
  loadRecipeOverlay,
  type RecipeFacts,
  SCRIPT_DIR,
  SKIPPED_SCRIPTS,
  type SourceReader,
  verifyTemplateRouting,
} from "./recipes";
import {
  buildLattice,
  CORE_REFS,
  checkProxyInitCodeHash,
  mainLatticeDir,
  PROXY_REF,
  type ProxyRelease,
  proxyRelease,
  readLatticeVersion,
  type ReleaseEntry,
  releaseData,
  releaseReport,
  type ReleaseTarget,
} from "./release";
import { buildFacetDetail } from "./shards";
import { buildSizeReport, formatSizeReport } from "./size-report";
import { allFacetStorage, describeMismatch as describeSlotMismatch, type FacetStorage, scanLatticeStorage } from "./storage";
import {
  type AssembledCatalog,
  assembleCatalog,
  type CatalogInput,
  type FacetInput,
  type InitSpecInput,
  type SharedContractInput,
  writeCatalog,
} from "./write";

/** The Foundry release every catalog is built with (David, QUESTIONS Q1; contracts §2). */
export const FOUNDRY_VERSION = "1.8.3";
/** The Lattice release v1 targets (spec L15, L49). Any other pinned version marks the catalog provisional. */
export const TARGET_VERSION = "0.4.0";
/** Where Lattice's own sources live, for shard `source.url`s at the pinned commit. */
export const LATTICE_REPO_URL = "https://github.com/dadadave80/lattice";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
/** This repo's `catalog/` (contracts §4). */
export const CATALOG_DIR = join(REPO_ROOT, "catalog");

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// ── processes ──────────────────────────────────────────────────────────────────────────────────────

export type RunResult = { code: number; stdout: string; stderr: string };
/** Runs a command to completion. Injectable, so the toolchain and git checks can be tested without either. */
export type Runner = (cmd: string[], opts?: { cwd?: string }) => Promise<RunResult>;

export const runCommand: Runner = async (cmd, opts) => {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    // GIT_OPTIONAL_LOCKS=0: git's status doesn't refresh the index, so reading a checkout never writes to it.
    const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0" };
    proc = Bun.spawn(cmd, { ...(opts?.cwd !== undefined ? { cwd: opts.cwd } : {}), env, stdout: "pipe", stderr: "pipe" });
  } catch (e) {
    return { code: -1, stdout: "", stderr: message(e) };
  }
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout as ReadableStream).text(),
    new Response(proc.stderr as ReadableStream).text(),
  ]);
  return { code, stdout, stderr };
};

// ── toolchain ──────────────────────────────────────────────────────────────────────────────────────

/** The version in `forge --version` or `anvil --version`: "forge Version: 1.8.3" (older: "forge 0.2.0 (…)"). */
export function parseToolVersion(output: string, bin: string): string | undefined {
  return new RegExp(`^${bin}\\s+(?:Version:\\s*)?v?(\\d+\\.\\d+\\.\\d+)`, "m").exec(output)?.[1];
}

/** Foundry must be `FOUNDRY_VERSION` exactly, forge and anvil both; the error says how to fix it. */
export async function checkFoundry(run: Runner = runCommand): Promise<Result<string, string>> {
  const fix = `Switch to Foundry ${FOUNDRY_VERSION} (foundryup --install ${FOUNDRY_VERSION}), then run bun run catalog again.`;
  for (const bin of ["forge", "anvil"]) {
    const res = await run([bin, "--version"]);
    if (res.code !== 0) return err(`${bin} isn't installed or didn't run. ${fix}`);
    const version = parseToolVersion(res.stdout, bin);
    if (version !== FOUNDRY_VERSION) {
      return err(
        `${bin} is ${version ?? "an unrecognized version"}; the catalog needs Foundry ${FOUNDRY_VERSION} exactly, ` +
          `because every address depends on the compiler build. ${fix}`,
      );
    }
  }
  return ok(FOUNDRY_VERSION);
}

// ── the checkout ───────────────────────────────────────────────────────────────────────────────────

/** A submodule of the checkout (diamond-lib, forge-std), at the commit Lattice's tree pins. */
export type Submodule = { path: string; url: string; commit: string };

/** Which Lattice this is: the commit, a release tag pointing at it, `VERSION`, and its submodules. */
export type LatticeIdentity = {
  commit: string;
  /** The highest release tag on the commit (`releaseTags`), if any. */
  tag?: string;
  /** The other release tags on the commit, highest first, when there are several. */
  otherTags?: string[];
  version: string;
  submodules: Submodule[];
};

/** `.gitmodules`' `path` and `url` per submodule, in file order. */
export function parseGitmodules(text: string): { path: string; url: string }[] {
  const out: { path: string; url: string }[] = [];
  for (const block of text.split(/^\s*\[submodule\b/m).slice(1)) {
    const path = /^\s*path\s*=\s*(.+?)\s*$/m.exec(block)?.[1];
    const url = /^\s*url\s*=\s*(.+?)\s*$/m.exec(block)?.[1];
    if (path !== undefined && url !== undefined) out.push({ path, url });
  }
  return out;
}

const RELEASE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

/**
 * The release tags (`vX.Y.Z`) among the tags on a commit, one per line, highest version first in numeric order
 * (v0.10.0 before v0.4.0). Other tags (`storage-guard-v1.0.0`) are ignored.
 */
export function releaseTags(output: string): string[] {
  const parsed = output
    .split("\n")
    .map((t) => t.trim())
    .flatMap((t) => {
      const m = RELEASE_TAG.exec(t);
      return m === null ? [] : [{ t, v: [Number(m[1]), Number(m[2]), Number(m[3])] }];
    });
  parsed.sort((a, b) => (b.v[0] ?? 0) - (a.v[0] ?? 0) || (b.v[1] ?? 0) - (a.v[1] ?? 0) || (b.v[2] ?? 0) - (a.v[2] ?? 0));
  return parsed.map((p) => p.t);
}

/**
 * Reads the checkout's identity with git. A checkout with uncommitted changes (build output aside, which Lattice
 * ignores) is refused: the catalog records the commit, so it must hold exactly what the commit does.
 */
export async function readIdentity(latticeDir: string, run: Runner = runCommand): Promise<Result<LatticeIdentity, string>> {
  const git = (...args: string[]) => run(["git", "-C", latticeDir, ...args]);
  const head = await git("rev-parse", "HEAD");
  const commit = head.stdout.trim();
  if (head.code !== 0 || !/^[0-9a-f]{40}$/.test(commit)) {
    return err(`${latticeDir} isn't a git checkout of Lattice (git rev-parse HEAD: ${head.stderr.trim() || commit}).`);
  }
  const status = await git("status", "--porcelain");
  if (status.code !== 0) return err(`git status failed in ${latticeDir}: ${status.stderr.trim()}`);
  const changed = status.stdout.split("\n").filter((l) => l.trim() !== "");
  if (changed.length > 0) {
    return err(
      `${latticeDir} has uncommitted changes (${changed.slice(0, 5).map((l) => l.trim()).join("; ")}${changed.length > 5 ? "; …" : ""}). ` +
        "The catalog records the commit, so build from a clean checkout.",
    );
  }
  const tags = await git("tag", "--points-at", "HEAD");
  const releases = releaseTags(tags.stdout);
  const tag = releases[0];
  const version = await readLatticeVersion(latticeDir);
  if (!version.ok) return version;

  const submodules: Submodule[] = [];
  const gitmodules = join(latticeDir, ".gitmodules");
  if (existsSync(gitmodules)) {
    for (const { path, url } of parseGitmodules(readFileSync(gitmodules, "utf8"))) {
      const tree = await git("ls-tree", "HEAD", path);
      const pinned = /^160000 commit ([0-9a-f]{40})\t/.exec(tree.stdout)?.[1];
      if (pinned === undefined) return err(`${path}: Lattice's tree pins no commit for this submodule.`);
      submodules.push({ path, url: url.replace(/\.git$/, ""), commit: pinned });
    }
  }
  return ok({
    commit,
    ...(tag !== undefined ? { tag } : {}),
    ...(releases.length > 1 ? { otherTags: releases.slice(1) } : {}),
    version: version.value,
    submodules,
  });
}

/** `catalog/<id>/` (contracts §4): the release tag, else `dev-<commit7>`. */
export function catalogId(identity: Pick<LatticeIdentity, "commit" | "tag">): string {
  return identity.tag ?? `dev-${identity.commit.slice(0, 7)}`;
}

/**
 * `Catalog.provisional` (contracts §3.1) when the pinned Lattice isn't the release v1 targets:
 * "Lattice 0.2.0 at dev f4a32c8; v1 targets 0.4.0". Undefined at the target.
 */
export function provisionalNote(identity: Pick<LatticeIdentity, "commit" | "tag" | "version">): string | undefined {
  if (identity.version === TARGET_VERSION) return undefined;
  const at = identity.tag ?? `dev ${identity.commit.slice(0, 7)}`;
  return `Lattice ${identity.version} at ${at}; v1 targets ${TARGET_VERSION}`;
}

/** A source path's area: `src/<area>/…`; diamond-lib (`lib/…`) and `src/*.sol` are `diamond`. */
export function areaOf(path: string): Result<Area, string> {
  const m = /^src\/([^/]+)\//.exec(path);
  if (m === null) return path.startsWith("lib/") || /^src\/[^/]+\.sol$/.test(path) ? ok("diamond") : err(`${path} is in no area.`);
  const area = m[1] ?? "";
  return (AREAS as readonly string[]).includes(area) ? ok(area as Area) : err(`${path} is under src/${area}/, which isn't an area.`);
}

/** A GitHub URL for a source at the pin: Lattice's commit, or the submodule's own repo at the commit Lattice pins. */
export function sourceUrl(path: string, identity: Pick<LatticeIdentity, "commit" | "submodules">): string {
  for (const s of identity.submodules) {
    if (path.startsWith(`${s.path}/`)) return `${s.url}/blob/${s.commit}/${path.slice(s.path.length + 1)}`;
  }
  return `${LATTICE_REPO_URL}/blob/${identity.commit}/${path}`;
}

/** A path with symlinks resolved as far as they exist. */
function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** Whether `latticeDir` is the main checkout's read-only `lattice/` (contracts §2). */
export function isMainCheckout(latticeDir: string, main: string = mainLatticeDir()): boolean {
  return canonical(latticeDir) === canonical(main);
}

/**
 * Copies the checkout's tracked files (submodules included) into a fresh temporary directory, so it can be
 * built without writing into the original. Returns the copy and a function that removes it.
 */
export async function copyCheckout(
  latticeDir: string,
  run: Runner = runCommand,
): Promise<Result<{ dir: string; remove: () => Promise<void> }, string>> {
  const listed = await run(["git", "-C", latticeDir, "ls-files", "-z", "--recurse-submodules"]);
  if (listed.code !== 0) return err(`git ls-files failed in ${latticeDir}: ${listed.stderr.trim()}`);
  const files = listed.stdout.split("\0").filter((f) => f !== "");
  // Symlinks resolved (macOS's /var is /private/var): forge maps the absolute source paths it's given onto the
  // project root only when both are spelled the same way.
  const root = realpathSync(await mkdtemp(join(tmpdir(), "lattice-studio-catalog-")));
  const remove = async () => {
    await rm(root, { recursive: true, force: true });
  };
  const dir = join(root, "lattice");
  try {
    for (const file of files) {
      const from = join(latticeDir, file);
      const to = join(dir, file);
      await mkdir(dirname(to), { recursive: true });
      const stat = await lstat(from);
      if (stat.isSymbolicLink()) await symlink(await readlink(from), to);
      else if (stat.isFile()) await copyFile(from, to);
    }
  } catch (e) {
    await remove();
    return err(`copying ${latticeDir} failed: ${message(e)}`);
  }
  return ok({ dir, remove });
}

/** Builds the checkout with the ci profile, then diamond-lib's initializers (CG4). */
async function buildCheckout(dir: string, clean: boolean, allowMainCheckout: boolean): Promise<Result<void, string>> {
  const built = await buildLattice(dir, { clean, allowMainCheckout });
  if (!built.ok) return err(`Build: ${built.error}`);
  // CG4's buildSupplementaryInits refuses whichever directory it's told is the main checkout, and has no
  // allowMainCheckout option yet. When this directory may be built (a temporary copy, or a CI clone that owns its
  // submodule), it's given a path that can never be this directory, so the guard passes. Otherwise it gets the
  // real main checkout, and the guard still protects it. Switch to CG4's option once its fix package lands.
  const extra = await buildSupplementaryInits(dir, allowMainCheckout ? join(dir, ".not-the-main-checkout") : mainLatticeDir());
  if (!extra.ok) return err(`Build: ${extra.error}`);
  return ok(undefined);
}

// ── overlay projections ────────────────────────────────────────────────────────────────────────────

function paramOverlayInput(p: InitParamOverlay): InitParamOverlayInput {
  const out: InitParamOverlayInput = {};
  if (p.doc !== undefined) out.doc = p.doc;
  if (p.unit !== undefined) out.unit = p.unit;
  if (p.rule !== undefined) out.rule = p.rule;
  if (p.example !== undefined) out.example = p.example;
  if (p.exampleSource !== undefined) out.exampleSource = p.exampleSource;
  if (p.authority !== undefined) out.authority = p.authority;
  if (p.role !== undefined) out.role = p.role;
  if (p.components !== undefined) {
    out.components = Object.fromEntries(Object.entries(p.components).map(([k, v]) => [k, paramOverlayInput(v)]));
  }
  return out;
}

/** CG5's parsed init overlay (with citations) in the shape CG4's `mergeInitOverlay` takes (without them). */
export function initOverlayInput(inits: Overlay["inits"]): Record<string, InitOverlayInput> {
  const out: Record<string, InitOverlayInput> = {};
  for (const [name, e] of Object.entries(inits)) {
    const o: InitOverlayInput = { kind: e.kind };
    if (e.params !== undefined) {
      o.params = Object.fromEntries(Object.entries(e.params).map(([k, v]) => [k, paramOverlayInput(v)]));
    }
    if (e.after !== undefined) o.after = e.after.map((a) => a.module);
    if (e.sameCall !== undefined) o.sameCall = e.sameCall.map((a) => a.module);
    if (e.sequence !== undefined) o.sequence = [...e.sequence.modules];
    if (e.registersInterfaces !== undefined) o.registersInterfaces = true;
    out[name] = o;
  }
  return out;
}

type ParamLike = { name: string; type: string; doc: string; components?: ParamLike[] };

function knownParam(p: ParamLike): KnownParam {
  const out: KnownParam = { name: p.name, type: p.type };
  if (p.doc !== "") out.doc = p.doc;
  if (p.components !== undefined) out.components = p.components.map(knownParam);
  return out;
}

// ── release entries to catalog input ───────────────────────────────────────────────────────────────

/**
 * A release entry as the catalog's `SharedContract` input: only the catalog's fields (CG7's writer spreads
 * whatever it's given into the index), with the creation code as the file's text.
 */
export function sharedInput(entry: ReleaseEntry, detail?: FacetDetail): SharedContractInput {
  const out: SharedContractInput = {
    salt: entry.salt,
    version: entry.version,
    address: entry.address,
    codehash: entry.codehash,
    initCodeHash: entry.initCodeHash,
    creationCode: entry.creationCode,
  };
  if (entry.dependsOn !== undefined && entry.dependsOn.length > 0) out.dependsOn = [...entry.dependsOn];
  if (entry.provisional !== undefined) out.provisional = entry.provisional;
  if (detail !== undefined) out.detail = detail;
  return out;
}

/** Every function a contract's ABI lists, as NatSpec keys for a non-facet shard (solc's own order). */
export function allSelectors(artifact: Pick<Artifact, "methodIdentifiers">): FacetSelector[] {
  return Object.entries(artifact.methodIdentifiers).map(([signature, hex]) => ({ hex, signature }));
}

/** What `facetInput` puts together for one facet. */
export type FacetParts = {
  name: string;
  area: Area;
  source: string;
  selectors: FacetSelector[];
  overlay: FacetOverlayFields;
  /** The contract notice's first sentence, when the NatSpec has one. */
  natspecSummary: string | undefined;
  storage: FacetStorage;
  release: SharedContractInput;
  detail: FacetDetail;
};

/**
 * One facet's catalog input. The summary is the overlay's, else the NatSpec notice's, else empty: a facet with
 * neither is still built, and the overlay lint lists it as `summary-missing` (spec L911: warnings, not failures).
 */
export function facetInput(p: FacetParts): FacetInput {
  const o = p.overlay;
  return {
    name: p.name,
    area: p.area,
    source: p.source,
    summary: o.summary ?? p.natspecSummary ?? "",
    selectors: p.selectors,
    ...(p.storage.storage !== undefined ? { storage: p.storage.storage } : {}),
    touches: p.storage.touches,
    release: p.release,
    requires: o.requires,
    ...(o.family !== undefined ? { family: o.family } : {}),
    ...(o.defaultOwnerOf !== undefined ? { defaultOwnerOf: o.defaultOwnerOf } : {}),
    ...(o.init !== undefined ? { init: o.init } : {}),
    detail: p.detail,
  };
}

// ── the pipeline ───────────────────────────────────────────────────────────────────────────────────

export type GenerateOptions = {
  latticeDir: string;
  /** `forge clean` before building. */
  clean?: boolean;
  /** Build in a temporary copy of the checkout. Always so for the main checkout's read-only `lattice/`. */
  copy?: boolean;
  /** Build the main checkout in place: only for a checkout that owns its submodule outright, such as a CI clone. */
  allowMainCheckout?: boolean;
  /** The overlay directory (default `overlay/`). */
  overlayDir?: string;
  /** Progress lines, as each stage starts. */
  log?: (line: string) => void;
  run?: Runner;
};

/** The catalog, assembled but not written, and the run's summary (lint, gaps, release report). */
export type Generated = {
  id: string;
  identity: LatticeIdentity;
  input: CatalogInput;
  assembled: AssembledCatalog;
  /** Printed after the catalog is written: every section of the run's summary. */
  summary: string[];
};

function issuesText(issues: readonly ParseIssue[]): string {
  return formatParseIssues(issues);
}

/** Lines of a checkout file, cached; `undefined` when it doesn't exist. */
function sourceReader(dir: string): SourceReader & { count: (path: string) => number | undefined } {
  const cache = new Map<string, readonly string[] | undefined>();
  const read = (path: string): readonly string[] | undefined => {
    if (!cache.has(path)) {
      const file = join(dir, path);
      let lines: readonly string[] | undefined;
      try {
        lines = readFileSync(file, "utf8").split("\n");
      } catch {
        lines = undefined;
      }
      cache.set(path, lines);
    }
    return cache.get(path);
  };
  return Object.assign(read, { count: (path: string) => read(path)?.length });
}

async function scan(dir: string, pattern: string): Promise<string[]> {
  const out: string[] = [];
  try {
    for await (const p of new Bun.Glob(pattern).scan({ cwd: dir, onlyFiles: true })) out.push(p.split("\\").join("/"));
  } catch {
    return [];
  }
  return out.sort();
}

/** Every module an init can initialize: the `X` of each `__X_init` in Lattice and diamond-lib, plus `Ownable`. */
export async function initModules(dir: string): Promise<string[]> {
  const modules = new Set<string>(["Ownable"]);
  for (const root of ["src", "lib/diamond-lib/src"]) {
    for (const file of await scan(join(dir, root), "**/*.sol")) {
      const text = await Bun.file(join(dir, root, file)).text();
      for (const m of text.matchAll(/function __(\w+)_init\(/g)) modules.add(m[1] ?? "");
    }
  }
  return [...modules].sort();
}

/**
 * Runs the whole generator against a checkout and returns the assembled catalog without writing it. Every
 * inconsistency between Lattice, the overlay and the recipes is an error naming what to fix; the overlay lint's
 * warnings and the known gaps go into `summary`.
 */
export async function generateCatalog(options: GenerateOptions): Promise<Result<Generated, string>> {
  const log = options.log ?? (() => {});
  const run = options.run ?? runCommand;
  const clean = options.clean === true;
  const allowMain = options.allowMainCheckout === true;
  const overlayDir = options.overlayDir ?? OVERLAY_DIR;
  const latticeDir = resolve(options.latticeDir);

  log(`Checking Foundry ${FOUNDRY_VERSION}…`);
  const foundry = await checkFoundry(run);
  if (!foundry.ok) return foundry;

  const identity = await readIdentity(latticeDir, run);
  if (!identity.ok) return identity;
  const id = catalogId(identity.value);
  const provisional = provisionalNote(identity.value);
  const { tag: pickedTag, otherTags } = identity.value;
  if (pickedTag !== undefined) {
    const others = otherTags !== undefined ? ` (the highest of ${[pickedTag, ...otherTags].join(", ")})` : "";
    log(`Using release tag ${pickedTag}${others}, which points at ${identity.value.commit.slice(0, 7)}.`);
  }
  log(`Lattice ${identity.value.version} at ${pickedTag ?? `dev ${identity.value.commit.slice(0, 7)}`} → catalog/${id}`);

  const copy = options.copy === true || (!allowMain && isMainCheckout(latticeDir));
  let buildDir = latticeDir;
  let removeCopy: (() => Promise<void>) | undefined;
  let anvil: AnvilHandle | undefined;
  try {
    if (copy) {
      log(`Copying ${latticeDir} to a temporary directory to build it there…`);
      const copied = await copyCheckout(latticeDir, run);
      if (!copied.ok) return copied;
      buildDir = copied.value.dir;
      removeCopy = copied.value.remove;
    }
    log(`Building with FOUNDRY_PROFILE=ci forge build${clean ? " (clean)" : ""}…`);
    const built = await buildCheckout(buildDir, clean, allowMain || copy);
    if (!built.ok) return built;
    let proxy = await proxyRelease(buildDir);
    if (!proxy.ok && !clean) {
      log(`The build info doesn't hold one consistent compile of the proxy (${proxy.error}); building clean…`);
      const rebuilt = await buildCheckout(buildDir, true, allowMain || copy);
      if (!rebuilt.ok) return rebuilt;
      proxy = await proxyRelease(buildDir);
    }
    if (!proxy.ok) return err(`Proxy: ${proxy.error}`);
    const outDir = join(buildDir, "out");
    const proxyArtifact = await findArtifact(outDir, PROXY_REF);
    if (!proxyArtifact.ok) return err(`Proxy: ${proxyArtifact.error}`);
    const outputs = await checkBuildOutputs(outDir, proxyArtifact.value);
    if (outputs.missing.length > 0) {
      return err(`Build: the ci profile's outputs are missing. Set ${outputs.missing.join(" and ")} in foundry.toml's [profile.ci].`);
    }

    log("Starting Anvil…");
    const started = await startAnvil();
    if (!started.ok) return err(`Anvil: ${started.error}`);
    anvil = started.value;

    return await generateFrom({
      buildDir,
      latticeDir,
      identity: identity.value,
      id,
      provisional,
      foundry: foundry.value,
      proxy: proxy.value,
      proxyArtifact: proxyArtifact.value,
      anvil,
      overlayDir,
      log,
    });
  } catch (e) {
    return err(`Catalog: ${message(e)}`);
  } finally {
    if (anvil !== undefined) await anvil.stop();
    if (removeCopy !== undefined) await removeCopy();
  }
}

type Context = {
  buildDir: string;
  latticeDir: string;
  identity: LatticeIdentity;
  id: string;
  provisional: string | undefined;
  foundry: string;
  proxy: ProxyRelease;
  proxyArtifact: Artifact;
  anvil: AnvilHandle;
  overlayDir: string;
  log: (line: string) => void;
};

async function generateFrom(ctx: Context): Promise<Result<Generated, string>> {
  const { buildDir, identity, id, log } = ctx;
  const summary: string[] = [];
  const outDir = join(buildDir, "out");
  const detailOf = (name: string, artifact: Artifact, selectors: FacetSelector[], layout?: unknown): FacetDetail =>
    buildFacetDetail(name, artifact.abi, artifact.metadata, selectors, { path: artifact.sourcePath, url: sourceUrl(artifact.sourcePath, identity) }, layout);

  // Facets (CG1): the inventory, each facet deployed and its exportSelectors() checked against its ABI.
  log("Reading facets…");
  const facetsRead = await readFacets(buildDir, ctx.anvil);
  if (!facetsRead.ok) return err(`Facets: ${facetsRead.error}`);
  const facets: FacetFacts[] = facetsRead.value;
  const selectorMismatches = facets.flatMap((f) => f.mismatches);
  if (selectorMismatches.length > 0) {
    return err(`Facets: exportSelectors() and the ABI disagree:\n${selectorMismatches.map((m) => `  ${describeSelectorMismatch(m)}`).join("\n")}`);
  }
  const areas = new Map<string, Area>();
  for (const f of facets) {
    const area = areaOf(f.source);
    if (!area.ok) return err(`Facets: ${f.name}: ${area.error}`);
    areas.set(f.name, area.value);
  }

  // Storage (CG3): every namespace verified against its formula; each facet's own and what it touches.
  log("Reading storage namespaces…");
  const storageScan = await scanLatticeStorage(buildDir);
  if (!storageScan.ok) return err(`Storage: ${storageScan.error}`);
  const s = storageScan.value;
  const storageProblems = [
    ...s.mismatches.map(describeSlotMismatch),
    ...s.duplicateIds,
    ...s.unverified.map((a) => `${a.file}:${a.line}: erc7201:${a.id} has no slot constant that matches its formula.`),
    ...s.unclassified.map((c) => `${c.file}:${c.line}: ${c.name} looks like an ERC-165 map slot, but its comment names no formula.`),
  ];
  if (storageProblems.length > 0) return err(`Storage:\n${storageProblems.map((p) => `  ${p}`).join("\n")}`);
  for (const w of s.waived) summary.push(`Storage: waived, a known Lattice bug: ${describeSlotMismatch(w)}`);
  const facetStorage = await allFacetStorage(buildDir, facets.map((f) => ({ name: f.name, sourcePath: f.source })), s.registry);
  if (!facetStorage.ok) return err(`Storage: ${facetStorage.error}`);
  if (facetStorage.value.duplicateOwners.length > 0) return err(`Storage:\n  ${facetStorage.value.duplicateOwners.join("\n  ")}`);

  // The overlay (CG5) and the recipe overlay (CG6).
  const overlay = await loadOverlay(ctx.overlayDir);
  if (!overlay.ok) return err(`Overlay:\n${issuesText(overlay.error)}`);
  const recipeOverlay = await loadRecipeOverlay(ctx.overlayDir);
  if (!recipeOverlay.ok) return err(`Recipes:\n${issuesText(recipeOverlay.error)}`);
  const facetOverlay = new Map(facets.map((f) => [f.name, facetOverlayFields(overlay.value.facets[f.name])]));

  // Inits (CG4), completed by the overlay.
  log("Reading init contracts…");
  const initsRead = await readInits(buildDir);
  if (!initsRead.ok) return err(`Inits: ${initsRead.error}`);
  const merged = mergeInitOverlay(
    initsRead.value.inits.map((f) => f.spec),
    initOverlayInput(overlay.value.inits),
  );
  const initProblems = [
    ...merged.conflicts,
    ...merged.unknownOverlay.map((n) => `the overlay describes ${n}, which isn't an init at the pin.`),
  ];
  if (initProblems.length > 0) return err(`Inits:\n${initProblems.map((p) => `  ${p}`).join("\n")}`);

  // Seams and templates (CG6).
  const recipeFacts: RecipeFacts = {
    tag: id,
    facets: facets.map((f) => {
      const family = facetOverlay.get(f.name)?.family;
      return { name: f.name, selectors: f.selectors, ...(family !== undefined ? { family } : {}) };
    }),
    inits: merged.inits.map((i) => ({ name: i.name, params: i.params })),
  };
  const seams = buildSeams(recipeOverlay.value, recipeFacts);
  if (!seams.ok) return err(`Seams:\n${issuesText(seams.error)}`);
  const templates = buildTemplates(recipeOverlay.value, recipeFacts);
  if (!templates.ok) return err(`Templates:\n${issuesText(templates.error)}`);

  // The overlay lint (CG5): errors stop the run, warnings are listed (spec L911).
  const reader = sourceReader(buildDir);
  const initArea = new Map(initsRead.value.inits.map((f) => [f.spec.name, areaOf(f.sourcePath)]));
  const lintFacts: LintFacts = {
    facets: facets.map((f) => {
      const summaryText = natspecSummary(f.artifact.metadata);
      return {
        name: f.name,
        area: areas.get(f.name) as Area,
        selectors: f.selectors.map((x) => x.hex),
        ...(summaryText !== undefined ? { summary: summaryText } : {}),
      };
    }),
    inits: initsRead.value.inits.map((f) => {
      const area = initArea.get(f.spec.name);
      return {
        name: f.spec.name,
        ...(area?.ok ? { area: area.value } : {}),
        params: f.spec.params.map(knownParam),
        initializes: f.spec.initializes.map((i) => i.module),
        registersInterfaces: f.spec.registersInterfaces === true,
      };
    }),
    modules: await initModules(buildDir),
    seams: seams.value,
    sourceLines: reader.count,
  };
  const lint = lintOverlay(overlay.value, lintFacts);
  if (lint.errors.length > 0) return err(`Overlay lint:\n${formatLintSummary(lint)}`);
  summary.push(formatLintSummary(lint));
  const byArea = new Map<string, number>();
  for (const w of lint.warnings) byArea.set(`${w.code}`, (byArea.get(`${w.code}`) ?? 0) + 1);
  if (byArea.size > 0) summary.push(`  warnings by kind: ${[...byArea].map(([k, n]) => `${k} ${n}`).join(", ")}`);
  const initNotes: string[] = [];
  if (merged.withoutOverlay.length > 0) initNotes.push(`  no overlay entry (${merged.withoutOverlay.length}): ${merged.withoutOverlay.join(", ")}`);
  if (merged.undocumented.length > 0) initNotes.push(`  parameters with no doc (${merged.undocumented.length}): ${merged.undocumented.join(", ")}`);
  if (merged.docOverrides.length > 0) {
    initNotes.push(`  overlay docs replacing NatSpec (${merged.docOverrides.length}):`);
    for (const d of merged.docOverrides) initNotes.push(`    ${d.path}: "${d.source}" → "${d.overlay}"`);
  }
  if (initsRead.value.notes.length > 0) {
    initNotes.push(`  calls the init walk didn't follow (${initsRead.value.notes.length}):`);
    for (const n of initsRead.value.notes) initNotes.push(`    ${n}`);
  }
  if (initsRead.value.externalCalls.length > 0) {
    initNotes.push(`  calls into other code, not followed (${initsRead.value.externalCalls.length}):`);
    for (const c of initsRead.value.externalCalls) initNotes.push(`    ${c}`);
  }
  if (initNotes.length > 0) summary.push(`Inits: ${merged.inits.length} specs.`, ...initNotes);
  if (templates.value.gaps.length > 0) {
    summary.push(`Template gaps (${templates.value.gaps.length}):`);
    for (const g of templates.value.gaps) summary.push(`  ${g.name} (${g.phase}): ${g.gaps}`);
  }

  // Release data (CG2): every shared contract deployed through Arachnid's proxy on Anvil, checked against its prediction.
  log("Releasing shared contracts on Anvil…");
  const initContracts = statelessInitContracts(initsRead.value.inits);
  const targets: ReleaseTarget[] = [
    REGISTRY,
    FACTORY,
    ...facets.map((f) => f.name),
    ...initContracts.map((c) => ({
      name: c.contract,
      ref: { file: basename(c.artifact.sourcePath), contract: c.contract, sourcePath: c.artifact.sourcePath },
    })),
  ];
  const release = await releaseData(buildDir, ctx.anvil, targets);
  if (!release.ok) return err(`Release: ${release.error}`);
  const r = release.value;
  if (r.skipped.length > 0) {
    return err(`Release: these need constructor arguments, so they can't be released: ${r.skipped.map((x) => `${x.name} (${x.reason})`).join("; ")}`);
  }
  if (r.version !== identity.version) return err(`Release: version ${r.version}, but the checkout's VERSION is ${identity.version}.`);
  if (r.compiler.version !== ctx.proxy.compiler.version || r.compiler.evmVersion !== ctx.proxy.compiler.evmVersion) {
    return err(`Release: the proxy was built with ${ctx.proxy.compiler.version} for ${ctx.proxy.compiler.evmVersion}, the rest with ${r.compiler.version} for ${r.compiler.evmVersion}. Build clean.`);
  }
  const entries = new Map(r.contracts.map((e) => [e.name, e]));
  const entry = (name: string): ReleaseEntry => {
    const e = entries.get(name);
    if (e === undefined) throw new Error(`no release entry for ${name}`);
    return e;
  };
  const factoryEntry = entry(FACTORY);
  const registryEntry = entry(REGISTRY);
  const probe = await checkProxyInitCodeHash(ctx.anvil, factoryEntry.address, ctx.proxy.initCodeHash);
  if (!probe.ok) return err(`Proxy: ${probe.error}`);

  // Per-chain releases, from Lattice's manifests in the original checkout (none at the pin).
  const chains = await readChainReleases(ctx.latticeDir, {
    version: r.version,
    factory: factoryEntry.address,
    registry: registryEntry.address,
    facets: Object.fromEntries(facets.map((f) => [f.name, entry(f.name).address])),
  });
  if (!chains.ok) return err(`Chains: ${chains.error}`);
  if (chains.value.gaps.length > 0) summary.push("Chain releases (for Lattice A4):", ...chains.value.gaps.map((g) => `  ${g}`));

  // Shards for everything that isn't a facet: the registry, the factory, the proxy and the init contracts.
  const coreDetail = async (name: string): Promise<Result<FacetDetail, string>> => {
    const a = await findArtifact(outDir, CORE_REFS[name] as NonNullable<(typeof CORE_REFS)[string]>);
    if (!a.ok) return err(`${name}: ${a.error}`);
    return ok(detailOf(name, a.value, allSelectors(a.value)));
  };
  const registryDetail = await coreDetail(REGISTRY);
  if (!registryDetail.ok) return registryDetail;
  const factoryDetail = await coreDetail(FACTORY);
  if (!factoryDetail.ok) return factoryDetail;

  const initRelease = new Map<string, SharedContractInput>();
  for (const c of initContracts) initRelease.set(c.contract, sharedInput(entry(c.contract), detailOf(c.contract, c.artifact, allSelectors(c.artifact))));
  const inits: InitSpecInput[] = merged.inits.map((spec) => {
    const rel = initRelease.get(spec.contract);
    return rel !== undefined ? { ...spec, release: rel } : { ...spec };
  });

  const facetInputs: FacetInput[] = facets.map((f) =>
    facetInput({
      name: f.name,
      area: areas.get(f.name) as Area,
      source: f.source,
      selectors: f.selectors,
      overlay: facetOverlay.get(f.name) ?? facetOverlayFields(undefined),
      natspecSummary: natspecSummary(f.artifact.metadata),
      storage: facetStorage.value.facets.get(f.name) ?? { touches: [] },
      release: sharedInput(entry(f.name)),
      detail: detailOf(f.name, f.artifact, f.selectors, f.artifact.storageLayout),
    }),
  );

  const input: CatalogInput = {
    lattice: { tag: id, commit: identity.commit },
    toolchain: { foundry: ctx.foundry, solc: r.compiler.version.split("+")[0] ?? r.compiler.version },
    deployer: r.deployer,
    registry: sharedInput(registryEntry, registryDetail.value),
    factory: sharedInput(factoryEntry, factoryDetail.value),
    proxy: {
      creationCode: ctx.proxy.creationCode,
      initCodeHash: ctx.proxy.initCodeHash,
      standardJson: ctx.proxy.standardJson,
      detail: detailOf("Lattice", ctx.proxyArtifact, allSelectors(ctx.proxyArtifact)),
    },
    facets: facetInputs,
    inits,
    recipes: templates.value.templates,
    chains: chains.value.chains,
    seams: seams.value,
    ...(ctx.provisional !== undefined ? { provisional: ctx.provisional } : {}),
    ...(r.libraries.length > 0 ? { libraries: r.libraries.map((l) => ({ name: l.name, release: sharedInput(l) })) } : {}),
    registryOwner: r.registryOwner,
  };

  // Assemble (CG7), then the gates that need the finished catalog (CG6).
  log("Assembling and checking the catalog…");
  let assembled: AssembledCatalog;
  try {
    assembled = assembleCatalog(input);
  } catch (e) {
    return err(`Assemble: ${message(e)}`);
  }
  const valid = validateCatalog(assembled.catalog);
  if (!valid.ok) return err(`Assemble: the catalog doesn't match the schema:\n${issuesText(valid.error)}`);
  const catalog: Catalog = assembled.catalog;
  const scripts = await scan(buildDir, `${SCRIPT_DIR}/**/*.s.sol`);
  const covered = new Set([...recipeOverlay.value.recipes.map((x) => x.script), ...Object.keys(SKIPPED_SCRIPTS)]);
  const gateIssues: ParseIssue[] = [
    ...verifyTemplateRouting(catalog, templates.value.routing),
    ...checkRecipeSources(recipeOverlay.value, reader),
    ...checkScriptFacets(recipeOverlay.value, reader, scripts, new Set(facets.map((f) => f.name))),
    ...scripts.filter((p) => !covered.has(p)).map((p) => ({ file: p, path: "", message: "is a deploy script with no template and no reason to skip it." })),
  ];
  if (gateIssues.length > 0) return err(`Templates don't match Lattice's scripts:\n${issuesText(gateIssues)}`);

  summary.unshift(releaseReport(r, ctx.proxy).trimEnd());
  return ok({ id, identity, input, assembled, summary });
}

// ── the command ────────────────────────────────────────────────────────────────────────────────────

export type CatalogArgs = {
  latticeDir: string;
  outDir: string;
  clean: boolean;
  copy: boolean;
  allowMainCheckout: boolean;
  help: boolean;
};

export const USAGE = `Usage: bun run catalog [--lattice <dir>] [--out <dir>] [--clean] [--copy] [--allow-main-checkout]

Rebuilds catalog/<id>/ from a Lattice checkout with Foundry ${FOUNDRY_VERSION} and makes it the manifest's default.
The main checkout's lattice/ (the default, and CI's drift check) is read-only, so every run builds a fresh
temporary copy of it from nothing (about 100 s), and --clean changes nothing there. A checkout of your own is
built in place, incrementally (seconds when out/ is current).
  --lattice <dir>          the checkout (default: LATTICE_DIR, else lattice/)
  --out <dir>              where catalogs live (default: catalog/)
  --clean                  forge clean before building (only matters for a checkout built in place)
  --copy                   build in a fresh temporary copy of the checkout, as the main checkout's always is
  --allow-main-checkout    build the main checkout's lattice/ in place (a fresh CI clone that owns it only)`;

/** Parses the command line; an error names the argument. */
export function parseCatalogArgs(argv: readonly string[], root: string = REPO_ROOT): Result<CatalogArgs, string> {
  const args: CatalogArgs = {
    latticeDir: studioEnv("LATTICE_DIR", root) ?? join(root, "lattice"),
    outDir: join(root, "catalog"),
    clean: false,
    copy: false,
    allowMainCheckout: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--clean") args.clean = true;
    else if (a === "--copy") args.copy = true;
    else if (a === "--allow-main-checkout") args.allowMainCheckout = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--lattice" || a === "--out") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) return err(`${a} needs a directory.`);
      if (a === "--lattice") args.latticeDir = resolve(value);
      else args.outDir = resolve(value);
    } else return err(`Unknown argument ${a}.`);
  }
  return ok(args);
}

/** `bun run catalog`: generates, writes, reports. Returns the exit code (0 written, 1 failed, 2 bad arguments). */
export async function runCatalog(argv: readonly string[], out: (line: string) => void = console.log, errOut: (line: string) => void = console.error): Promise<number> {
  const args = parseCatalogArgs(argv);
  if (!args.ok) {
    errOut(`${args.error}\n\n${USAGE}`);
    return 2;
  }
  if (args.value.help) {
    out(USAGE);
    return 0;
  }
  const started = Date.now();
  const generated = await generateCatalog({
    latticeDir: args.value.latticeDir,
    clean: args.value.clean,
    copy: args.value.copy,
    allowMainCheckout: args.value.allowMainCheckout,
    log: out,
  });
  if (!generated.ok) {
    errOut(`Catalog not written. ${generated.error}`);
    return 1;
  }
  const g = generated.value;
  const written = await writeCatalog(args.value.outDir, g.id, g.input, { makeDefault: true });
  if (!written.ok) {
    errOut(`Catalog not written. ${written.error}`);
    return 1;
  }
  const index = g.assembled.files.find((f) => f.path === "index.json");
  const others = g.assembled.files.filter((f) => f.path !== "index.json").map((f) => ({ path: f.path, bytes: f.bytes.length }));
  const size = buildSizeReport(index?.bytes ?? new Uint8Array(), others);
  const c = written.value.catalog;
  for (const line of g.summary) out(line);
  out(formatSizeReport(size));
  if (c.provisional !== undefined) out(`Provisional: ${c.provisional}.`);
  out(
    `Wrote ${relative(process.cwd(), written.value.dir) || written.value.dir} (${g.assembled.files.length} files) · ` +
      `${c.facets.length} facets · ${c.inits.length} inits · ${c.recipes.length} templates · ${c.seams.length} seams · ` +
      `${c.chains.length} chain releases · hash ${c.hash as Hex} · default in manifest.json · ${Math.round((Date.now() - started) / 1000)} s`,
  );
  return 0;
}

if (import.meta.main) process.exit(await runCatalog(Bun.argv.slice(2)));
