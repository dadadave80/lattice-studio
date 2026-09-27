#!/usr/bin/env bun
/**
 * Writes the fixture catalogs (`fixtures/catalog/fixture/`, `fixture-next/`, `manifest.json`, `provenance.json`)
 * from Lattice's source text at the pin, the design prototype's data and the overlay facts in `overlay.ts`.
 *
 *   bun fixtures/gen/build.ts [--prototype <prototype-data.json>]
 *
 * A dev tool: it reads `.handoff/design/prototype/prototype-data.json` by default, which only the build-out
 * machines have. The output is committed; `fixtures/validate.test.ts` checks it without the prototype.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type AbiFunction, keccak256, parseAbiItem, stringToBytes, toFunctionSelector } from "viem";
import type {
  AbiItem,
  Area,
  Catalog,
  CatalogManifest,
  Facet,
  FacetDetail,
  InitSpec,
  RecipeTemplate,
  SharedContract,
  ShardRef,
} from "../../packages/core/src/model/catalog.ts";
import type { Hex, Hex4 } from "../../packages/core/src/model/hex.ts";
import type { Recipe } from "../../packages/core/src/model/recipe.ts";
import { ARACHNID_PROXY_CODEHASH } from "../../packages/core/src/address/shared.ts";
import { catalogHash } from "../../packages/core/src/canonical/hash.ts";
import { validateCatalog, validateCatalogManifest, validateFacetDetail } from "../../packages/core/src/model/schema.ts";
import {
  ARACHNID,
  create2Address,
  erc7201Slot,
  fakeCodehash,
  fakeCreationCode,
  fileHash,
  indexHash,
  releaseSalt,
  versionlessSalt,
} from "./formulas.ts";
import {
  type Declaration,
  INVENTORY_PATH,
  isElementary,
  latticeDir,
  lineOf,
  readDeclarations,
  readExportSelectors,
  readInventory,
  readScriptCuts,
  readSource,
  REPO_ROOT,
} from "./lattice-source.ts";
import {
  type Cite,
  DEFAULT_OWNERS,
  FACET_INITS,
  FAMILIES,
  INITS,
  LIBRARIES,
  linksProvisional,
  NEXT_CHANGES,
  REGISTRY_OWNER,
  REQUIRES,
  SEAMS,
  SUMMARIES,
  TEMPLATES,
  TOUCHES_ONLY,
} from "./overlay.ts";

// ── inputs ─────────────────────────────────────────────────────────────────────────────────────────

type PrototypeFn = { n: string; s: string; x: string };
type PrototypeFacet = {
  name: string;
  area: string;
  path: string;
  version: string;
  ns: string;
  slot: string;
  uses: string[];
  summary: string;
  fns: PrototypeFn[];
};
type PrototypeData = { catalog: PrototypeFacet[] };

const argPrototype = process.argv.indexOf("--prototype");
const prototypePath =
  argPrototype > 0 ? (process.argv[argPrototype + 1] ?? "") : join(REPO_ROOT, ".handoff", "design", "prototype", "prototype-data.json");
if (!existsSync(prototypePath)) {
  console.error(`No prototype data at ${prototypePath}. Pass --prototype <prototype-data.json>.`);
  process.exit(2);
}
const dir = latticeDir();
if (!dir) {
  console.error("No Lattice checkout: set LATTICE_DIR or check out the lattice submodule.");
  process.exit(2);
}
const prototype = JSON.parse(readFileSync(prototypePath, "utf8")) as PrototypeData;
const protoByName = new Map(prototype.catalog.map((f) => [f.name, f]));

function git(cwd: string, ...args: string[]): string {
  const run = Bun.spawnSync(["git", "-C", cwd, ...args]);
  if (run.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed in ${cwd}`);
  return run.stdout.toString().trim();
}

const COMMIT = git(dir, "rev-parse", "HEAD");
const DIAMOND_LIB_COMMIT = git(join(dir, "lib", "diamond-lib"), "rev-parse", "HEAD");
const VERSION = /string internal constant VERSION = "([^"]+)"/.exec(readSource(dir, "src/LatticeVersion.sol"))?.[1];
if (!VERSION) throw new Error("src/LatticeVersion.sol: no VERSION");
const VERSION_CITE = `src/LatticeVersion.sol#L${lineOf(dir, "src/LatticeVersion.sol", "string internal constant VERSION")}`;

const OUT = join(REPO_ROOT, "fixtures", "catalog");
const ZERO_HASH: Hex = `0x${"00".repeat(32)}`;
const AREAS: readonly Area[] = [
  "access", "accounts", "amm", "crosschain", "defi", "diamond", "ens",
  "governance", "oracles", "privacy", "security", "tokens", "utils",
];

function cite(c: Cite): string {
  const from = lineOf(dir as string, c.path, c.needle);
  return `${c.path}#L${from}-L${from + (c.lines ?? 1) - 1}`;
}

function sourceUrl(path: string): string {
  const prefix = "lib/diamond-lib/";
  return path.startsWith(prefix)
    ? `https://github.com/dadadave80/diamond-lib/blob/${DIAMOND_LIB_COMMIT}/${path.slice(prefix.length)}`
    : `https://github.com/dadadave80/lattice/blob/${COMMIT}/${path}`;
}

// ── files ──────────────────────────────────────────────────────────────────────────────────────────

/** Files one catalog writes, by path relative to the catalog directory. */
type Files = Map<string, Uint8Array>;

