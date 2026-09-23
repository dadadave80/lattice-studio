/**
 * Forge artifacts from a Lattice checkout built with `FOUNDRY_PROFILE=ci forge build --root <dir>` (spec L101):
 * `out/<File>.sol/<Contract>.json`. Each gives the ABI (functions, errors, events), `methodIdentifiers`, creation
 * and runtime bytecode with link and immutable references, the storage layout (the ci profile's
 * `extra_output = ["storageLayout"]`) and solc's own metadata.
 *
 * Metadata comes from `rawMetadata`, the exact string solc emitted: forge's parsed `metadata` object drops the
 * contract-level NatSpec and the error and event docs.
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { type AbiItem, err, type Hex, type Hex4, ok, type Result } from "@lattice-studio/core";
import { decodeAbiParameters, keccak256, toHex } from "viem";
import * as z from "zod";

/** `exportSelectors()`: never cut into a diamond, so stripped from every facet (spec L55, R3). */
export const SELF_SELECTOR: Hex4 = "0x0ef22643";
/** The empty-calldata `msg.sig` that Receive exports; no ABI lists it (`ExportSelectorsParityTest.t.sol:76-80`). */
export const RECEIVE_SELECTOR: Hex4 = "0x00000000";

/** Byte offsets of a placeholder or immutable inside bytecode. */
export type ByteRange = { start: number; length: number };
/** `{ "lib/poseidon-solidity/PoseidonT3.sol": { "PoseidonT3": [{ start, length }] } }`. */
export type LinkReferences = Record<string, Record<string, ByteRange[]>>;
/** AST id of the immutable → where the runtime code holds it. */
export type ImmutableReferences = Record<string, ByteRange[]>;

/** NatSpec as solc emits it (userdoc and devdoc), loosely typed: only what the catalog reads is named. */
export type UserDoc = {
  notice?: string;
  methods?: Record<string, { notice?: string }>;
  errors?: Record<string, { notice?: string }[]>;
  events?: Record<string, { notice?: string }>;
};
export type DevDoc = {
  title?: string;
  author?: string;
  details?: string;
  methods?: Record<string, { details?: string; params?: Record<string, string>; returns?: Record<string, string> }>;
  errors?: Record<string, { details?: string; params?: Record<string, string> }[]>;
  events?: Record<string, { details?: string; params?: Record<string, string> }>;
  [custom: `custom:${string}`]: string | undefined;
};

/** solc's metadata JSON (the fields the catalog reads; the rest stays). */
export type SolcMetadata = {
  compiler: { version: string };
  language: string;
  settings: {
    compilationTarget: Record<string, string>;
    evmVersion?: string;
    optimizer?: { enabled?: boolean; runs?: number };
    metadata?: { bytecodeHash?: string; appendCBOR?: boolean; useLiteralContent?: boolean };
    remappings?: string[];
    libraries?: Record<string, string>;
    viaIR?: boolean;
  };
  sources: Record<string, { keccak256: Hex; license?: string; urls?: string[] }>;
  output: { abi: unknown[]; userdoc: UserDoc; devdoc: DevDoc };
};

/** One compiled contract. */
export type Artifact = {
  contract: string;
  /** The artifact file this came from. */
  path: string;
  /** Source path from `settings.compilationTarget`: "src/tokens/ERC20/ERC20.sol". */
  sourcePath: string;
  abi: AbiItem[];
  /** Signature → selector, lowercase with 0x: `{ "transfer(address,uint256)": "0xa9059cbb" }`. */
  methodIdentifiers: Record<string, Hex4>;
  /** Creation code; `object` holds `__$…$__` placeholders while `linkReferences` isn't empty. */
  bytecode: { object: string; linkReferences: LinkReferences };
  /** Runtime code; immutables sit zeroed at `immutableReferences`. */
  deployedBytecode: { object: string; linkReferences: LinkReferences; immutableReferences: ImmutableReferences };
  metadata: SolcMetadata;
  /** Present when the build ran with `extra_output = ["storageLayout"]` (the ci profile does). */
  storageLayout?: unknown;
};

/** How to find an artifact: `out/<file>/<contract>.json`, disambiguated by the full source path when known. */
export type ArtifactRef = { file: string; contract: string; sourcePath?: string };

