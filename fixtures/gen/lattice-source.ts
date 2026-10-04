/**
 * Reads Lattice's Solidity source text at the pin (never `forge` artifacts): the facet inventory, each facet's
 * `exportSelectors()` and the cuts a deploy script builds. The fixture generator and `validate.test.ts` share it,
 * so the fixture and its checks read Lattice the same way.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { toFunctionSelector } from "viem";
import type { Hex4 } from "../../packages/core/src/model/hex.ts";

/** The repo root (this file lives in `fixtures/gen/`). */
export const REPO_ROOT = join(import.meta.dir, "..", "..");

/** The Lattice checkout: `LATTICE_DIR` when set (claim and merge set it), else the repo's `lattice/` submodule. */
export function latticeDir(): string | null {
  const fromEnv = process.env["LATTICE_DIR"];
  for (const dir of [fromEnv, join(REPO_ROOT, "lattice")]) {
    if (dir && existsSync(join(dir, "script", "lib", "FacetInventory.sol"))) return dir;
  }
  return null;
}

export function readSource(dir: string, path: string): string {
  return readFileSync(join(dir, path), "utf8");
}

/** Where `FacetInventory` lives at the pin. */
export const INVENTORY_PATH = "script/lib/FacetInventory.sol";

export type InventoryEntry = {
  name: string;
  /** Repo-relative source path: `src/…` for Lattice, `lib/diamond-lib/src/facets/…` for diamond-lib's four. */
  path: string;
};

/** `FacetInventory.inventory()`: its (name, path) pairs, in inventory order, whatever the inventory's size. */
export function readInventory(dir: string): InventoryEntry[] {
  const text = readSource(dir, INVENTORY_PATH);
  const [namesPart, pathsPart, ...rest] = text.split(/string\[\d+\] memory p\b/);
  if (namesPart === undefined || pathsPart === undefined || rest.length > 0) throw new Error(`${INVENTORY_PATH}: unexpected layout`);
  const names = [...namesPart.matchAll(/^\s+"([A-Za-z0-9]+)",?$/gm)].map((m) => m[1] ?? "");
  const paths = [...pathsPart.matchAll(/^\s+"([^":]+):([A-Za-z0-9]+)",?$/gm)].map((m) => ({ file: m[1] ?? "", name: m[2] ?? "" }));
  if (names.length !== paths.length) throw new Error(`${INVENTORY_PATH}: ${names.length} names but ${paths.length} paths`);
  return names.map((name, i) => {
    const p = paths[i];
    if (!p || p.name !== name) throw new Error(`${INVENTORY_PATH}: entry ${i} is ${name} but its path names ${p?.name}`);
    // diamond-lib's facets are listed by artifact basename (FacetInventory.sol L234-L237).
    const path = p.file.startsWith("src/") ? p.file : `lib/diamond-lib/src/facets/${p.file}`;
    return { name, path };
  });
}

/**
 * A facet's `exportSelectors()` body: packed `hex"…"` literals (every Lattice facet) or
 * `abi.encodePacked(this.f.selector, …)` (diamond-lib's four), which only names the functions.
 */
export type ExportedSelectors =
  | { kind: "hex"; selectors: Hex4[]; line: number }
  | { kind: "names"; names: string[]; line: number };

export function readExportSelectors(dir: string, path: string): ExportedSelectors {
  const text = readSource(dir, path);
  const start = text.search(/function exportSelectors\(\)/);
  if (start < 0) throw new Error(`${path}: no exportSelectors()`);
  const line = text.slice(0, start).split("\n").length;
  const bodyStart = text.indexOf("{", start);
  const bodyEnd = text.indexOf("\n    }", bodyStart);
  const body = text.slice(bodyStart + 1, bodyEnd);
  const packed = [...body.matchAll(/hex"([0-9a-fA-F]*)"/g)].map((m) => m[1] ?? "").join("");
  if (packed) {
    if (packed.length % 8 !== 0) throw new Error(`${path}: exportSelectors() isn't whole selectors`);
    const selectors = (packed.match(/.{8}/g) ?? []).map((s) => `0x${s.toLowerCase()}` as Hex4);
    return { kind: "hex", selectors, line };
  }
  const names = [...body.matchAll(/\.([A-Za-z0-9_]+)\.selector/g)].map((m) => m[1] ?? "");
  if (names.length === 0) throw new Error(`${path}: exportSelectors() returns nothing readable`);
  return { kind: "names", names, line };
}

