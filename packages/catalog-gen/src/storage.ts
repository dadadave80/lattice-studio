/**
 * Storage namespaces (spec L65 R13, L160-L161, L325-L326 STO checks; contracts §4 "Overlay semantics decided
 * 2026-09-23"): each facet's own ERC-7201 namespace and slot, and the namespaces its libraries write.
 *
 * A namespace's slot is never trusted from `STORAGE_REGISTRY.md` (drifted): it's read as a bare hex literal next
 * to a `/// @custom:storage-location erc7201:<id>`-annotated struct, and verified against
 * `keccak256(abi.encode(uint256(keccak256(id)) - 1)) & ~bytes32(uint256(0xff))`. The same file pattern also
 * carries diamond-lib's shared ERC-165 base and the `ERC165_MAP_*_SLOT` map entries every interface-registering
 * library hardcodes; those are verified with `keccak256(abi.encode(bytes4, base))`, never the ERC-7201 formula,
 * and never counted as anyone's own storage (that would raise STO-01 on every recipe).
 *
 * A facet's own namespace is the struct its own library (`<Name>Lib.sol`, found by import) annotates. Touches are
 * every other namespace reached by following library imports that are actually called, one library at a time.
 * Diamond-lib's three pass-through facets (DiamondCutFacet, DiamondLoupeFacet, OwnableFacet) call only into
 * diamond-lib's shared libraries and never own a namespace themselves; `diamond.lib.storage` goes in their
 * `touches`, per the overlay decision (contracts §4). ERC165Facet is diamond-lib's fourth basename entry, but it
 * owns `diamond.lib.storage.ERC165` in its own right (`ERC165Lib.sol` annotates it).
 */
import { dirname, join, normalize } from "node:path";
import { type Hex, type Hex4, err, ok, type Result } from "@lattice-studio/core";
import { encodeAbiParameters, keccak256, toBytes, toHex } from "viem";

/** Facets whose own library is diamond-lib's shared `DiamondLib`/`OwnableLib`: never their own storage (contracts §4). */
const DIAMOND_LIB_OVERRIDE: ReadonlySet<string> = new Set(["DiamondCutFacet", "DiamondLoupeFacet", "OwnableFacet"]);
/** What the override facets touch instead of owning. */
export const DIAMOND_LIB_STORAGE_ID = "diamond.lib.storage";

/** The known Lattice bug (ledger "For Lattice" #2, verified): waived, not reported as an error. */
export const WAIVED_SLOT = { file: "src/tokens/ERC20/libraries/ERC20VotesLib.sol", line: 23 } as const;

const U256_MASK = (1n << 256n) - 1n;
const LOW_BYTE_MASK = ~0xffn & U256_MASK;

/** `keccak256(abi.encode(uint256(keccak256(id)) - 1)) & ~bytes32(uint256(0xff))` (ERC-7201, spec R13). */
export function erc7201Slot(id: string): Hex {
  const idHash = BigInt(keccak256(toBytes(id)));
  const minusOne = (idHash - 1n) & U256_MASK;
  const encoded = encodeAbiParameters([{ type: "uint256" }], [minusOne]);
  return toHex(BigInt(keccak256(encoded)) & LOW_BYTE_MASK, { size: 32 }) as Hex;
}

/** `keccak256(abi.encode(bytes4, base))`: an ERC-165 support-map slot, never the ERC-7201 formula. */
export function erc165MapSlot(selector: Hex4, base: Hex): Hex {
  const encoded = encodeAbiParameters([{ type: "bytes4" }, { type: "bytes32" }], [selector, base]);
  return keccak256(encoded) as Hex;
}

/** 1-indexed line of a character offset. */
function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** One `@custom:storage-location erc7201:<id>`-annotated struct. */
export type NamespaceAnnotation = { id: string; file: string; line: number };

const ANNOTATION_RE = /@custom:storage-location\s+erc7201:([A-Za-z0-9_.]+)/g;

/** Every namespace annotation in a source file. */
export function findAnnotations(text: string, file: string): NamespaceAnnotation[] {
  const out: NamespaceAnnotation[] = [];
  for (const m of text.matchAll(ANNOTATION_RE)) {
    const id = m[1];
    if (id !== undefined) out.push({ id, file, line: lineOf(text, m.index) });
  }
  return out;
}

type Formula = { kind: "namespace"; id: string } | { kind: "map"; selector: Hex4; base: Hex } | undefined;

