/**
 * Init contracts (spec L175-L191, contracts §3.1): every init Lattice ships in `src/**` plus diamond-lib's
 * `MultiInit`, `ERC165Init` and `OwnableInit`, as InitSpec skeletons read from the ci build, then completed by
 * the overlay (contracts §4). diamond-lib's `DiamondInit` is skipped: Lattice can't use it, because it registers
 * both ERC-165 flags and sets an Ownable owner unconditionally (`DiamondIntrospectionInit.sol:16-18`).
 *
 * What the source states comes from the build: the entry points (one InitSpec per entry point, named
 * `<Contract>.<fn>` when a contract has several), parameter types with tuple components, NatSpec docs,
 * constructor arguments, every `__X_init` the init runs (`initializes`, following calls through the libraries)
 * and whether the init itself sets the diamond's ERC-165 flags (`registersInterfaces`). Calls are followed
 * through each artifact's own AST, and across files by name through the import directives, never by AST id:
 * two build jobs number their nodes independently, and the diamond-lib inits come from a second job.
 */
import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { err, type Hex4, type InitParam, type InitSpec, type Json, ok, type Result } from "@lattice-studio/core";
import type { AbiParameter } from "viem";
import { type Artifact, parseArtifact } from "./artifacts";
import { cleanDoc } from "./natspec";

// ── what counts as an init ─────────────────────────────────────────────────────────────────────────

/** diamond-lib's initializers the catalog carries. No Lattice source imports the last two, so the ci build skips them. */
export const DIAMOND_LIB_INITS = [
  "lib/diamond-lib/src/initializers/MultiInit.sol",
  "lib/diamond-lib/src/initializers/ERC165Init.sol",
  "lib/diamond-lib/src/initializers/OwnableInit.sol",
] as const;

/** Init contracts left out on purpose, with the reason. */
export const SKIPPED_INITS: Record<string, string> = {
  DiamondInit: "registers both ERC-165 flags and sets an Ownable owner unconditionally (DiamondIntrospectionInit.sol:16-18)",
};

/** Lattice's init sources: `*Init*.sol` under `src/`. `Initializable.sol` matches the glob but holds no init. */
export const LATTICE_INIT_GLOB = "src/**/*Init*.sol";

/** A contract name that reads as an init: `ERC20Init`, `AccountInit6900`. */
const INIT_NAME = /Init\d*$/;

/** The forge command that compiles diamond-lib's initializers the ci build leaves out, run in the Lattice checkout. */
export function supplementaryBuildCommand(latticeDir: string): string[] {
  return ["forge", "build", "--root", latticeDir, ...DIAMOND_LIB_INITS];
}

/**
 * Compiles diamond-lib's initializers with the ci profile (build output only; the checkout is otherwise untouched).
 * CG8 runs it after the main build; `readInits` refuses to guess when their artifacts are missing.
 */
export async function buildSupplementaryInits(latticeDir: string): Promise<Result<void, string>> {
  const cmd = supplementaryBuildCommand(latticeDir);
  const proc = Bun.spawn(cmd, { env: { ...process.env, FOUNDRY_PROFILE: "ci" }, stdout: "ignore", stderr: "pipe" });
  if ((await proc.exited) !== 0) {
    return err(`FOUNDRY_PROFILE=ci ${cmd.join(" ")} failed: ${(await new Response(proc.stderr).text()).trim()}`);
  }
  return ok(undefined);
}

// ── output ─────────────────────────────────────────────────────────────────────────────────────────

/** An InitSpec before CG2 adds `release` (stateless inits only). */
export type InitSkeleton = Omit<InitSpec, "release">;

/** One entry point of an init contract, as the source states it. */
export type InitFacts = {
  spec: InitSkeleton;
  selector: Hex4;
  /** "src/defi/VaultCoreInit.sol". */
  sourcePath: string;
  /** The entry point's lines at the pin: "src/defi/VaultCoreInit.sol#L24-L32". */
  source: string;
  artifact: Artifact;
};

// ── AST access (solc's compact JSON, read loosely) ─────────────────────────────────────────────────

/** A solc AST node. Only `nodeType` is certain; everything else is read through the helpers below. */
export type AstNode = { nodeType: string; id?: number; src?: string; name?: string; [key: string]: unknown };

function isNode(v: unknown): v is AstNode {
  return typeof v === "object" && v !== null && typeof (v as { nodeType?: unknown }).nodeType === "string";
}

function child(n: AstNode, key: string): AstNode | undefined {
  const v = n[key];
  return isNode(v) ? v : undefined;
}

function children(n: AstNode, key: string): AstNode[] {
  const v = n[key];
  return Array.isArray(v) ? v.filter(isNode) : [];
}

function str(n: AstNode, key: string): string | undefined {
  const v = n[key];
  return typeof v === "string" ? v : undefined;
}

function num(n: AstNode, key: string): number | undefined {
  const v = n[key];
  return typeof v === "number" ? v : undefined;
}