function put(files: Files, path: string, text: string): ShardRef {
  const bytes = stringToBytes(text);
  files.set(path, bytes);
  return { path, bytes: bytes.length, hash: fileHash(bytes) };
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** A shared contract with fake code `<prefix>:<Name>`, released at `salt`. */
function shared(files: Files, name: string, salt: Hex, prefix = "fixture"): SharedContract {
  const code = fakeCreationCode(name, prefix);
  const creationCode = put(files, `code/${name}.creation.hex`, code);
  const initCodeHash = keccak256(code);
  return {
    salt,
    version: VERSION as string,
    address: create2Address(salt, initCodeHash),
    codehash: fakeCodehash(name, prefix),
    initCodeHash,
    creationCode,
  };
}

// ── facets ─────────────────────────────────────────────────────────────────────────────────────────

const notes = new Set<string>();
const inventory = readInventory(dir);
const inventoryNames = new Set(inventory.map((e) => e.name));
for (const p of prototype.catalog) {
  if (!inventoryNames.has(p.name)) notes.add(`Prototype lists ${p.name}, which isn't in FacetInventory at the pin: dropped.`);
}

/** Every 32-byte hex literal in Lattice's and diamond-lib's source, to check slots against library constants. */
const sourceSlots = new Set<string>();
for (const root of ["src", "lib/diamond-lib/src"]) {
  for (const file of new Bun.Glob("**/*.sol").scanSync({ cwd: join(dir, root) })) {
    for (const m of readSource(dir, `${root}/${file}`).matchAll(/0x[0-9a-fA-F]{64}/g)) sourceSlots.add(m[0].toLowerCase());
  }
}

type FacetBuild = { facet: Facet; detail: FacetDetail; exportLine: number };

function buildFacet(files: Files, entry: { name: string; path: string }): FacetBuild {
  const proto = protoByName.get(entry.name);
  if (!proto) throw new Error(`${entry.name}: not in the prototype data`);
  const exported = readExportSelectors(dir as string, entry.path);
  const byHex = new Map(proto.fns.map((f) => [f.x, f]));
  const fns: PrototypeFn[] =
    exported.kind === "hex"
      ? exported.selectors.map((hex) => {
          const fn = byHex.get(hex);
          if (!fn) throw new Error(`${entry.name}: the prototype has no signature for ${hex}`);
          return fn;
        })
      : exported.names.map((n) => {
          const matches = proto.fns.filter((f) => f.n === n);
          if (matches.length !== 1 || !matches[0]) throw new Error(`${entry.name}: ${matches.length} prototype functions named ${n}`);
          return matches[0];
        });
  const selectors = fns
    .filter((f) => f.x !== "0x0ef22643")
    .map((f) => {
      const hex = f.x as Hex4;
      if (hex !== "0x00000000" && toFunctionSelector(`function ${f.s}`) !== hex) throw new Error(`${entry.name}: ${f.s} isn't ${hex}`);
      return { hex, signature: f.s };
    });
  const protoOrder = proto.fns.map((f) => f.x).join();
  if (protoOrder !== selectors.map((s) => s.hex).join()) notes.add(`${entry.name}: prototype lists its selectors in another order; the fixture follows exportSelectors().`);
  if (proto.fns.length !== selectors.length) notes.add(`${entry.name}: prototype has ${proto.fns.length} selectors, source ${selectors.length}.`);

  if (!AREAS.includes(proto.area as Area)) throw new Error(`${entry.name}: area ${proto.area} isn't an Area`);
  let storage: Facet["storage"];
  const touchesOnly = TOUCHES_ONLY.find((t) => t.facet === entry.name);
  const touches = proto.uses.filter((ns) => ns !== proto.ns);
  if (touchesOnly && !touches.includes(touchesOnly.namespace)) touches.push(touchesOnly.namespace);
  if (touchesOnly) notes.add(`${entry.name}: the prototype gives it ${proto.ns} as its own storage; it only calls into that library's storage, so the fixture lists it in touches.`);
  if (proto.ns && !touchesOnly) {
    const slot = erc7201Slot(proto.ns);
    if (slot !== proto.slot.toLowerCase()) notes.add(`${entry.name}: prototype slot ${proto.slot} for ${proto.ns} isn't its ERC-7201 slot ${slot}; the fixture uses ${slot}.`);
    if (!sourceSlots.has(slot)) notes.add(`${entry.name}: ERC-7201 slot ${slot} of ${proto.ns} appears nowhere in the source as a constant.`);
    storage = { id: proto.ns, slot };
  }
  const requires = REQUIRES.filter((r) => r.facet === entry.name).map(({ anyOf, strength, reason }) => ({ anyOf, strength, reason }));
  const family = FAMILIES.find((f) => f.facets.includes(entry.name))?.family;
  const defaultOwnerOf = DEFAULT_OWNERS.find((d) => d.facet === entry.name)?.selectors;
  const init = FACET_INITS.find((i) => i.facet === entry.name)?.init;

  const declarations = readDeclarations(dir as string, entry.path);
  const abi: AbiItem[] = selectors.map((s) =>
    s.hex === "0x00000000" ? { type: "receive", stateMutability: "payable" } : abiFunction(entry.name, s.signature, declarations),
  );
  const summary = SUMMARIES.find((x) => x.facet === entry.name)?.summary ?? proto.summary;
  if (summary !== proto.summary) notes.add(`${entry.name}: the prototype's summary is stale NatSpec; the fixture writes its own.`);
  const detail: FacetDetail = {
    name: entry.name,
    abi,
    natspec: { notice: summary, functions: {} },
    source: { path: entry.path, url: sourceUrl(entry.path) },
  };
  const facet: Facet = {
    name: entry.name,
    area: proto.area as Area,
    source: entry.path,
    summary,
    selectors,
    ...(storage ? { storage } : {}),
    touches,
    release: shared(files, entry.name, releaseSalt(entry.name, VERSION as string)),
    requires,
    ...(family ? { family } : {}),
    ...(defaultOwnerOf ? { defaultOwnerOf } : {}),
    ...(init ? { init } : {}),
    detail: { path: `shards/${entry.name}.json`, bytes: 0, hash: ZERO_HASH },
  };
  return { facet, detail, exportLine: exported.line };
}

/** Facets whose ABI entries fell back to `nonpayable` with no names or outputs: no unique declaration. */
const unresolved = new Set<string>();

/**
 * One ABI function from its signature, with mutability, parameter names and elementary outputs taken from the
 * facet's own declaration when exactly one matches by name and parameter types.
 */
function abiFunction(facet: string, signature: string, declarations: Declaration[]): AbiItem {
  const item = parseAbiItem(`function ${signature}`) as AbiFunction;
  const matches = declarations.filter(
    (d) =>
      d.name === item.name &&
      d.params.length === item.inputs.length &&
      d.params.every((p, i) => !isElementary(p.type) || p.type === item.inputs[i]?.type),
  );
  const decl = matches[0];
  if (!decl || matches.some((d) => d.mutability !== decl.mutability)) {
    unresolved.add(`${facet}.${signature}`);
    return item;
  }
  const outputs = decl.returns.every((r) => isElementary(r.type))
    ? decl.returns.map((r) => (r.name ? { type: r.type, name: r.name } : { type: r.type }))
    : [];
  return {
    ...item,
    stateMutability: decl.mutability,
    inputs: item.inputs.map((input, i) => {
      const name = decl.params[i]?.name;
      return name ? { ...input, name } : input;
    }),
    outputs,
  };
}

function writeShard(files: Files, build: FacetBuild): void {
  build.facet.detail = put(files, `shards/${build.facet.name}.json`, json(build.detail));
}

// ── inits and templates ────────────────────────────────────────────────────────────────────────────

function buildInits(files: Files): InitSpec[] {
  const releases = new Map<string, SharedContract>();
  return INITS.map(({ path: _path, source: _source, ...spec }) => {
    if (spec.ctorArgs) return spec;
    let release = releases.get(spec.contract);
    if (!release) {
      release = shared(files, spec.contract, releaseSalt(spec.contract, VERSION as string));
      releases.set(spec.contract, release);
    }
    return { ...spec, release };
  });
}

function buildTemplates(facets: Facet[], tag: string): RecipeTemplate[] {
  const order = new Map(facets.map((f, i) => [f.name, i]));
  const byName = new Map(facets.map((f) => [f.name, f]));
  return TEMPLATES.map((t) => {
    const cuts = readScriptCuts(dir as string, t.script, t.cutsFn);
    const names = [...new Set(cuts.map((c) => c.facet))].sort((a, b) => (order.get(a) ?? -1) - (order.get(b) ?? -1));
    const servedBy = new Map<Hex4, string>();
    const exporters = new Map<Hex4, string[]>();
    for (const cut of cuts) {
      const facet = byName.get(cut.facet);
      if (!facet) throw new Error(`${t.name}: ${cut.facet} isn't a catalog facet`);
      for (const { hex } of facet.selectors) {
        exporters.set(hex, [...(exporters.get(hex) ?? []), facet.name]);
        if (cut.except.includes(hex)) continue;
        const other = servedBy.get(hex);
        if (other) throw new Error(`${t.name}: ${hex} is cut from both ${other} and ${facet.name}`);
        servedBy.set(hex, facet.name);
      }
    }
    const owners: Record<Hex4, string> = {};
    const exclude: Hex4[] = [];
    for (const [hex, from] of [...exporters].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const owner = servedBy.get(hex);
      if (!owner) exclude.push(hex);
      else if (from.length > 1) owners[hex] = owner;
    }
    const recipe: Recipe = {
      schemaVersion: 1,
      // A template can't hold the hash of the index it lives in; loadTemplate stamps the live catalog's hash.
      catalog: { tag, hash: ZERO_HASH },
      facets: names,
      owners,
      exclude,
      init: t.init,
      ...(t.immutable ? { immutable: true as const } : {}),
    };
    return { name: t.name, script: t.script, proxy: t.proxy, recipe, phase: t.phase };
  });
}

// ── one catalog ────────────────────────────────────────────────────────────────────────────────────

type Built = { index: Catalog; files: Files };

function buildCatalog(tag: string, next: boolean): Built {
  const files: Files = new Map();
  const builds = inventory.map((entry) => buildFacet(files, entry));
  if (next) applyNext(files, builds);
  for (const b of builds) writeShard(files, b);
  const facets = builds.map((b) => b.facet);
  for (const lib of LIBRARIES) {
    for (const name of lib.linkedBy) {
      const b = builds.find((x) => x.facet.name === name);
      if (!b) throw new Error(`${lib.name}: no facet ${name}`);
      b.facet.release = { ...b.facet.release, dependsOn: [lib.name], provisional: linksProvisional(lib.name) };
    }
  }
  const proxyCode = fakeCreationCode("Lattice");
  const index: Catalog = {
    lattice: { tag, commit: COMMIT },
    toolchain: { foundry: "1.8.3", solc: "0.8.36" },
    hash: ZERO_HASH,
    deployer: { address: ARACHNID, codehash: ARACHNID_PROXY_CODEHASH },
    registry: shared(files, "LatticeRegistry", versionlessSalt("LatticeRegistry")),
    factory: shared(files, "LatticeFactory", versionlessSalt("LatticeFactory")),
    proxy: {
      creationCode: put(files, "code/Lattice.creation.hex", proxyCode),
      initCodeHash: keccak256(proxyCode),
      standardJson: put(
        files,
        "json/Lattice.standard.json",
        json({ language: "Solidity", sources: {}, settings: {}, fixture: "Invented: build the real catalog for a verifiable standard JSON input." }),
      ),
    },
    facets,
    inits: buildInits(files),
    recipes: buildTemplates(facets, tag),
    chains: [],
    seams: SEAMS.map(({ source: _source, ...seam }) => seam),
    libraries: LIBRARIES.map((lib) => ({ name: lib.name, release: shared(files, lib.name, releaseSalt(lib.name, VERSION as string)) })),
    registryOwner: REGISTRY_OWNER,
    provisional: `Lattice ${VERSION} at dev ${COMMIT.slice(0, 7)}; v1 targets 0.4.0. Fixture catalog: invented release data.`,
  };
  assertOwnStorage(facets);
  index.hash = catalogHash(index);
  if (index.hash !== indexHash(index as unknown as Record<string, unknown>)) throw new Error(`${tag}: C1's catalogHash and the fixture's indexHash disagree`);
  return { index, files };
}

/** No two facets may declare the same storage id or slot (contracts §4 rulings). */
function assertOwnStorage(facets: Facet[]): void {
  const seen = new Map<string, string>();
  for (const f of facets) {
    if (!f.storage) continue;
    for (const key of [f.storage.id, f.storage.slot]) {
      const other = seen.get(key);
      if (other) throw new Error(`${f.name} and ${other} both declare storage ${key}`);
      seen.set(key, f.name);
    }
  }
}

function applyNext(files: Files, builds: FacetBuild[]): void {
  const find = (name: string): FacetBuild => {
    const b = builds.find((x) => x.facet.name === name);
    if (!b) throw new Error(`fixture-next: no facet ${name}`);
    return b;
  };
  const gains = find(NEXT_CHANGES.gains.facet);
  const sig = NEXT_CHANGES.gains.signature;
  gains.facet.selectors = [...gains.facet.selectors, { hex: toFunctionSelector(`function ${sig}`) as Hex4, signature: sig }];
  gains.detail.abi = [...gains.detail.abi, parseAbiItem(`function ${sig}`) as AbiItem];
  gains.facet.release = shared(files, gains.facet.name, gains.facet.release.salt, "fixture-next");

  const loses = find(NEXT_CHANGES.loses.facet);
  const lost = toFunctionSelector(`function ${NEXT_CHANGES.loses.signature}`);
  if (!loses.facet.selectors.some((s) => s.hex === lost)) throw new Error(`fixture-next: ${loses.facet.name} doesn't export ${lost}`);
  loses.facet.selectors = loses.facet.selectors.filter((s) => s.hex !== lost);
  loses.detail.abi = loses.detail.abi.filter((item) => !(item.type === "function" && item.name === NEXT_CHANGES.loses.signature.split("(")[0]));
  loses.facet.release = shared(files, loses.facet.name, loses.facet.release.salt, "fixture-next");

  const rebuilt = find(NEXT_CHANGES.rebuilt);
  rebuilt.facet.release = shared(files, rebuilt.facet.name, rebuilt.facet.release.salt, "fixture-next");
}

// ── provenance ─────────────────────────────────────────────────────────────────────────────────────

function provenance(fixture: Catalog, builds: Map<string, number>): unknown {
  return {
    note: "Where each fact in fixtures/catalog comes from. `real` facts cite Lattice at the pin; `invented` values are fake. Written by fixtures/gen/build.ts.",
    lattice: { commit: COMMIT, diamondLib: DIAMOND_LIB_COMMIT, version: VERSION, versionSource: VERSION_CITE },
    real: {
      inventory: `${INVENTORY_PATH}#L${lineOf(dir as string, INVENTORY_PATH, "string[100] memory n")}-L${inventoryEnd()}`,
      selectors: Object.fromEntries(fixture.facets.map((f) => [f.name, `${f.source}#L${builds.get(f.name)}`])),
      signatures: "The design prototype's signatures, each checked: keccak256(signature)[:4] equals the exported selector.",
      storage: "Namespaces from the prototype; slots computed with the ERC-7201 formula (R13) and found as constants in the source.",
      families: FAMILIES.map((f) => ({ family: f.family, facets: f.facets, source: cite(f.source) })),
      touchesOnly: TOUCHES_ONLY.map((t) => ({ facet: t.facet, namespace: t.namespace, source: cite(t.source) })),
      summaries: SUMMARIES.map((x) => ({ facet: x.facet, source: cite(x.source) })),
      after: INITS.flatMap((i) => (i.afterSource ? [{ name: i.name, after: i.after, source: cite(i.afterSource) }] : [])),
      requires: REQUIRES.map((r) => ({ facet: r.facet, anyOf: r.anyOf, strength: r.strength, source: cite(r.source) })),
      defaultOwnerOf: DEFAULT_OWNERS.map((d) => ({ facet: d.facet, selectors: d.selectors, source: cite(d.source) })),
      seams: SEAMS.map((s) => ({ selector: s.selector, when: s.when, anyOf: s.anyOf, source: cite(s.source) })),
      facetInits: FACET_INITS.map((i) => ({ facet: i.facet, init: i.init, source: cite(i.source) })),
      inits: INITS.map((i) => ({ name: i.name, source: cite(i.source) })),
      templates: TEMPLATES.map((t) => ({ name: t.name, cuts: cite(t.source) })),
      libraries: LIBRARIES.map((lib) => ({ name: lib.name, linkedBy: lib.linkedBy, source: cite(lib.source) })),
      releaseSalts: "script/deploy/DeployRelease.s.sol (facet salt L238, registry L94, factory L97)",
    },
    invented: [
      "lattice.tag (`fixture`, `fixture-next`)",
      "every creation code: the UTF-8 bytes of `fixture:<Name>` (`fixture-next:<Name>` for the rebuilt facet); initCodeHash and addresses follow from it by the real formulas",
      "every runtime codehash but Arachnid's proxy (whose real one C5b pins): keccak256(`fixture:<Name>:runtime`)",
      "json/Lattice.standard.json",
      "ABI state mutability (all `nonpayable`) and outputs (all empty); ABIs carry functions only, no errors or events",
      "examples marked `studio` (ERC20Init name_ and symbol_, SafeDiamondCutInit minThreshold)",
      "PoseidonT3's release (salt by the facet formula, fake code) and registryOwner (decision D6's placeholder 0x…dEaD)",
      "template recipes' catalog.hash (zero: an index can't hold its own hash)",
      "the DiamondCutFacet summary (its source NatSpec is OwnableFacet's)",
      "fixture-next's changes: EmergencyStop gains guardianCount() and Governor loses version(), both with new code; ERC20 gets new code with the same selectors",
    ],
    prototypeDifferences: [...notes],
  };
}

/** The line that closes the inventory's path array (`];` after `string[100] memory p`). */
function inventoryEnd(): number {
  const lines = readSource(dir as string, INVENTORY_PATH).split("\n");
  const p = lines.findIndex((l) => l.includes("string[100] memory p"));
  return lines.findIndex((l, i) => i > p && l.trim() === "];") + 1;
}

// ── write ──────────────────────────────────────────────────────────────────────────────────────────

function writeCatalog(id: string, built: Built): void {
  const root = join(OUT, id);
  rmSync(root, { recursive: true, force: true });
  for (const [path, bytes] of built.files) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), bytes);
  }
  writeFileSync(join(root, "index.json"), json(built.index));
  const checked = validateCatalog(JSON.parse(readFileSync(join(root, "index.json"), "utf8")));
  if (!checked.ok) throw new Error(`${id}/index.json: ${JSON.stringify(checked.error.slice(0, 5))}`);
  for (const f of built.index.facets) {
    const shard = validateFacetDetail(JSON.parse(readFileSync(join(root, f.detail.path), "utf8")));
    if (!shard.ok) throw new Error(`${id}/${f.detail.path}: ${JSON.stringify(shard.error.slice(0, 5))}`);
  }
}