const Range = z.object({ start: z.number().int().nonnegative(), length: z.number().int().positive() });
const LinkRefs = z.record(z.string(), z.record(z.string(), z.array(Range)));
const CodeObject = z.string().regex(/^0x(?:[0-9a-fA-F]|__\$[0-9a-f]{34}\$__)*$/, "is not bytecode");

const ForgeArtifact = z.looseObject({
  abi: z.array(z.looseObject({ type: z.string() })),
  bytecode: z.looseObject({ object: CodeObject, linkReferences: LinkRefs.optional() }),
  deployedBytecode: z.looseObject({
    object: CodeObject,
    linkReferences: LinkRefs.optional(),
    immutableReferences: z.record(z.string(), z.array(Range)).optional(),
  }),
  methodIdentifiers: z.record(z.string(), z.string().regex(/^[0-9a-fA-F]{8}$/, "is not a selector")),
  rawMetadata: z.string(),
  storageLayout: z.unknown().optional(),
});

const Metadata = z.looseObject({
  compiler: z.looseObject({ version: z.string() }),
  language: z.string(),
  settings: z.looseObject({ compilationTarget: z.record(z.string(), z.string()) }),
  sources: z.record(z.string(), z.looseObject({ keccak256: z.string() })),
  output: z.looseObject({ abi: z.array(z.unknown()), userdoc: z.looseObject({}), devdoc: z.looseObject({}) }),
});

function issues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join(".") || "(root)"} ${i.message}`).join("; ");
}

/** Validates a forge artifact's JSON. `where` names the file in messages. */
export function parseArtifact(json: unknown, contract: string, where: string): Result<Artifact, string> {
  const a = ForgeArtifact.safeParse(json);
  if (!a.success) return err(`${where}: ${issues(a.error)}`);
  let raw: unknown;
  try {
    raw = JSON.parse(a.data.rawMetadata);
  } catch {
    return err(`${where}: rawMetadata isn't JSON.`);
  }
  const m = Metadata.safeParse(raw);
  if (!m.success) return err(`${where}: rawMetadata ${issues(m.error)}`);
  const metadata = m.data as unknown as SolcMetadata;
  const targets = Object.entries(metadata.settings.compilationTarget);
  const target = targets[0];
  if (targets.length !== 1 || !target || target[1] !== contract) {
    return err(`${where}: compilationTarget ${JSON.stringify(metadata.settings.compilationTarget)} isn't ${contract}.`);
  }
  const methodIdentifiers: Record<string, Hex4> = {};
  for (const [sig, sel] of Object.entries(a.data.methodIdentifiers)) {
    methodIdentifiers[sig] = `0x${sel.toLowerCase()}`;
  }
  const artifact: Artifact = {
    contract,
    path: where,
    sourcePath: target[0],
    abi: a.data.abi as unknown as AbiItem[],
    methodIdentifiers,
    bytecode: { object: a.data.bytecode.object, linkReferences: a.data.bytecode.linkReferences ?? {} },
    deployedBytecode: {
      object: a.data.deployedBytecode.object,
      linkReferences: a.data.deployedBytecode.linkReferences ?? {},
      immutableReferences: a.data.deployedBytecode.immutableReferences ?? {},
    },
    metadata,
  };
  if (a.data.storageLayout !== undefined) artifact.storageLayout = a.data.storageLayout;
  return ok(artifact);
}

async function readJson(path: string): Promise<Result<unknown, string>> {
  const file = Bun.file(path);
  if (!(await file.exists())) return err(`${path} doesn't exist.`);
  try {
    return ok(await file.json());
  } catch {
    return err(`${path} isn't JSON.`);
  }
}

async function candidates(outDir: string, ref: ArtifactRef): Promise<string[]> {
  const glob = new Bun.Glob(`**/${ref.file}/${ref.contract}.json`);
  const found: string[] = [];
  for await (const p of glob.scan({ cwd: outDir, onlyFiles: true })) {
    if (!p.startsWith("build-info/")) found.push(join(outDir, p));
  }
  return found.sort();
}