/** Every node below `n` (not `n` itself), depth first, in source order. */
function descendants(n: AstNode): AstNode[] {
  const out: AstNode[] = [];
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const x of v) visit(x);
    } else if (isNode(v)) {
      out.push(v);
      for (const [k, x] of Object.entries(v)) if (k !== "typeDescriptions") visit(x);
    } else if (typeof v === "object" && v !== null) {
      for (const x of Object.values(v)) visit(x);
    }
  };
  for (const [k, x] of Object.entries(n)) if (k !== "typeDescriptions") visit(x);
  return out;
}

/** `start:length:file` → byte range. */
function range(n: AstNode): { start: number; end: number } | undefined {
  const m = /^(\d+):(\d+):/.exec(n.src ?? "");
  if (!m) return undefined;
  const start = Number(m[1]);
  return { start, end: start + Number(m[2]) };
}

/** One source file: its AST (from any artifact of that file), an id index and its bytes. */
export type Unit = { path: string; ast: AstNode; byId: Map<number, AstNode>; bytes: Buffer };

/** Builds a unit from a SourceUnit AST and the file's bytes. */
export function makeUnit(path: string, ast: AstNode, bytes: Buffer): Unit {
  const byId = new Map<number, AstNode>();
  for (const n of [ast, ...descendants(ast)]) if (typeof n.id === "number") byId.set(n.id, n);
  return { path, ast, byId, bytes };
}

/** Source text of a node. `src` offsets are bytes, and Lattice's comments are full of em dashes. */
function text(unit: Unit, n: AstNode): string {
  const r = range(n);
  return r ? unit.bytes.subarray(r.start, r.end).toString("utf8") : "";
}

/** 1-based line of a byte offset. */
function lineAt(bytes: Buffer, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < bytes.length; i++) if (bytes[i] === 0x0a) line++;
  return line;
}

/** Loads source units by path. Tests pass a map; `readInits` reads artifacts from `out/`. */
export type UnitLoader = (path: string) => Promise<Unit | undefined>;

// ── resolving names across files ───────────────────────────────────────────────────────────────────

type Found = { unit: Unit; decl: AstNode };

/**
 * Finds the top-level declaration a file sees as `name`: declared in the file, or imported (with or without
 * aliases, following `import "x.sol"` transitively).
 */
async function resolveName(unit: Unit, name: string, load: UnitLoader, seen = new Set<string>()): Promise<Found | undefined> {
  if (seen.has(unit.path)) return undefined;
  seen.add(unit.path);
  for (const n of children(unit.ast, "nodes")) {
    if (n.nodeType !== "ImportDirective" && n.name === name) return { unit, decl: n };
  }
  for (const imp of children(unit.ast, "nodes")) {
    if (imp.nodeType !== "ImportDirective") continue;
    const path = str(imp, "absolutePath");
    if (path === undefined) continue;
    const aliases = Array.isArray(imp.symbolAliases) ? (imp.symbolAliases as { foreign?: unknown; local?: unknown }[]) : [];
    if (aliases.length > 0) {
      for (const a of aliases) {
        const foreign = isNode(a.foreign) ? a.foreign.name : undefined;
        const local = typeof a.local === "string" ? a.local : foreign;
        if (local !== name || foreign === undefined) continue;
        const target = await load(path);
        return target ? resolveName(target, foreign, load, seen) : undefined;
      }
    } else if ((str(imp, "unitAlias") ?? "") === "") {
      const target = await load(path);
      const found = target ? await resolveName(target, name, load, seen) : undefined;
      if (found) return found;
    }
  }
  return undefined;
}

/** `function (address,string memory)` from a call's type, and the same from a definition's parameters. */
function typeString(n: AstNode): string | undefined {
  const ts = n.typeDescriptions;
  const v = typeof ts === "object" && ts !== null ? (ts as { typeString?: unknown }).typeString : undefined;
  return typeof v === "string" ? v : undefined;
}

function paramsOf(fn: AstNode): AstNode[] {
  const list = child(fn, "parameters");
  return list ? children(list, "parameters") : [];
}

function paramTypes(fn: AstNode): string {
  return paramsOf(fn)
    .map((p) => typeString(p) ?? "")
    .join(",");
}

function callTypes(expr: AstNode): string | undefined {
  return /^function \((.*?)\)/.exec(typeString(expr) ?? "")?.[1];
}

/** The function `member` of a contract or library, matched by name and, among overloads, by parameter types. */
function memberFunction(contract: AstNode, member: string, types: string | undefined): AstNode | undefined {
  const fns = children(contract, "nodes").filter((n) => n.nodeType === "FunctionDefinition" && n.name === member);
  if (fns.length <= 1 || types === undefined) return fns[0];
  return fns.find((f) => paramTypes(f) === types) ?? fns[0];
}

// ── walking an entry point ─────────────────────────────────────────────────────────────────────────

type Initialized = InitSkeleton["initializes"][number];

type Scope = {
  unit: Unit;
  /** Parameters of the function being walked (ids in `unit`) → the caller's rendering of the argument. */
  bindings: Map<number, string>;
  /** The function being walked, for folding locals. */
  fn: AstNode;
  /** The enclosing contract, for immutables set in the constructor. */
  contract: AstNode | undefined;
  /** True while walking the init contract's own code; calls found inside libraries don't set `registersInterfaces`. */
  own: boolean;
  depth: number;
};