/** One `bytes32 constant NAME = 0x...;` declaration, and the formula its preceding comment documents, if any. */
export type SlotConstant = { file: string; line: number; name: string; declared: Hex; formula: Formula };

// Captures an optional same-line trailing `// 0xSELECTOR` comment too (group 3): one documented shape gives the
// selector there instead of in the formula itself (ERC7579ModuleConfigLib.sol's three, for example).
const CONST_RE =
  /bytes32\s+(?:internal\s+|private\s+|public\s+)?constant\s+([A-Za-z0-9_]+)\s*=\s*(0x[0-9a-fA-F]{64})\s*;[ \t]*(?:\/\/[ \t]*(0x[0-9a-fA-F]{8}))?/g;
// The full ERC-7201 wrapper (spec R13), not a bare `keccak256("...")` typehash or event signature comment.
const NAMESPACE_FORMULA_RE =
  /keccak256\(abi\.encode\(uint256\(keccak256\("([^"]+)"\)\)\s*-\s*1\)\)\s*&\s*~bytes32\(uint256\(0xff\)/;
// The ordinary shape: a literal selector and a literal 32-byte base, both inline.
const MAP_LITERAL_RE = /bytes4\(0x([0-9a-fA-F]{8})\)\s*,\s*(0x[0-9a-fA-F]{64})\s*\)\s*\)/;
// Three files (GovernedDiamondCutLib.sol, SafeDiamondCutLib.sol, AccessControlDiamondCutLib.sol) document a
// constant that mirrors DiamondLib's own, naming the base by its local alias instead of repeating the literal.
const MAP_SYMBOLIC_BASE_RE = /bytes4\(0x([0-9a-fA-F]{8})\)\s*,\s*[A-Za-z0-9_]*ERC165_STORAGE_LOCATION\s*\)\s*\)/;
// ERC6551AccountLib.sol's batched form (one header, several constants): `IERC6551Account = 0x6faff5f1;
// IERC6551Executable = 0x51945447.` Matched against the constant's own name (`middle`, below).
const NAME_SELECTOR_PAIR_RE = /([A-Za-z][A-Za-z0-9]*)\s*=\s*(0x[0-9a-fA-F]{8})/g;
// AccessManagerLib.sol's sparsest shape: no formula at all, just "`0x8fc52f86` is `type(IAccessManager).interfaceId`."
const INTERFACE_ID_SELECTOR_RE = /(0x[0-9a-fA-F]{8})[\s\S]*?interfaceId/i;

/** The base every `ERC165_MAP_*` slot derives from (diamond-lib's shared ERC-165 storage, spec R13). */
const ERC165_BASE: Hex = erc7201Slot("diamond.lib.storage.ERC165");

/** Names an `ERC165_MAP_*_SLOT` constant, even one `resolveFormula` can't classify, so nothing goes quiet. */
function looksLikeMapSlot(name: string): boolean {
  return /^_*ERC165_MAP_.+_SLOT$/i.test(name);
}

/** The interface-name fragment between `ERC165_MAP_` and `_SLOT`, for matching against a batched pairs comment. */
function mapSlotMiddle(name: string): string | undefined {
  return /^_*ERC165_MAP_(.+?)_SLOT$/i.exec(name)?.[1];
}

/**
 * The formula a slot constant's comment documents. `window` is this constant's own comment (precise, never
 * shared with a neighbor); `sharedWindow` extends back to the last *non-empty* comment when `window` is blank,
 * for the handful of constants documented once by a header several declarations up (ERC7579ModuleConfigLib.sol,
 * ERC6551AccountLib.sol) — used only by the name-keyed fallbacks below, which check the constant's own name
 * first, so a neighbor's unrelated formula in that wider text can never bleed onto the wrong constant.
 * `trailingSelector` is the same-line `// 0x...` comment `CONST_RE` may have captured.
 */
