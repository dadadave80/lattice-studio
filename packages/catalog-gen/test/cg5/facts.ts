/**
 * What the lint checks the real overlay against, read from a Lattice checkout at the pin (tests and authoring
 * only; `bun run catalog` passes CG1's and CG4's own results).
 *
 * - Facets: the fixture catalog's 105 facets (names, areas and selectors, which K3 checks against the source),
 *   with each summary from the contract's NatSpec: solc's metadata when the checkout is built, else the source.
 * - Inits: every init contract in `src/**` and diamond-lib's initializers (DiamondInit excluded, which Lattice
 *   can't use), one per usable external function (EIP-7702-only ones left out); params with types, components and `@param` docs from the build.
 * - Modules: every `__X_init` defined in the checkout, plus `Ownable` (OwnableLib.initializeOwner).
 * - `registersInterfaces`: the init's own file calls `DiamondLib.registerInterface()`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { Area, Catalog } from "@lattice-studio/core";
import { findArtifact } from "../../src/artifacts";
import { cleanDoc, natspecSummary } from "../../src/natspec";
import type { KnownParam, LintFacts } from "../../src/overlay-lint";

export const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");

/** `LATTICE_DIR`, else the repo's `lattice/`, when it's a checkout. */
export function latticeDir(): string | null {
  for (const dir of [process.env["LATTICE_DIR"], join(REPO_ROOT, "lattice")]) {
    if (dir && existsSync(join(dir, "script", "lib", "FacetInventory.sol"))) return dir;
  }
  return null;
}

export function fixtureCatalog(): Catalog {
  return JSON.parse(readFileSync(join(REPO_ROOT, "fixtures", "catalog", "fixture", "index.json"), "utf8")) as Catalog;
}

/** A source path's area: `src/<area>/…`; diamond-lib and `src/*.sol` are `diamond`. */
export function areaOf(path: string): Area {
  const m = /^src\/([a-z]+)\//.exec(path);
  return (m?.[1] ?? "diamond") as Area;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".sol")) out.push(p);
  }
  return out;
}

/** Init contracts at the pin: `{ contract, path }`, path relative to the checkout. */
export function initContracts(dir: string): { contract: string; path: string }[] {
  const files = [...walk(join(dir, "src")), ...walk(join(dir, "lib", "diamond-lib", "src", "initializers"))];
  const out: { contract: string; path: string }[] = [];
  for (const file of files) {
    for (const m of readFileSync(file, "utf8").matchAll(/^contract (\w*Init\w*)\b/gm)) {
      const contract = m[1] ?? "";
      if (contract !== "DiamondInit") out.push({ contract, path: relative(dir, file) });
    }
  }
  return out.sort((a, b) => (a.contract < b.contract ? -1 : 1));
}