type Walk = { initializes: Initialized[]; registers: boolean; load: UnitLoader; notes: string[] };

const MODULE_INIT = /^__([A-Za-z0-9]+)_init$/;
const MAX_DEPTH = 24;

/** Module parameter name as the catalog keys it: `asset_` → `asset`, `_owner` → `owner`. */
export function withKey(param: string): string {
  return param.replace(/^_+|_+$/g, "") || param;
}

/** Renders an argument the way `initializes[].with` shows it: init parameters, member paths, literal values. */
function render(expr: AstNode, scope: Scope): string {
  if (expr.nodeType === "Literal") {
    const kind = str(expr, "kind");
    const value = str(expr, "value");
    if ((kind === "string" || kind === "unicodeString") && value !== undefined) return value;
    return text(scope.unit, expr);
  }
  if (expr.nodeType === "Identifier") return renderIdentifier(expr, scope) ?? text(scope.unit, expr);
  // Splice resolved identifiers into the expression's own text.
  const base = range(expr);
  if (!base) return text(scope.unit, expr);
  const edits: { start: number; end: number; value: string }[] = [];
  for (const n of descendants(expr)) {
    if (n.nodeType !== "Identifier") continue;
    const value = renderIdentifier(n, scope);
    const r = range(n);
    const inside = r !== undefined && r.start >= base.start && r.end <= base.end;
    if (value !== undefined && r && inside && !edits.some((e) => r.start < e.end && e.start < r.end)) edits.push({ ...r, value });
  }
  let out = "";
  let at = base.start;
  for (const e of edits.sort((a, b) => a.start - b.start)) {
    out += scope.unit.bytes.subarray(at, e.start).toString("utf8") + e.value;
    at = e.end;
  }
  return out + scope.unit.bytes.subarray(at, base.end).toString("utf8");
}

/** An identifier's rendering when it stands for something else; undefined when its own name is the answer. */
function renderIdentifier(id: AstNode, scope: Scope): string | undefined {
  const ref = num(id, "referencedDeclaration");
  if (ref === undefined) return undefined;
  const bound = scope.bindings.get(ref);
  if (bound !== undefined) return bound;
  const decl = scope.unit.byId.get(ref);
  if (!decl || decl.nodeType !== "VariableDeclaration" || decl.name !== id.name) return undefined;
  if (decl.stateVariable === true) return immutableSource(decl, scope);
  return foldLocal(ref, scope);
}

/** An immutable the constructor sets straight from one of its parameters renders as that parameter. */
function immutableSource(decl: AstNode, scope: Scope): string | undefined {
  if (str(decl, "mutability") !== "immutable" || !scope.contract) return undefined;
  const ctor = children(scope.contract, "nodes").find((n) => n.nodeType === "FunctionDefinition" && n.kind === "constructor");
  if (!ctor) return undefined;
  for (const n of descendants(ctor)) {
    if (n.nodeType !== "Assignment") continue;
    const lhs = child(n, "leftHandSide");
    const rhs = child(n, "rightHandSide");
    if (lhs?.nodeType === "Identifier" && num(lhs, "referencedDeclaration") === decl.id && rhs?.nodeType === "Identifier") {
      return rhs.name;
    }
  }
  return undefined;
}

/**
 * A local assigned once where it's declared (`address self = address(this)`) renders as its value; a fixed-size
 * memory array filled index by index (`proposers[0] = self`) renders as `[a, b]`. Anything else keeps its name.
 */
function foldLocal(ref: number, scope: Scope): string | undefined {
  const body = scope.fn;
  let initial: AstNode | undefined;
  let reassigned = false;
  const slots = new Map<number, AstNode>();
  for (const n of descendants(body)) {
    if (n.nodeType === "VariableDeclarationStatement") {
      const decls = Array.isArray(n.declarations) ? n.declarations : [];
      const i = decls.findIndex((d) => isNode(d) && d.id === ref);
      if (i === 0 && decls.length === 1) initial = child(n, "initialValue");
    } else if (n.nodeType === "Assignment") {
      const lhs = child(n, "leftHandSide");
      if (lhs?.nodeType === "Identifier" && num(lhs, "referencedDeclaration") === ref) reassigned = true;
      if (lhs?.nodeType === "IndexAccess") {
        const target = child(lhs, "baseExpression");
        const index = child(lhs, "indexExpression");
        if (target?.nodeType === "Identifier" && num(target, "referencedDeclaration") === ref) {
          const at = index?.nodeType === "Literal" ? Number(str(index, "value")) : Number.NaN;
          const rhs = child(n, "rightHandSide");
          if (Number.isInteger(at) && rhs && str(n, "operator") === "=") slots.set(at, rhs);
          else reassigned = true;
        }
      }
    }
  }
  if (!initial || reassigned) return undefined;
  if (slots.size === 0) return render(initial, scope);
  // `new T[](n)` filled at 0..n-1 exactly.
  const size = children(initial, "arguments")[0];
  const length = size?.nodeType === "Literal" ? Number(str(size, "value")) : Number.NaN;
  if (child(initial, "expression")?.nodeType !== "NewExpression" || length !== slots.size) return undefined;
  const items: string[] = [];
  for (let i = 0; i < length; i++) {
    const v = slots.get(i);
    if (!v) return undefined;
    items.push(render(v, scope));
  }
  return `[${items.join(", ")}]`;
}