/** One cut a deploy script builds: the facet and the selectors `_cutExcept` drops from it. */
export type ScriptCut = { facet: string; except: Hex4[]; helper?: string };

/**
 * The cuts one function of a deploy script builds, in cut order. Reads `_cut(_facet("X"))`,
 * `_cut(address(new X()))`, `_cut(address(new X()), "X")` and `_cutExcept(_facet("X"), _helper())`, and each
 * helper's `bytes4(keccak256("sig"))` entries.
 */
export function readScriptCuts(dir: string, scriptPath: string, fn: string): ScriptCut[] {
  const text = readSource(dir, scriptPath);
  const body = functionBody(text, fn, scriptPath);
  const cuts: ScriptCut[] = [];
  for (const m of body.matchAll(/cuts\[\d+\]\s*=\s*(_cut|_cutExcept)\(([^;]*)\);/g)) {
    const call = m[1];
    const args = m[2] ?? "";
    const facet = /_facet\("([A-Za-z0-9]+)"\)/.exec(args)?.[1] ?? /new ([A-Za-z0-9]+)\(/.exec(args)?.[1];
    if (!facet) throw new Error(`${scriptPath}: can't read the facet in ${m[0]}`);
    if (call === "_cutExcept") {
      const helper = /,\s*(_[A-Za-z0-9]+)\(\)\s*$/.exec(args)?.[1];
      if (!helper) throw new Error(`${scriptPath}: can't read the exclusion helper in ${m[0]}`);
      cuts.push({ facet, except: readExclusions(text, helper, scriptPath), helper });
    } else {
      cuts.push({ facet, except: [] });
    }
  }
  return cuts;
}

function readExclusions(text: string, helper: string, scriptPath: string): Hex4[] {
  const body = functionBody(text, helper, scriptPath);
  return [...body.matchAll(/bytes4\(keccak256\("([^"]+)"\)\)/g)].map((m) => toFunctionSelector(`function ${m[1] ?? ""}`) as Hex4);
}

function functionBody(text: string, fn: string, file: string): string {
  const at = text.search(new RegExp(`function ${fn}\\(`));
  if (at < 0) throw new Error(`${file}: no function ${fn}`);
  const open = text.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(open + 1, i);
  }
  throw new Error(`${file}: function ${fn} never closes`);
}

/** One `function` declaration in a source file, as far as plain text shows it. */
export type Declaration = {
  name: string;
  params: { type: string; name: string }[];
  mutability: "pure" | "view" | "payable" | "nonpayable";
  returns: { type: string; name: string }[];
};

const ELEMENTARY = /^(?:u?int\d*|address|bool|bytes\d*|string)(?:\[\d*\])*$/;

/** True for a Solidity type the ABI names the same way (no struct, enum or contract type). */
export function isElementary(type: string): boolean {
  return ELEMENTARY.test(type);
}

function parseParams(list: string): { type: string; name: string }[] {
  if (!list.trim()) return [];
  return list.split(",").map((raw) => {
    const words = raw
      .trim()
      .split(/\s+/)
      .filter((w) => !["memory", "calldata", "storage", "payable", "indexed"].includes(w));
    return { type: words[0] ?? "", name: words[1] ?? "" };
  });
}

/** The `function` declarations in one file, with parameter names, mutability and return types. */
export function readDeclarations(dir: string, path: string): Declaration[] {
  const text = readSource(dir, path);
  const out: Declaration[] = [];
  for (const m of text.matchAll(/function\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)([^{;]*)/g)) {
    const tail = m[3] ?? "";
    const returns = /returns\s*\(([^)]*)\)/.exec(tail)?.[1] ?? "";
    const mutability = /\bpure\b/.test(tail) ? "pure" : /\bview\b/.test(tail) ? "view" : /\bpayable\b/.test(tail) ? "payable" : "nonpayable";
    out.push({ name: m[1] ?? "", params: parseParams(m[2] ?? ""), mutability, returns: parseParams(returns) });
  }
  return out;
}

/** The first 1-based line in `path` whose text contains `needle`, for `path#Lx` citations. */
export function lineOf(dir: string, path: string, needle: string): number {
  const lines = readSource(dir, path).split("\n");
  const i = lines.findIndex((l) => l.includes(needle));
  if (i < 0) throw new Error(`${path}: "${needle}" not found`);
  return i + 1;
}