function resolveFormula(name: string, window: string, sharedWindow: string, trailingSelector: string | undefined): Formula {
  const literal = MAP_LITERAL_RE.exec(window);
  if (literal?.[1] !== undefined && literal[2] !== undefined) {
    return { kind: "map", selector: `0x${literal[1].toLowerCase()}` as Hex4, base: literal[2].toLowerCase() as Hex };
  }
  const symbolic = MAP_SYMBOLIC_BASE_RE.exec(window);
  if (symbolic?.[1] !== undefined) return { kind: "map", selector: `0x${symbolic[1].toLowerCase()}` as Hex4, base: ERC165_BASE };

  if (looksLikeMapSlot(name)) {
    if (trailingSelector !== undefined) {
      return { kind: "map", selector: trailingSelector.toLowerCase() as Hex4, base: ERC165_BASE };
    }
    const middle = mapSlotMiddle(name);
    if (middle !== undefined) {
      for (const pair of sharedWindow.matchAll(NAME_SELECTOR_PAIR_RE)) {
        if (pair[1]?.toUpperCase() === middle.toUpperCase() && pair[2] !== undefined) {
          return { kind: "map", selector: pair[2].toLowerCase() as Hex4, base: ERC165_BASE };
        }
      }
    }
    const bare = INTERFACE_ID_SELECTOR_RE.exec(window);
    if (bare?.[1] !== undefined) return { kind: "map", selector: bare[1].toLowerCase() as Hex4, base: ERC165_BASE };
  }

  const ns = NAMESPACE_FORMULA_RE.exec(window);
  if (ns?.[1] !== undefined) return { kind: "namespace", id: ns[1] };
  return undefined;
}

/**
 * Every bare hex slot constant in a source file, matched against the formula its comment documents. Ordinarily
 * that's the text between it and the previous constant, so each one reads only its own comment; when that's
 * blank, the name-keyed fallbacks in `resolveFormula` may instead reach back to the last comment that wasn't.
 */
export function findSlotConstants(text: string, file: string): SlotConstant[] {
  const out: SlotConstant[] = [];
  let lastEnd = 0;
  let headerStart = 0;
  for (const m of text.matchAll(CONST_RE)) {
    const name = m[1];
    const declared = m[2];
    if (name === undefined || declared === undefined) continue;
    const window = text.slice(lastEnd, m.index);
    if (window.trim() !== "") headerStart = lastEnd;
    const sharedWindow = text.slice(headerStart, m.index);
    lastEnd = m.index + m[0].length;
    out.push({
      file,
      line: lineOf(text, m.index),
      name,
      declared: declared.toLowerCase() as Hex,
      formula: resolveFormula(name, window, sharedWindow, m[3]),
    });
  }
  return out;
}

/** A slot constant whose declared value doesn't match its documented formula. */
export type SlotMismatch = {
  file: string;
  line: number;
  name: string;
  kind: "namespace" | "map";
  id?: string;
  declared: Hex;
  expected: Hex;
};

/** Renders a mismatch for the generator's report: `file:line: NAME = declared, expected expected (why).` */
export function describeMismatch(m: SlotMismatch): string {
  const why = m.kind === "namespace" ? `erc7201:${m.id}` : "ERC-165 support-map slot";
  return `${m.file}:${m.line}: ${m.name} = ${m.declared}, expected ${m.expected} (${why}).`;
}

/** id → where it's declared and its verified slot (contracts §4: a facet's own namespace, no two ever share one). */
export type NamespaceRegistry = ReadonlyMap<string, { file: string; line: number; slot: Hex }>;

export type StorageScan = {
  registry: NamespaceRegistry;
  /** Real errors: file and line, waiver excluded. */
  mismatches: SlotMismatch[];
  /** The known Lattice bug (`WAIVED_SLOT`), reported separately for the orchestrator's "For Lattice" list. */
  waived: SlotMismatch[];
  /** Two files annotate the same id (never true at the pin; kept as data, not a thrown error). */
  duplicateIds: string[];
  /**
   * An annotated id with no matching, correctly-formed slot constant in its own file (never true at the pin: a
   * struct with no verifiable slot would otherwise silently disappear as "no storage" instead of an error).
   */
  unverified: NamespaceAnnotation[];
  /**
   * A constant named like an ERC-165 support-map slot (`ERC165_MAP_*_SLOT`) whose comment `resolveFormula`
   * still couldn't classify: never true at the pin (every shape it takes there is covered), kept so a re-pin
   * that adds a new comment shape is caught instead of the constant going unverified in silence.
   */
  unclassified: SlotConstant[];
};

async function solFiles(latticeDir: string, root: string): Promise<string[]> {
  const glob = new Bun.Glob("**/*.sol");
  const out: string[] = [];
  try {
    for await (const p of glob.scan({ cwd: join(latticeDir, root), onlyFiles: true })) out.push(`${root}/${p}`);
  } catch {
    return []; // root doesn't exist; scanLatticeStorage reports it once, across both roots
  }
  return out.sort();
}