const fixture = buildCatalog("fixture", false);
const fixtureNext = buildCatalog("fixture-next", true);
writeCatalog("fixture", fixture);
writeCatalog("fixture-next", fixtureNext);

const manifest: CatalogManifest = {
  default: "fixture",
  catalogs: [fixture, fixtureNext].map(({ index }) => ({
    id: index.lattice.tag,
    tag: index.lattice.tag,
    commit: index.lattice.commit,
    hash: index.hash,
    path: `${index.lattice.tag}/index.json`,
  })),
};
if (!validateCatalogManifest(manifest).ok) throw new Error("manifest.json doesn't validate");
writeFileSync(join(OUT, "manifest.json"), json(manifest));

const exportLines = new Map(inventory.map((e) => [e.name, readExportSelectors(dir, e.path).line]));
writeFileSync(join(OUT, "provenance.json"), json(provenance(fixture.index, exportLines)));

console.log(`fixture ${fixture.index.hash} · fixture-next ${fixtureNext.index.hash}`);
console.log(`${fixture.index.facets.length} facets · ${fixture.index.inits.length} inits · ${fixture.index.recipes.length} templates · ${fixture.index.seams.length} seams`);
for (const n of notes) console.log(`note: ${n}`);
console.log(`${unresolved.size} ABI entries without a unique declaration: ${[...unresolved].join(", ")}`);