/**
 * Reads the artifact for `ref` from `outDir`. Forge writes `out/<File>.sol/<Contract>.json` and nests deeper only
 * when two sources share a basename, so the flat path is tried first; the source path from the metadata then
 * confirms it's the right contract. A basename-only ref (diamond-lib's four) must match exactly one artifact.
 */
export async function findArtifact(outDir: string, ref: ArtifactRef): Promise<Result<Artifact, string>> {
  const matches = (a: Artifact): boolean =>
    ref.sourcePath === undefined
      ? a.sourcePath === ref.file || a.sourcePath.endsWith(`/${ref.file}`)
      : a.sourcePath === ref.sourcePath;
  const direct = join(outDir, ref.file, `${ref.contract}.json`);
  const first = await readJson(direct);
  if (first.ok) {
    const a = parseArtifact(first.value, ref.contract, direct);
    if (a.ok && matches(a.value) && ref.sourcePath !== undefined) return a;
  }
  // Unreadable candidates (the flat one included) don't stop the search; they're reported only if nothing matches.
  const hits: Artifact[] = [];
  const unreadable: string[] = [];
  for (const path of await candidates(outDir, ref)) {
    const json = await readJson(path);
    const a = json.ok ? parseArtifact(json.value, ref.contract, path) : json;
    if (!a.ok) unreadable.push(a.error);
    else if (matches(a.value)) hits.push(a.value);
  }
  const want = ref.sourcePath ?? ref.file;
  if (hits.length === 1 && hits[0]) return ok(hits[0]);
  if (hits.length === 0) {
    const also = unreadable.length > 0 ? ` Unreadable: ${unreadable.join(" ")}` : "";
    return err(
      `no artifact for ${want}:${ref.contract} under ${outDir}. Build with FOUNDRY_PROFILE=ci forge build.${also}`,
    );
  }
  return err(`${hits.length} artifacts match ${want}:${ref.contract}: ${hits.map((h) => h.sourcePath).sort().join(", ")}.`);
}

/** The placeholder solc writes for a library: `__$` + the first 34 hex digits of keccak256("<file>:<Lib>") + `$__`. */
export function libraryPlaceholder(file: string, lib: string): string {
  return `__$${keccak256(toHex(`${file}:${lib}`)).slice(2, 36)}$__`;
}

/**
 * Fills every library placeholder with its address (`addresses` keyed `"<file>:<Lib>"`). Without link references
 * the code comes back unchanged. Refuses a missing address, a placeholder that isn't where the references say,
 * and anything still unlinked afterwards.
 */
export function linkBytecode(
  object: string,
  refs: LinkReferences,
  addresses: Record<string, string>,
): Result<Hex, string> {
  let code = object;
  for (const [file, libs] of Object.entries(refs)) {
    for (const [lib, ranges] of Object.entries(libs)) {
      const key = `${file}:${lib}`;
      const address = addresses[key];
      if (address === undefined) return err(`needs library ${key} linked; no address given.`);
      if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return err(`library ${key} address ${address} isn't 20 bytes.`);
      const placeholder = libraryPlaceholder(file, lib);
      for (const { start, length } of ranges) {
        const at = 2 + start * 2;
        if (length !== 20 || code.slice(at, at + 40) !== placeholder) {
          return err(`library ${key}: no placeholder at byte ${start}.`);
        }
        code = code.slice(0, at) + address.slice(2).toLowerCase() + code.slice(at + 40);
      }
    }
  }
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(code)) return err("bytecode is still unlinked or malformed.");
  return ok(code.toLowerCase() as Hex);
}

/** Decodes `exportSelectors()`'s return data: ABI-encoded `bytes` holding 4-byte selectors, tightly packed. */
export function decodeExportSelectors(returnData: Hex): Result<Hex4[], string> {
  let packed: Hex;
  try {
    [packed] = decodeAbiParameters([{ type: "bytes" }], returnData);
  } catch {
    return err("exportSelectors() didn't return ABI-encoded bytes.");
  }
  const body = packed.slice(2).toLowerCase();
  if (body.length === 0) return err("exportSelectors() returned no selectors.");
  if (body.length % 8 !== 0) return err(`exportSelectors() returned ${body.length / 2} bytes, not a multiple of 4.`);
  const out: Hex4[] = [];
  for (let i = 0; i < body.length; i += 8) out.push(`0x${body.slice(i, i + 8)}`);
  return ok(out);
}