function argumentsOf(call: AstNode, fn: AstNode, scope: Scope): { key: string; value: string }[] {
  const params = paramsOf(fn);
  const args = children(call, "arguments");
  const names = Array.isArray(call.names) ? (call.names as unknown[]).filter((x): x is string => typeof x === "string") : [];
  return params.map((p, i) => {
    const at = names.length > 0 ? names.indexOf(p.name ?? "") : i;
    const arg = args[at];
    return { key: p.name ?? "", value: arg ? render(arg, scope) : "" };
  });
}

function bindingsFor(fn: AstNode, call: AstNode, scope: Scope): Map<number, string> {
  const params = paramsOf(fn);
  const values = argumentsOf(call, fn, scope);
  const out = new Map<number, string>();
  params.forEach((p, i) => {
    if (typeof p.id === "number") out.set(p.id, values[i]?.value ?? "");
  });
  return out;
}

async function walkBody(scope: Scope, walk: Walk): Promise<void> {
  if (scope.depth > MAX_DEPTH) {
    walk.notes.push(`${scope.unit.path}: calls nest deeper than ${MAX_DEPTH}; stopped following them.`);
    return;
  }
  await visit(child(scope.fn, "body"), scope, walk);
}

async function visit(n: AstNode | undefined, scope: Scope, walk: Walk): Promise<void> {
  if (!n) return;
  if (n.nodeType === "FunctionCall") {
    for (const a of children(n, "arguments")) await visit(a, scope, walk);
    const expr = child(n, "expression");
    if (expr?.nodeType === "MemberAccess") await visit(child(expr, "expression"), scope, walk);
    await call(n, scope, walk);
    return;
  }
  if (n.nodeType === "InlineAssembly" && scope.own) {
    const refs = Array.isArray(n.externalReferences) ? n.externalReferences : [];
    for (const r of refs) {
      const src = typeof r === "object" && r !== null ? (r as { src?: unknown }).src : undefined;
      if (typeof src !== "string") continue;
      if (await isDiamondFlagSlot(text(scope.unit, { nodeType: "ExternalReference", src }), scope, walk)) walk.registers = true;
    }
  }
  for (const [k, v] of Object.entries(n)) {
    if (k === "typeDescriptions") continue;
    if (Array.isArray(v)) {
      for (const x of v) if (isNode(x)) await visit(x, scope, walk);
    } else if (isNode(v)) {
      await visit(v, scope, walk);
    }
  }
}

/** `ERC165_MAP_*` constants from diamond-lib's DiamondLib.sol: the ERC-165 flag slots `DiamondLib.registerInterface()` writes. */
async function isDiamondFlagSlot(name: string, scope: Scope, walk: Walk): Promise<boolean> {
  if (!name.startsWith("ERC165_MAP_")) return false;
  const found = await resolveName(scope.unit, name, walk.load);
  return found !== undefined && basename(found.unit.path) === "DiamondLib.sol";
}

/** The contract (or library) in `unit` that declares `fn`. */
function containerOf(unit: Unit, fn: AstNode): AstNode | undefined {
  return children(unit.ast, "nodes").find((c) => c.nodeType === "ContractDefinition" && children(c, "nodes").includes(fn));
}

async function call(n: AstNode, scope: Scope, walk: Walk): Promise<void> {
  if (str(n, "kind") !== "functionCall") return;
  const expr = child(n, "expression");
  if (!expr) return;

  if (expr.nodeType === "MemberAccess") {
    const base = child(expr, "expression");
    const member = str(expr, "memberName");
    if (base?.nodeType !== "Identifier" || base.name === undefined || member === undefined) return;
    const local = scope.unit.byId.get(num(base, "referencedDeclaration") ?? -1);
    const found =
      local?.nodeType === "ContractDefinition" && local.name === base.name
        ? { unit: scope.unit, decl: local }
        : await resolveName(scope.unit, base.name, walk.load);
    if (!found || found.decl.nodeType !== "ContractDefinition") return;
    const fn = memberFunction(found.decl, member, callTypes(expr));
    if (!fn) {
      // Errors and events are called too (`revert I.X()`, `emit I.E()`); only a missing function is news.
      const other = children(found.decl, "nodes").some((d) => d.name === member);
      if (!other) walk.notes.push(`${scope.unit.path}: ${found.decl.name}.${member} isn't in ${found.unit.path}.`);
      return;
    }
    await enter(n, found.unit, found.decl, fn, scope, walk);
    return;
  }

  if (expr.nodeType === "Identifier") {
    const ref = num(expr, "referencedDeclaration");
    const fn = ref === undefined ? undefined : scope.unit.byId.get(ref);
    if (fn?.nodeType !== "FunctionDefinition" || fn.name !== expr.name) {
      const type = (expr.typeDescriptions as { typeIdentifier?: unknown } | undefined)?.typeIdentifier;
      if (typeof type === "string" && type.startsWith("t_function_internal")) {
        walk.notes.push(`${scope.unit.path}: couldn't follow ${expr.name ?? "a call"} (not declared in this file).`);
      }
      return;
    }
    await enter(n, scope.unit, containerOf(scope.unit, fn), fn, scope, walk);
  }
}