async function readCached(latticeDir: string, relPath: string, cache: Map<string, string>): Promise<string | undefined> {
  const cached = cache.get(relPath);
  if (cached !== undefined) return cached;
  const file = Bun.file(join(latticeDir, relPath));
  if (!(await file.exists())) return undefined;
  const text = await file.text();
  cache.set(relPath, text);
  return text;
}

/**
 * Scans every `.sol` file under `src/` and `lib/diamond-lib/src/` (the 90 storage-location annotations live only
 * there, never in `script/`) and verifies every namespace and ERC-165 map slot it finds.
 */
export async function scanLatticeStorage(
  latticeDir: string,
  cache: Map<string, string> = new Map(),
): Promise<Result<StorageScan, string>> {
  const files = [...(await solFiles(latticeDir, "src")), ...(await solFiles(latticeDir, "lib/diamond-lib/src"))];
  if (files.length === 0) return err(`no .sol files under ${latticeDir}/src or ${latticeDir}/lib/diamond-lib/src.`);

  const annotations: NamespaceAnnotation[] = [];
  const constants: SlotConstant[] = [];
  for (const file of files) {
    const text = await readCached(latticeDir, file, cache);
    if (text === undefined) continue;
    annotations.push(...findAnnotations(text, file));
    constants.push(...findSlotConstants(text, file));
  }

  const byId = new Map<string, NamespaceAnnotation>();
  const duplicateIds: string[] = [];
  for (const a of annotations) {
    const existing = byId.get(a.id);
    if (existing) duplicateIds.push(`${a.id} is annotated in both ${existing.file}:${existing.line} and ${a.file}:${a.line}.`);
    else byId.set(a.id, a);
  }

  const registry = new Map<string, { file: string; line: number; slot: Hex }>();
  const mismatches: SlotMismatch[] = [];
  const waived: SlotMismatch[] = [];
  for (const c of constants) {
    if (c.formula === undefined) continue;
    const expected = c.formula.kind === "namespace" ? erc7201Slot(c.formula.id) : erc165MapSlot(c.formula.selector, c.formula.base);
    const mismatch: SlotMismatch = {
      file: c.file,
      line: c.line,
      name: c.name,
      kind: c.formula.kind,
      declared: c.declared,
      expected,
      ...(c.formula.kind === "namespace" ? { id: c.formula.id } : {}),
    };
    if (expected.toLowerCase() !== c.declared.toLowerCase()) {
      if (c.file === WAIVED_SLOT.file && c.line === WAIVED_SLOT.line) waived.push(mismatch);
      else mismatches.push(mismatch);
    }
    if (c.formula.kind === "namespace") {
      const ann = byId.get(c.formula.id);
      if (ann !== undefined && ann.file === c.file) registry.set(c.formula.id, { file: c.file, line: c.line, slot: c.declared });
    }
  }

  const unverified = [...byId.values()].filter((a) => !registry.has(a.id));
  const unclassified = constants.filter((c) => c.formula === undefined && looksLikeMapSlot(c.name));

  return ok({ registry, mismatches, waived, duplicateIds, unverified, unclassified });
}

/** A path import resolves against, relative to the Lattice checkout root. */
function resolveImportPath(fromFile: string, importPath: string): string {
  if (importPath.startsWith("@lattice/")) return `src/${importPath.slice("@lattice/".length)}`;
  if (importPath.startsWith("@diamond/")) return `lib/diamond-lib/src/${importPath.slice("@diamond/".length)}`;
  return normalize(join(dirname(fromFile), importPath)).split("\\").join("/");
}

/** A library a file imports by name, resolved to the file it lives in. */
type LibRef = { symbol: string; file: string };

const IMPORT_RE = /import\s*\{([^}]+)\}\s*from\s*"([^"]+)";/g;

/** Every `...Lib` symbol a file imports (interfaces, structs and plain utilities are never namespace owners). */
function parseLibImports(text: string, file: string): LibRef[] {
  const out: LibRef[] = [];
  for (const m of text.matchAll(IMPORT_RE)) {
    const names = m[1];
    const importPath = m[2];
    if (names === undefined || importPath === undefined) continue;
    for (const raw of names.split(",")) {
      const name = (raw.split(/\s+as\s+/)[0] ?? "").trim();
      if (name.endsWith("Lib")) out.push({ symbol: name, file: resolveImportPath(file, importPath) });
    }
  }
  return out;
}

/** Just past the closing quote of the string literal opening at `start`, honoring backslash escapes. */
function stringEnd(text: string, start: number): number {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length) {
    const c = text[i];
    if (c === "\\") i += 2;
    else if (c === quote) return i + 1;
    else i++;
  }
  return text.length;
}