/** A selector a facet exports, with its ABI signature ("receive()" for Receive's 0x00000000). */
export type FacetSelector = { hex: Hex4; signature: string };

/** How an export differs from the ABI. The pinned Lattice has none (its parity test enforces it). */
export type SelectorMismatch =
  | { kind: "not-in-abi"; facet: string; selector: Hex4 }
  | { kind: "not-exported"; facet: string; selector: Hex4; signature: string }
  | { kind: "duplicate"; facet: string; selector: Hex4 };

/** Renders a mismatch for the generator's report. */
export function describeMismatch(m: SelectorMismatch): string {
  switch (m.kind) {
    case "not-in-abi":
      return `${m.facet} exports ${m.selector}, which its ABI doesn't list.`;
    case "not-exported":
      return `${m.facet} doesn't export ${m.signature} (${m.selector}), which its ABI lists.`;
    case "duplicate":
      return `${m.facet} exports ${m.selector} more than once.`;
  }
}

/**
 * Checks an export against the artifact, in the facet's own order: drops 0x0ef22643, names each selector from
 * `methodIdentifiers` and reports every difference. Receive's 0x00000000 is the one selector no ABI lists; it
 * counts when the ABI declares `receive()` and is recorded with that signature.
 */
export function checkSelectors(
  facet: string,
  exported: Hex4[],
  artifact: Pick<Artifact, "abi" | "methodIdentifiers">,
): { selectors: FacetSelector[]; mismatches: SelectorMismatch[] } {
  const bySelector = new Map<string, string>();
  for (const [sig, sel] of Object.entries(artifact.methodIdentifiers)) bySelector.set(sel, sig);
  const hasReceive = artifact.abi.some((item) => item.type === "receive");

  const selectors: FacetSelector[] = [];
  const mismatches: SelectorMismatch[] = [];
  const seen = new Set<string>();
  for (const raw of exported) {
    const hex = raw.toLowerCase() as Hex4;
    if (hex === SELF_SELECTOR) continue;
    if (seen.has(hex)) {
      mismatches.push({ kind: "duplicate", facet, selector: hex });
      continue;
    }
    seen.add(hex);
    const signature = hex === RECEIVE_SELECTOR && hasReceive ? "receive()" : bySelector.get(hex);
    if (signature === undefined) mismatches.push({ kind: "not-in-abi", facet, selector: hex });
    else selectors.push({ hex, signature });
  }
  for (const [sig, sel] of Object.entries(artifact.methodIdentifiers)) {
    if (sel !== SELF_SELECTOR && !seen.has(sel)) {
      mismatches.push({ kind: "not-exported", facet, selector: sel, signature: sig });
    }
  }
  return { selectors, mismatches };
}

/**
 * The ABI a facet shard carries: functions, errors and events (contracts §3.1 `FacetDetail.abi`), without
 * `exportSelectors()`, which is never routed (R3). Order is the artifact's.
 */
export function shardAbi(abi: AbiItem[]): AbiItem[] {
  return abi.filter((item) => {
    if (item.type === "function") return !(item.name === "exportSelectors" && item.inputs.length === 0);
    return item.type === "error" || item.type === "event";
  });
}

/** What the build emitted beyond the artifacts, and the foundry.toml setting that would add what's missing. */
export type BuildOutputs = { storageLayout: boolean; buildInfo: boolean; missing: string[] };

/**
 * Confirms a build carries what the catalog needs: storage layouts in the artifacts (`extra_output =
 * ["storageLayout"]`) and build info (`build_info = true`), as the ci profile sets them. `probe` is any
 * artifact from that build.
 */
export async function checkBuildOutputs(outDir: string, probe: Artifact): Promise<BuildOutputs> {
  const storageLayout = probe.storageLayout !== undefined;
  let buildInfo = false;
  try {
    buildInfo = (await readdir(join(outDir, "build-info"))).some((f) => f.endsWith(".json"));
  } catch {
    buildInfo = false;
  }
  const missing: string[] = [];
  if (!storageLayout) missing.push('extra_output = ["storageLayout"]');
  if (!buildInfo) missing.push("build_info = true");
  return { storageLayout, buildInfo, missing };
}