/** Records what a call initializes, then follows it into the callee's body when it has one. */
async function enter(
  n: AstNode,
  unit: Unit,
  container: AstNode | undefined,
  fn: AstNode,
  scope: Scope,
  walk: Walk,
): Promise<void> {
  const lib = container?.name ?? "";
  const name = fn.name ?? "";
  const inDiamondLib = unit.path.includes("diamond-lib/");
  if (inDiamondLib && lib === "DiamondLib" && name === "registerInterface") {
    if (scope.own) walk.registers = true;
    return;
  }
  // diamond-lib's modules have no `__X_init`: setting the owner and registering ERC-165 are their inits.
  if (inDiamondLib && lib === "OwnableLib" && name === "initializeOwner") {
    const [owner] = argumentsOf(n, fn, scope);
    walk.initializes.push({ module: "Ownable", with: { owner: owner?.value ?? "" } });
    return;
  }
  if (inDiamondLib && lib === "ERC165Lib" && name === "registerInterface") {
    walk.initializes.push({ module: "ERC165" });
    return;
  }
  const m = MODULE_INIT.exec(name);
  if (m?.[1]) {
    const args = argumentsOf(n, fn, scope);
    walk.initializes.push(
      args.length > 0 ? { module: m[1], with: Object.fromEntries(args.map((a) => [withKey(a.key), a.value])) } : { module: m[1] },
    );
  }
  const visibility = str(fn, "visibility");
  if (fn.implemented !== true || (visibility !== "internal" && visibility !== "private")) return;
  await walkBody(
    {
      unit,
      bindings: bindingsFor(fn, n, scope),
      fn,
      contract: container,
      own: scope.own && unit === scope.unit && container !== undefined && container === scope.contract,
      depth: scope.depth + 1,
    },
    walk,
  );
}

// ── docs ───────────────────────────────────────────────────────────────────────────────────────────

/** `@param name text` from a NatSpec block, cleaned. */
function natspecParams(doc: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (doc === undefined) return out;
  for (const part of doc.split(/(?=@\w+)/)) {
    const m = /^@param\s+(\w+)\s+([\s\S]*)$/.exec(part.trim());
    const clean = cleanDoc(m?.[2]);
    if (m?.[1] && clean !== undefined) out[m[1]] = clean;
  }
  return out;
}

/** The first `@notice` (or untagged text) of a NatSpec block. */
function natspecNotice(doc: string | undefined): string | undefined {
  if (doc === undefined) return undefined;
  const parts = doc.split(/(?=@\w+)/);
  const notice = parts.find((p) => p.trim().startsWith("@notice")) ?? (parts[0]?.trim().startsWith("@") ? undefined : parts[0]);
  return cleanDoc(notice?.replace(/^\s*@notice/, ""));
}

function docText(n: AstNode): string | undefined {
  const d = n.documentation;
  if (typeof d === "string") return d;
  return isNode(d) ? str(d, "text") : undefined;
}