/**
 * `text` with every `//` and `/* *\/` comment blanked out (newlines kept, so line numbers of anything computed
 * from the result still line up), string literals left alone. A doc comment mentioning another library by name
 * — `EmergencyStopLib.sol:104`'s "(from AccessControlLib._grantRole)" — must never look like a call.
 */
export function stripComments(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '"' || c === "'") {
      const stop = stringEnd(text, i);
      out += text.slice(i, stop);
      i = stop;
    } else if (c === "/" && next === "/") {
      const end = text.indexOf("\n", i);
      const stop = end === -1 ? text.length : end;
      out += " ".repeat(stop - i);
      i = stop;
    } else if (c === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      out += text
        .slice(i, stop)
        .split("")
        .map((ch) => (ch === "\n" ? "\n" : " "))
        .join("");
      i = stop;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/**
 * `code` with every `import {...} from "...";` statement blanked (newlines kept). `isCalled` checks against
 * this, never against `code` itself: an import path such as `".../AccessControlLib.sol"` would otherwise
 * self-match `AccessControlLib.` as if it were a call, for every library any file ever imports.
 */
function blankImports(code: string): string {
  return code.replace(IMPORT_RE, (m) =>
    m
      .split("")
      .map((ch) => (ch === "\n" ? "\n" : " "))
      .join(""),
  );
}

/** Whether `symbol.` appears anywhere in the file's real code (a call, not just the import or a doc comment). */
function isCalled(callCode: string, symbol: string): boolean {
  return new RegExp(`\\b${symbol}\\.`).test(callCode);
}

/** Ids never counted as a touch: diamond-lib's shared bookkeeping is present in every diamond (contracts §4). */
const UNIVERSAL_IDS: ReadonlySet<string> = new Set([DIAMOND_LIB_STORAGE_ID, "diamond.lib.storage.ERC165"]);

/**
 * The symbol(s) a facet's own library would be imported as: `<Name>Lib`, and — only for diamond-lib's basename
 * facets, whose contract name carries a `Facet` suffix its library doesn't (`ERC165Facet` imports `ERC165Lib`) —
 * also `<Name minus "Facet">Lib`.
 */
function ownLibSymbols(facetName: string): string[] {
  const symbols = [`${facetName}Lib`];
  if (facetName.endsWith("Facet")) symbols.push(`${facetName.slice(0, -"Facet".length)}Lib`);
  return symbols;
}

/** `stripComments(text)`, cached per file so a library read by many facets is only stripped once. */
function strippedCode(text: string, file: string, strippedCache: Map<string, string>): string {
  const cached = strippedCache.get(file);
  if (cached !== undefined) return cached;
  const code = stripComments(text);
  strippedCache.set(file, code);
  return code;
}

/** Directly-called library refs in a file, filtered to real calls (not just types imported, or named in a doc). */
async function calledLibRefs(
  latticeDir: string,
  file: string,
  cache: Map<string, string>,
  strippedCache: Map<string, string>,
): Promise<LibRef[]> {
  const text = await readCached(latticeDir, file, cache);
  if (text === undefined) return [];
  const code = strippedCode(text, file, strippedCache);
  const callCode = blankImports(code);
  return parseLibImports(code, file).filter((r) => isCalled(callCode, r.symbol));
}

/** A facet's own namespace (its own library's, if it has one) and the namespaces its libraries write. */
export type FacetStorage = { storage?: { id: string; slot: Hex }; touches: string[] };

/**
 * Every facet's storage and touches in one pass (contracts §4, spec L160-L161), plus the cross-facet check
 * contracts §4 requires: no two share a `storage.id`.
 *
 * A facet's own namespace is the struct its own library (`<Name>Lib.sol`, found by import) annotates; touches are
 * the namespaces that library calls into directly — one hop, not the full call graph, so a facet never inherits
 * what a peer library it calls goes on to call itself. A facet with no library of its own (it delegates straight
 * into another facet's library, e.g. `ERC6900AccountView` into `ERC6900ModuleManagerLib`) instead touches that
 * library's namespace *and* everything that owning facet itself touches, since it's reading that facet's state
 * wholesale rather than routing through a peer. Diamond-lib's three pass-through facets (DiamondCutFacet,
 * DiamondLoupeFacet, OwnableFacet) own nothing and touch only `diamond.lib.storage` (contracts §4); ERC165Facet
 * is diamond-lib's fourth basename entry but owns `diamond.lib.storage.ERC165` in its own right.
 */
export async function allFacetStorage(
  latticeDir: string,
  facets: readonly { name: string; sourcePath: string }[],
  registry: NamespaceRegistry,
): Promise<Result<{ facets: Map<string, FacetStorage>; duplicateOwners: string[] }, string>> {
  const cache = new Map<string, string>();
  const strippedCache = new Map<string, string>();
  const fileToId = new Map<string, string>();
  for (const [id, info] of registry) fileToId.set(info.file, id);

  type Direct = { ownId?: string; ids: string[] }; // branch 1's own-library one-hop result
  type Pending = { name: string; contractRefs: LibRef[] };
  const direct = new Map<string, Direct>(); // facet name -> branch-1 result
  const ownFileToFacet = new Map<string, string>(); // own-lib file -> facet name (branch-1 only)
  const pending: Pending[] = []; // branch-2 facets, resolved once every branch-1 result is in

  for (const facet of facets) {
    if (DIAMOND_LIB_OVERRIDE.has(facet.name)) {
      direct.set(facet.name, { ids: [] });
      continue;
    }
    const contractText = await readCached(latticeDir, facet.sourcePath, cache);
    if (contractText === undefined) return err(`${facet.sourcePath} doesn't exist under ${latticeDir}.`);
    const contractCode = strippedCode(contractText, facet.sourcePath, strippedCache);
    const contractCallCode = blankImports(contractCode);
    const contractRefs = parseLibImports(contractCode, facet.sourcePath).filter((r) => isCalled(contractCallCode, r.symbol));
    const symbols = new Set(ownLibSymbols(facet.name));
    const own = contractRefs.find((r) => symbols.has(r.symbol));
    if (own === undefined) {
      pending.push({ name: facet.name, contractRefs });
      continue;
    }
    const ownId = fileToId.get(own.file);
    const hopRefs = await calledLibRefs(latticeDir, own.file, cache, strippedCache);
    const ids = new Set<string>();
    for (const ref of hopRefs) {
      const id = fileToId.get(ref.file);
      if (id !== undefined && id !== ownId && !UNIVERSAL_IDS.has(id)) ids.add(id);
    }
    direct.set(facet.name, { ...(ownId !== undefined ? { ownId } : {}), ids: [...ids] });
    ownFileToFacet.set(own.file, facet.name);
  }

  for (const { name, contractRefs } of pending) {
    const ids = new Set<string>();
    for (const ref of contractRefs) {
      const id = fileToId.get(ref.file);
      if (id !== undefined && !UNIVERSAL_IDS.has(id)) ids.add(id);
      const owner = ownFileToFacet.get(ref.file);
      if (owner !== undefined) for (const inherited of direct.get(owner)?.ids ?? []) ids.add(inherited);
    }
    direct.set(name, { ids: [...ids] });
  }

  const out = new Map<string, FacetStorage>();
  const ownerOfId = new Map<string, string>();
  const ownerOfSlot = new Map<Hex, string>();
  const duplicateOwners: string[] = [];
  for (const facet of facets) {
    const result = direct.get(facet.name);
    if (result === undefined) return err(`${facet.name}: no storage result computed.`);
    const touches = DIAMOND_LIB_OVERRIDE.has(facet.name)
      ? [DIAMOND_LIB_STORAGE_ID]
      : result.ids.filter((id) => id !== result.ownId).sort();
    if (result.ownId === undefined) {
      out.set(facet.name, { touches });
    } else {
      const info = registry.get(result.ownId);
      if (info === undefined) return err(`${facet.name}: owns erc7201:${result.ownId}, but it has no verified slot.`);
      out.set(facet.name, { storage: { id: result.ownId, slot: info.slot }, touches });
      const existingId = ownerOfId.get(result.ownId);
      if (existingId !== undefined) duplicateOwners.push(`erc7201:${result.ownId} is claimed by both ${existingId} and ${facet.name}.`);
      else ownerOfId.set(result.ownId, facet.name);
      const existingSlot = ownerOfSlot.get(info.slot);
      if (existingSlot !== undefined && existingSlot !== facet.name) {
        duplicateOwners.push(`slot ${info.slot} is claimed by both ${existingSlot} and ${facet.name}.`);
      } else {
        ownerOfSlot.set(info.slot, facet.name);
      }
    }
  }
  return ok({ facets: out, duplicateOwners });
}
