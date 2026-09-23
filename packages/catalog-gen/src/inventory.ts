/**
 * The facet inventory: Lattice's own list of releasable facets (spec L70, R18), read from
 * `script/lib/FacetInventory.sol` at the pin. The catalog is exactly this list, in this order.
 *
 * `readFacets` puts CG1 together: inventory, artifacts, and the selectors each facet's `exportSelectors()`
 * returns on Anvil, checked against the artifact's `methodIdentifiers`.
 */
import { join } from "node:path";
import { err, ok, type Result } from "@lattice-studio/core";
import type { AnvilHandle } from "./anvil";
import { deployViaArachnid, readExportSelectors } from "./anvil";
import {
  type Artifact,
  type ArtifactRef,
  checkSelectors,
  type FacetSelector,
  findArtifact,
  linkBytecode,
  type SelectorMismatch,
} from "./artifacts";

/** Where the inventory lives inside a Lattice checkout. */
export const INVENTORY_PATH = "script/lib/FacetInventory.sol";

/** One inventory entry, as `FacetInventory.inventory()` pairs it. */
export type InventoryEntry = {
  /** Contract name, which is also the registry name: "ERC20". */
  name: string;
  /** The `vm.getCode` path as written: "src/tokens/ERC20/ERC20.sol:ERC20" or "DiamondCutFacet.sol:DiamondCutFacet". */
  artifact: string;
  /** The source file part of `artifact`: "src/tokens/ERC20/ERC20.sol", or a bare basename for diamond-lib's four. */
  file: string;
  /** True for the diamond-lib entries written as basenames (`FacetInventory.sol:224-227`). */
  basename: boolean;
};

const ARRAY_LITERAL = /string\s*\[\s*(\d+)\s*\]\s+memory\s+(\w+)\s*=\s*\[([\s\S]*?)\]\s*;/g;
const STRING_LITERAL = /"((?:[^"\\]|\\.)*)"/g;

/**
 * Just past the closing quote of the string literal that opens at `start`, honoring backslash escapes the way
 * `STRING_LITERAL` does: `"a\"b"` is one string.
 */
function stringEnd(source: string, start: number): number {
  const quote = source[start];
  let i = start + 1;
  while (i < source.length) {
    const c = source[i];
    if (c === "\\") i += 2;
    else if (c === quote) return i + 1;
    else i++;
  }
  return source.length;
}

/** Drops `//` and `/* *\/` comments, leaving string literals (either quote, escapes included) alone. */
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '"' || c === "'") {
      const stop = stringEnd(source, i);
      out += source.slice(i, stop);
      i = stop;
    } else if (c === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      i = end === -1 ? source.length : end;
    } else if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/**
 * Parses `FacetInventory.sol` into its ordered entries. The file holds two fixed-size string array literals
 * in `inventory()`: names, and `"<file>:<Name>"` paths, index-aligned. Every check the Solidity relies on is
 * made here too: equal lengths that match the declared size, each path naming its entry, no duplicates.
 */
export function parseInventory(source: string): Result<InventoryEntry[], string> {
  const arrays: { size: number; id: string; items: string[] }[] = [];
  for (const m of stripComments(source).matchAll(ARRAY_LITERAL)) {
    const items = [...(m[3] ?? "").matchAll(STRING_LITERAL)].map((s) => s[1] ?? "");
    arrays.push({ size: Number(m[1]), id: m[2] ?? "", items });
  }
  if (arrays.length !== 2) {
    return err(`${INVENTORY_PATH}: expected 2 string array literals (names and paths), found ${arrays.length}.`);
  }
  for (const a of arrays) {
    if (a.items.length !== a.size) {
      return err(`${INVENTORY_PATH}: array ${a.id} declares ${a.size} entries but lists ${a.items.length}.`);
    }
  }
  const [first, second] = arrays as [(typeof arrays)[0], (typeof arrays)[0]];
  const firstIsPaths = first.items.every((s) => s.includes(":"));
  const names = firstIsPaths ? second : first;
  const paths = firstIsPaths ? first : second;
  if (!paths.items.every((s) => s.includes(":")) || names.items.some((s) => s.includes(":"))) {
    return err(`${INVENTORY_PATH}: couldn't tell the names array from the paths array.`);
  }
  if (names.items.length !== paths.items.length) {
    return err(`${INVENTORY_PATH}: ${names.items.length} names but ${paths.items.length} paths.`);
  }

  const seen = new Set<string>();
  const entries: InventoryEntry[] = [];
  for (const [i, name] of names.items.entries()) {
    const artifact = paths.items[i] ?? "";
    const colon = artifact.lastIndexOf(":");
    const file = artifact.slice(0, colon);
    const contract = artifact.slice(colon + 1);
    if (contract !== name) {
      return err(`${INVENTORY_PATH}: entry ${i} is named ${name} but its path "${artifact}" names ${contract}.`);
    }
    if (!file.endsWith(".sol")) {
      return err(`${INVENTORY_PATH}: entry ${name} has path "${artifact}", which doesn't name a .sol file.`);
    }
    if (seen.has(name)) return err(`${INVENTORY_PATH}: ${name} is listed twice.`);
    seen.add(name);
    entries.push({ name, artifact, file, basename: !file.includes("/") });
  }
  return ok(entries);
}