/** A struct member's trailing `// comment`, as a sentence: "underlying ERC-20" → "Underlying ERC-20.". */
function trailingComment(unit: Unit, member: AstNode): string | undefined {
  const r = range(member);
  if (!r) return undefined;
  const nl = unit.bytes.indexOf(0x0a, r.end);
  const rest = unit.bytes.subarray(r.end, nl === -1 ? unit.bytes.length : nl).toString("utf8");
  const m = /^\s*;?\s*\/\/+\s*(.+?)\s*$/.exec(rest);
  const clean = cleanDoc(m?.[1]);
  if (clean === undefined) return undefined;
  const sentence = clean[0]?.toUpperCase() + clean.slice(1);
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

type StructDoc = { notice?: string; members: Map<string, string>; unit: Unit; decl: AstNode };

async function structDoc(unit: Unit, internalType: string | undefined, load: UnitLoader): Promise<StructDoc | undefined> {
  const m = /^struct\s+(?:(\w+)\.)?(\w+)/.exec(internalType ?? "");
  if (!m?.[2]) return undefined;
  let found: Found | undefined;
  if (m[1]) {
    const owner = await resolveName(unit, m[1], load);
    const decl = owner && children(owner.decl, "nodes").find((n) => n.nodeType === "StructDefinition" && n.name === m[2]);
    if (owner && decl) found = { unit: owner.unit, decl };
  } else {
    found = await resolveName(unit, m[2], load);
  }
  if (!found || found.decl.nodeType !== "StructDefinition") return undefined;
  const members = new Map<string, string>();
  for (const member of children(found.decl, "members")) {
    const doc = trailingComment(found.unit, member);
    if (member.name !== undefined && doc !== undefined) members.set(member.name, doc);
  }
  const notice = natspecNotice(docText(found.decl));
  return notice === undefined ? { members, unit: found.unit, decl: found.decl } : { notice, members, unit: found.unit, decl: found.decl };
}

// ── parameters ─────────────────────────────────────────────────────────────────────────────────────

type AbiInput = AbiParameter & { internalType?: string; components?: readonly AbiInput[] };

/** The canonical type in a signature: tuples as `(a,b)` with their array suffix. */
export function canonicalType(p: AbiInput): string {
  if (p.type.startsWith("tuple")) return `(${(p.components ?? []).map(canonicalType).join(",")})${p.type.slice(5)}`;
  return p.type;
}

async function initParam(p: AbiInput, doc: string | undefined, unit: Unit, load: UnitLoader): Promise<InitParam> {
  const out: InitParam = { name: p.name ?? "", type: p.type, doc: doc ?? "" };
  if (!p.type.startsWith("tuple")) return out;
  const struct = await structDoc(unit, p.internalType, load);
  if (out.doc === "" && struct?.notice !== undefined) out.doc = struct.notice;
  out.components = [];
  for (const c of p.components ?? []) {
    out.components.push(await initParam(c, struct?.members.get(c.name ?? ""), struct?.unit ?? unit, load));
  }
  return out;
}

// ── reading the build ──────────────────────────────────────────────────────────────────────────────

type Loaded = { artifact: Artifact; ast: AstNode };

async function readArtifactWithAst(path: string, contract: string): Promise<Result<Loaded, string>> {
  let json: unknown;
  try {
    json = await Bun.file(path).json();
  } catch {
    return err(`${path} isn't readable JSON.`);
  }
  const parsed = parseArtifact(json, contract, path);
  if (!parsed.ok) return parsed;
  const ast = (json as { ast?: unknown }).ast;
  if (!isNode(ast)) return err(`${path} has no AST.`);
  return ok({ artifact: parsed.value, ast });
}

/** Every artifact compiled from `sourcePath`, by contract name. Forge nests `out/` paths only on basename clashes. */
async function artifactsOf(outDir: string, sourcePath: string): Promise<Loaded[]> {
  const base = basename(sourcePath);
  const paths: string[] = [];
  try {
    for (const f of await readdir(join(outDir, base))) if (f.endsWith(".json")) paths.push(join(outDir, base, f));
  } catch {
    // no flat directory: fall through to the nested search
  }
  const pick = async (list: string[]): Promise<Loaded[]> => {
    const out: Loaded[] = [];
    for (const p of list.sort()) {
      const r = await readArtifactWithAst(p, basename(p, ".json"));
      if (r.ok && r.value.artifact.sourcePath === sourcePath) out.push(r.value);
    }
    return out;
  };
  const flat = await pick(paths);
  if (flat.length > 0) return flat;
  const nested: string[] = [];
  for await (const p of new Bun.Glob(`**/${base}/*.json`).scan({ cwd: outDir, onlyFiles: true })) {
    if (!p.startsWith("build-info/")) nested.push(join(outDir, p));
  }
  return pick(nested);
}

/** A loader over a built checkout: each file's AST from its first artifact, bytes from the checkout. */
export function buildLoader(latticeDir: string): UnitLoader {
  const outDir = join(latticeDir, "out");
  const cache = new Map<string, Promise<Unit | undefined>>();
  return (path) => {
    let hit = cache.get(path);
    if (!hit) {
      hit = (async () => {
        const [first] = await artifactsOf(outDir, path);
        const file = Bun.file(join(latticeDir, path));
        if (!first || !(await file.exists())) return undefined;
        return makeUnit(path, first.ast, Buffer.from(await file.arrayBuffer()));
      })();
      cache.set(path, hit);
    }
    return hit;
  };
}

/**
 * The init specs one contract yields: one per state-changing external or public function, named after the
 * contract when it has one, `<Contract>.<fn>` when it has several (contracts §3.1, CCR from K3).
 */
export async function initFactsFor(
  artifact: Artifact,
  unit: Unit,
  load: UnitLoader,
): Promise<Result<{ facts: InitFacts[]; notes: string[] }, string>> {
  const contract = children(unit.ast, "nodes").find((n) => n.nodeType === "ContractDefinition" && n.name === artifact.contract);
  if (!contract) return err(`${unit.path}: no contract ${artifact.contract} in its AST.`);
  const entries = children(contract, "nodes").filter(
    (n) =>
      n.nodeType === "FunctionDefinition" &&
      n.kind === "function" &&
      (n.visibility === "external" || n.visibility === "public") &&
      n.stateMutability !== "view" &&
      n.stateMutability !== "pure",
  );
  if (entries.length === 0) return err(`${unit.path}: ${artifact.contract} has no state-changing entry point.`);

  const bySelector = new Map<string, string>();
  for (const [sig, sel] of Object.entries(artifact.methodIdentifiers)) bySelector.set(sel, sig);
  const ctor = artifact.abi.find((i) => i.type === "constructor");
  const ctorArgs = ctor && ctor.type === "constructor" ? (ctor.inputs as readonly AbiInput[]) : [];
  const names = new Map<string, number>();
  for (const e of entries) names.set(e.name ?? "", (names.get(e.name ?? "") ?? 0) + 1);

  const facts: InitFacts[] = [];
  const notes: string[] = [];
  for (const entry of entries) {
    const selector = `0x${str(entry, "functionSelector") ?? ""}` as Hex4;
    const fn = bySelector.get(selector);
    if (fn === undefined) return err(`${unit.path}: ${artifact.contract}.${entry.name} (${selector}) isn't in methodIdentifiers.`);
    const abi = artifact.abi.find(
      (i) => i.type === "function" && `${i.name}(${(i.inputs as readonly AbiInput[]).map(canonicalType).join(",")})` === fn,
    );
    if (!abi || abi.type !== "function") return err(`${unit.path}: no ABI entry for ${fn}.`);

    const devParams = artifact.metadata.output.devdoc.methods?.[fn]?.params ?? {};
    const astParams = natspecParams(docText(entry));
    const params: InitParam[] = [];
    for (const p of abi.inputs as readonly AbiInput[]) {
      const doc = cleanDoc(devParams[p.name ?? ""]) ?? astParams[p.name ?? ""];
      params.push(await initParam(p, doc, unit, load));
    }

    const walk: Walk = { initializes: [], registers: false, load, notes: [] };
    const bindings = new Map<number, string>();
    for (const p of paramsOf(entry)) {
      if (typeof p.id === "number") bindings.set(p.id, p.name ?? "");
    }
    await walkBody({ unit, bindings, fn: entry, contract, own: true, depth: 0 }, walk);
    notes.push(...walk.notes);

    const overloaded = (names.get(entry.name ?? "") ?? 0) > 1;
    const name = entries.length === 1 ? artifact.contract : `${artifact.contract}.${overloaded ? fn : entry.name}`;
    const spec: InitSkeleton = { name, contract: artifact.contract, fn, kind: "step", params, initializes: walk.initializes, after: [], sameCall: [] };
    if (walk.registers) spec.registersInterfaces = true;
    if (ctorArgs.length > 0) spec.ctorArgs = ctorArgs.map((a) => ({ name: a.name ?? "", type: canonicalType(a) }));

    const r = range(entry);
    const lines = r ? `#L${lineAt(unit.bytes, r.start)}-L${lineAt(unit.bytes, r.end)}` : "";
    facts.push({ spec, selector, sourcePath: unit.path, source: `${unit.path}${lines}`, artifact });
  }
  return ok({ facts, notes });
}

/** The init source files of a checkout: Lattice's `src/**\/*Init*.sol` and diamond-lib's three, sorted. */
export async function initSourcePaths(latticeDir: string): Promise<string[]> {
  const out: string[] = [];
  for await (const p of new Bun.Glob(LATTICE_INIT_GLOB).scan({ cwd: latticeDir, onlyFiles: true })) out.push(p);
  return [...out.sort(), ...DIAMOND_LIB_INITS];
}

async function declaresInit(file: string): Promise<boolean> {
  const f = Bun.file(file);
  return (await f.exists()) && /\bcontract\s+\w*Init\d*\b/.test(await f.text());
}

/** Every init in a built checkout, sorted by name. `notes` lists calls the walk couldn't follow. */
export async function readInits(latticeDir: string): Promise<Result<{ inits: InitFacts[]; notes: string[] }, string>> {
  const outDir = join(latticeDir, "out");
  const load = buildLoader(latticeDir);
  const inits: InitFacts[] = [];
  const notes: string[] = [];
  const missing: string[] = [];
  for (const path of await initSourcePaths(latticeDir)) {
    const artifacts = await artifactsOf(outDir, path);
    if (artifacts.length === 0) {
      // diamond-lib's are always expected; a Lattice file only when it declares an init contract.
      if ((DIAMOND_LIB_INITS as readonly string[]).includes(path) || (await declaresInit(join(latticeDir, path)))) {
        missing.push(path);
      }
      continue;
    }
    const unit = await load(path);
    if (!unit) return err(`${path}: couldn't read its source or AST.`);
    for (const { artifact } of artifacts) {
      const decl = children(unit.ast, "nodes").find((n) => n.nodeType === "ContractDefinition" && n.name === artifact.contract);
      if (!decl || decl.contractKind !== "contract" || decl.abstract === true || !INIT_NAME.test(artifact.contract)) continue;
      if (SKIPPED_INITS[artifact.contract] !== undefined) continue;
      const r = await initFactsFor(artifact, unit, load);
      if (!r.ok) return r;
      inits.push(...r.value.facts);
      notes.push(...r.value.notes);
    }
  }
  if (missing.length > 0) {
    return err(
      `no artifacts for ${missing.join(", ")}. Build them with FOUNDRY_PROFILE=ci ${supplementaryBuildCommand(latticeDir).join(" ")}.`,
    );
  }
  inits.sort((a, b) => (a.spec.name < b.spec.name ? -1 : a.spec.name > b.spec.name ? 1 : 0));
  return ok({ inits, notes });
}

/** One artifact per stateless init contract (no constructor arguments), for CG2's release data. */
export function statelessInitContracts(inits: InitFacts[]): { contract: string; artifact: Artifact }[] {
  const seen = new Map<string, Artifact>();
  for (const f of inits) if (f.spec.ctorArgs === undefined && !seen.has(f.spec.contract)) seen.set(f.spec.contract, f.artifact);
  return [...seen].sort(([a], [b]) => (a < b ? -1 : 1)).map(([contract, artifact]) => ({ contract, artifact }));
}

// ── the overlay ────────────────────────────────────────────────────────────────────────────────────

/** Overlay facts for one parameter (contracts §4); `components` by field name for a tuple. */
export type InitParamOverlay = {
  doc?: string;
  unit?: InitParam["unit"];
  rule?: string;
  example?: Json;
  exampleSource?: string;
  authority?: true;
  role?: string;
  components?: Record<string, InitParamOverlay>;
};

/** Overlay facts for one init, keyed by InitSpec name in `inits/<area>.yaml` (contracts §4). */
export type InitOverlay = {
  kind?: InitSpec["kind"];
  params?: Record<string, InitParamOverlay>;
  after?: string[];
  sameCall?: string[];
  sequence?: string[];
  registersInterfaces?: boolean;
};

export type InitMerge = {
  inits: InitSkeleton[];
  /** Inits the overlay says nothing about, for the overlay lint (spec L911). */
  withoutOverlay: string[];
  /** Overlay entries that name no init at the pin. */
  unknownOverlay: string[];
  /** Where the overlay contradicts the source; the source wins (contracts §4). */
  conflicts: string[];
  /** Parameters (dot paths) with no doc from NatSpec or the overlay. */
  undocumented: string[];
};

function mergeParam(p: InitParam, o: InitParamOverlay | undefined, path: string, out: InitMerge): InitParam {
  const merged: InitParam = { name: p.name, type: p.type, doc: o?.doc ?? p.doc };
  if (merged.doc === "") out.undocumented.push(path);
  if (o?.unit !== undefined) merged.unit = o.unit;
  if (o?.rule !== undefined) merged.rule = o.rule;
  if (o?.example !== undefined) merged.example = o.example;
  if (o?.exampleSource !== undefined) merged.exampleSource = o.exampleSource;
  if (o?.authority !== undefined) merged.authority = o.authority;
  if (o?.role !== undefined) merged.role = o.role;
  if (p.components) {
    const known = new Set(p.components.map((c) => c.name));
    for (const extra of Object.keys(o?.components ?? {})) {
      if (!known.has(extra)) out.conflicts.push(`${path}: the overlay names field ${extra}, which the struct doesn't have.`);
    }
    merged.components = p.components.map((c) => mergeParam(c, o?.components?.[c.name], `${path}.${c.name}`, out));
  } else if (o?.components !== undefined) {
    out.conflicts.push(`${path}: the overlay gives components, but ${p.type} isn't a tuple.`);
  }
  return merged;
}

/**
 * Completes the skeletons with the overlay: kind, units, rules, examples, authority and roles, docs, `after`,
 * `sameCall` and `sequence`. `initializes` and `registersInterfaces` stay as the source states them.
 */
export function mergeInitOverlay(skeletons: InitSkeleton[], overlay: Record<string, InitOverlay>): InitMerge {
  const out: InitMerge = { inits: [], withoutOverlay: [], unknownOverlay: [], conflicts: [], undocumented: [] };
  const names = new Set(skeletons.map((s) => s.name));
  out.unknownOverlay = Object.keys(overlay).filter((n) => !names.has(n)).sort();
  for (const s of skeletons) {
    const o = overlay[s.name];
    if (!o) out.withoutOverlay.push(s.name);
    const known = new Set(s.params.map((p) => p.name));
    for (const extra of Object.keys(o?.params ?? {})) {
      if (!known.has(extra)) out.conflicts.push(`${s.name}: the overlay names parameter ${extra}, which ${s.fn} doesn't take.`);
    }
    if (o?.registersInterfaces !== undefined && o.registersInterfaces !== (s.registersInterfaces === true)) {
      out.conflicts.push(
        `${s.name}: the overlay says registersInterfaces ${o.registersInterfaces}, the source says ${s.registersInterfaces === true}; the source wins.`,
      );
    }
    const merged: InitSkeleton = {
      name: s.name,
      contract: s.contract,
      fn: s.fn,
      kind: o?.kind ?? s.kind,
      params: s.params.map((p) => mergeParam(p, o?.params?.[p.name], `${s.name}.${p.name}`, out)),
      initializes: s.initializes,
      after: o?.after ?? s.after,
      sameCall: o?.sameCall ?? s.sameCall,
    };
    const sequence = o?.sequence ?? s.sequence;
    if (sequence !== undefined) merged.sequence = sequence;
    if (s.registersInterfaces) merged.registersInterfaces = true;
    if (s.ctorArgs) merged.ctorArgs = s.ctorArgs;
    out.inits.push(merged);
  }
  return out;
}