/** The contract-level `@notice` in the source, first sentence (the no-build fallback for `natspecSummary`). */
function sourceNotice(text: string, contract: string): string | undefined {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => new RegExp(`^(abstract )?contract ${contract}\\b`).test(l));
  if (at < 0) return undefined;
  const doc: string[] = [];
  for (let i = at - 1; i >= 0 && /^\s*\/\/\//.test(lines[i] ?? ""); i--) doc.unshift((lines[i] ?? "").replace(/^\s*\/\/\/\s?/, ""));
  const tags = doc.join("\n").split(/\n(?=@)/);
  const notice = tags.find((t) => t.startsWith("@notice"));
  if (notice === undefined) return undefined;
  const clean = cleanDoc(notice.slice("@notice".length));
  return clean === undefined ? undefined : (/^(.*?[.!?])(?:\s+(?=[A-Z`{])|$)/.exec(clean)?.[1] ?? clean);
}

type AbiParam = { name: string; type: string; components?: AbiParam[] };
type AbiFunction = { type: "function"; name: string; inputs: AbiParam[]; stateMutability: string };

function knownParam(p: AbiParam, docs: Record<string, string> | undefined): KnownParam {
  const doc = cleanDoc(docs?.[p.name]);
  const out: KnownParam = { name: p.name, type: p.type };
  if (doc !== undefined) out.doc = doc;
  if (p.components !== undefined) out.components = p.components.map((c) => knownParam(c, undefined));
  return out;
}

function canonicalType(p: AbiParam): string {
  if (!p.type.startsWith("tuple")) return p.type;
  return `(${(p.components ?? []).map(canonicalType).join(",")})${p.type.slice("tuple".length)}`;
}

/** External or public functions in an init's source, with elementary params and their `@param` docs. */
function sourceFunctions(text: string): { name: string; params: KnownParam[] }[] {
  const out: { name: string; params: KnownParam[] }[] = [];
  for (const m of text.matchAll(/((?:[ \t]*\/\/\/.*\n)*)[ \t]*function (\w+)\(([^)]*)\)\s+(?:external|public)/g)) {
    const docs: Record<string, string> = {};
    for (const d of (m[1] ?? "").matchAll(/@param (\w+) (.*)/g)) docs[d[1] ?? ""] = d[2] ?? "";
    const params = (m[3] ?? "")
      .split(",")
      .map((p) => p.trim().split(/\s+/).filter((w) => w !== "memory" && w !== "calldata"))
      .filter((w) => w.length === 2)
      .map(([type = "", name = ""]) => knownParam({ name, type }, docs));
    out.push({ name: m[2] ?? "", params });
  }
  return out;
}

/**
 * Entry points no Studio diamond can use (contracts §3.1 "Multi-entry-point naming, refined"): AccountInit's
 * `init7702` is EIP-7702-only, and a factory diamond is never delegated (R7). An init with one usable entry point
 * keeps its plain contract name.
 */
const EIP7702_ONLY = new Set(["init7702"]);

/** Line counts of files in the checkout, cached. */
export function lineCounter(dir: string): (path: string) => number | undefined {
  const cache = new Map<string, number | undefined>();
  return (path) => {
    if (!cache.has(path)) {
      const file = join(dir, path);
      cache.set(path, existsSync(file) && statSync(file).isFile() ? readFileSync(file, "utf8").split("\n").length : undefined);
    }
    return cache.get(path);
  };
}

/** The facts for a checkout; init params need a build (`out/`), everything else reads the source. */
export async function latticeFacts(dir: string): Promise<LintFacts & { built: boolean }> {
  const catalog = fixtureCatalog();
  const out = join(dir, "out");
  const built = existsSync(out);

  const facets: LintFacts["facets"] = [];
  for (const f of catalog.facets) {
    let summary: string | undefined;
    if (built) {
      const base = f.source.slice(f.source.lastIndexOf("/") + 1);
      const a = await findArtifact(out, { file: base, contract: f.name, sourcePath: f.source });
      if (a.ok) summary = natspecSummary(a.value.metadata);
    } else {
      summary = sourceNotice(readFileSync(join(dir, f.source), "utf8"), f.name);
    }
    facets.push({ name: f.name, area: f.area, selectors: f.selectors.map((s) => s.hex), ...(summary ? { summary } : {}) });
  }

  const inits: NonNullable<LintFacts["inits"]> = [];
  for (const { contract, path } of initContracts(dir)) {
    const text = readFileSync(join(dir, path), "utf8");
    const registersInterfaces = /DiamondLib\.registerInterface\(/.test(text);
    const area = path.startsWith("lib/") ? "diamond" : areaOf(path);
    const base = path.slice(path.lastIndexOf("/") + 1);
    const a = built ? await findArtifact(out, { file: base, contract, sourcePath: path }) : undefined;
    if (a === undefined || !a.ok) {
      // Not compiled by the ci profile (diamond-lib's OwnableInit and ERC165Init) or not built: read the source.
      const fns = sourceFunctions(text).filter((fn) => !EIP7702_ONLY.has(fn.name));
      for (const fn of fns) {
        inits.push({ name: fns.length > 1 ? `${contract}.${fn.name}` : contract, area, ...(built ? { params: fn.params } : {}), registersInterfaces });
      }
      continue;
    }
    const fns = (a.value.abi as unknown as AbiFunction[]).filter(
      (x) => x.type === "function" && x.stateMutability !== "view" && x.stateMutability !== "pure" && !EIP7702_ONLY.has(x.name),
    );
    for (const fn of fns) {
      const signature = `${fn.name}(${fn.inputs.map(canonicalType).join(",")})`;
      const docs = a.value.metadata.output.devdoc.methods?.[signature]?.params;
      inits.push({
        name: fns.length > 1 ? `${contract}.${fn.name}` : contract,
        area,
        params: fn.inputs.map((p) => knownParam(p, docs)),
        registersInterfaces,
      });
    }
  }

  const modules = new Set<string>(["Ownable"]);
  for (const file of [...walk(join(dir, "src")), ...walk(join(dir, "lib", "diamond-lib", "src"))]) {
    for (const m of readFileSync(file, "utf8").matchAll(/function __(\w+)_init\(/g)) modules.add(m[1] ?? "");
  }

  return { facets, inits, modules: [...modules].sort(), sourceLines: lineCounter(dir), built };
}