/** Reads and parses the inventory of a Lattice checkout. */
export async function readInventory(latticeDir: string): Promise<Result<InventoryEntry[], string>> {
  const file = Bun.file(join(latticeDir, INVENTORY_PATH));
  if (!(await file.exists())) return err(`${join(latticeDir, INVENTORY_PATH)} doesn't exist.`);
  return parseInventory(await file.text());
}

/** The artifact reference for an entry: its source basename and contract name, plus the full path when known. */
export function entryRef(entry: InventoryEntry): ArtifactRef {
  const base = entry.file.slice(entry.file.lastIndexOf("/") + 1);
  return entry.basename
    ? { file: base, contract: entry.name }
    : { file: base, contract: entry.name, sourcePath: entry.file };
}

/** What Lattice says about one facet at the pin. */
export type FacetFacts = {
  name: string;
  /** Source path from the artifact's metadata (`compilationTarget`), e.g. "lib/diamond-lib/src/facets/DiamondCutFacet.sol". */
  source: string;
  artifact: Artifact;
  /** `exportSelectors()` in the facet's own order, minus 0x0ef22643, each with its ABI signature. */
  selectors: FacetSelector[];
  /** Differences between the export and `methodIdentifiers`; empty at the pin. */
  mismatches: SelectorMismatch[];
};

/** Reads every artifact of the inventory, in inventory order. */
export async function readInventoryArtifacts(
  latticeDir: string,
  entries: InventoryEntry[],
): Promise<Result<{ entry: InventoryEntry; artifact: Artifact }[], string>> {
  const out: { entry: InventoryEntry; artifact: Artifact }[] = [];
  for (const entry of entries) {
    const found = await findArtifact(join(latticeDir, "out"), entryRef(entry));
    if (!found.ok) return err(`${entry.name}: ${found.error}`);
    out.push({ entry, artifact: found.value });
  }
  return ok(out);
}

/**
 * Inventory, artifacts and live selectors for a built Lattice checkout. Deploys each facet (and any library it
 * links, such as PoseidonT3) through Arachnid's proxy on the given Anvil, calls `exportSelectors()`, drops
 * 0x0ef22643 and checks the rest against `methodIdentifiers`.
 */
export async function readFacets(latticeDir: string, anvil: AnvilHandle): Promise<Result<FacetFacts[], string>> {
  const inventory = await readInventory(latticeDir);
  if (!inventory.ok) return inventory;
  const artifacts = await readInventoryArtifacts(latticeDir, inventory.value);
  if (!artifacts.ok) return artifacts;

  const libraries = new Map<string, `0x${string}`>();
  const facts: FacetFacts[] = [];
  for (const { entry, artifact } of artifacts.value) {
    const linked = await linkFor(latticeDir, anvil, artifact, libraries);
    if (!linked.ok) return err(`${entry.name}: ${linked.error}`);
    const deployed = await deployViaArachnid(anvil, linked.value);
    if (!deployed.ok) return err(`${entry.name}: ${deployed.error}`);
    const exported = await readExportSelectors(anvil, deployed.value);
    if (!exported.ok) return err(`${entry.name}: ${exported.error}`);
    const checked = checkSelectors(entry.name, exported.value, artifact);
    facts.push({ name: entry.name, source: artifact.sourcePath, artifact, ...checked });
  }
  return ok(facts);
}

/** Creation code with every linked library deployed through Arachnid's proxy (salt zero) and its address filled in. */
async function linkFor(
  latticeDir: string,
  anvil: AnvilHandle,
  artifact: Artifact,
  libraries: Map<string, `0x${string}`>,
): Promise<Result<`0x${string}`, string>> {
  const refs = artifact.bytecode.linkReferences;
  for (const [file, libs] of Object.entries(refs)) {
    for (const lib of Object.keys(libs)) {
      const key = `${file}:${lib}`;
      if (libraries.has(key)) continue;
      const base = file.slice(file.lastIndexOf("/") + 1);
      const libArtifact = await findArtifact(join(latticeDir, "out"), { file: base, contract: lib, sourcePath: file });
      if (!libArtifact.ok) return err(`linked library ${key}: ${libArtifact.error}`);
      const libCode = await linkFor(latticeDir, anvil, libArtifact.value, libraries);
      if (!libCode.ok) return libCode;
      const at = await deployViaArachnid(anvil, libCode.value);
      if (!at.ok) return err(`linked library ${key}: ${at.error}`);
      libraries.set(key, at.value);
    }
  }
  return linkBytecode(artifact.bytecode.object, refs, Object.fromEntries(libraries));
}
