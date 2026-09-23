/**
 * What S1's commands share: the read-only and catalog guards every document command starts with, the edit
 * helper that applies one undo step and narrates it, and the console parsers' name and selector lookups.
 */
import type { Catalog, EditResult, Facet, Hex4, LineDraft, Project, Result } from "@lattice-studio/core";
import { formatSelector } from "@lattice-studio/core";
import { announce, doc, getCatalog, log, type CommandContext, type EditOp, type Enablement } from "@/contracts";
import { studioState } from "../runtime";

export const OK: Enablement = { ok: true };

/** While the catalog loads or after it failed: nothing can be edited against it. */
export const CATALOG_NOT_LOADED = "The catalog hasn't loaded yet";

/**
 * The first reason a document command can't run: the session's read-only reason (spec L389, IR L66), then a
 * missing catalog when the command needs one.
 */
export function guard(ctx: CommandContext, needsCatalog = true): Enablement | null {
  if (ctx.session.readOnly !== null) return { ok: false, reason: ctx.session.readOnly };
  if (needsCatalog && !ctx.catalog) return { ok: false, reason: CATALOG_NOT_LOADED };
  return null;
}

export function disabled(reason: string): Enablement {
  return { ok: false, reason };
}

/** "A", "A and B", "A, B and C". */
export function joinAnd(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1) ?? ""}`;
}

/** "ERC20 isn't on the sheet." / "ERC20 and ERC4626 aren't on the sheet." (IR L143). */
export function notOnSheet(names: readonly string[]): string {
  return `${joinAnd(names)} ${names.length === 1 ? "isn't" : "aren't"} on the sheet.`;
}

/** "Lattice 0.4.0" for the catalog tag "v0.4.0". */
export function catalogName(catalog: Catalog): string {
  return catalog.provisional ?? `Lattice ${catalog.lattice.tag.replace(/^v(?=[0-9])/, "")}`;
}

export function facetOf(catalog: Catalog, name: string): Facet | undefined {
  return catalog.facets.find((f) => f.name === name);
}

export function isPlaced(project: Project, name: string): boolean {
  return project.recipe.facets.includes(name);
}

/** `transfer · 0xa9059cbb` (spec L679, dense); a selector the catalog doesn't know shows as its hex. */
export function selectorLabel(catalog: Catalog | null, selector: Hex4): string {
  for (const facet of catalog?.facets ?? []) {
    const found = facet.selectors.find((s) => s.hex === selector);
    if (found) return formatSelector(found, "dense");
  }
  return `\`${selector}\``;
}

/** Says a result that changed nothing: a console line and the status region. */
export function sayNote(text: string): void {
  log({ tag: "Note", text });
  announce(text);
}

export type EditOutcome = {
  /** The undo label. Default: the op's summary ("Placed ERC20"). */
  label?: string;
  /** Lines logged first, before the problems the edit adds or resolves. */
  say?: (result: EditResult) => LineDraft[];
  /** Logged only when the edit narrates nothing. Default: the summary as a sentence. Null: nothing. */
  fallback?: ((result: EditResult) => LineDraft) | null;
  /** What the status region says. Default: the first `say` line, else the summary. */
  announce?: (result: EditResult) => string;
};

/**
 * Applies `op` to the document as one undo step and narrates it: `say` lines, then the problems it added or
 * resolved, else the fallback line. A no-op logs its summary instead and adds no step (spec L413: every
 * command says what happened).
 */
export function edit(op: EditOp, outcome: EditOutcome = {}): EditResult {
  const preview = op(doc.get());
  if (!preview.changed) {
    sayNote(preview.summary);
    return preview;
  }
  const result = doc.apply(outcome.label ?? preview.summary, () => preview);
  if (!result.changed) return result; // Refused (read-only): the store logged why.
  const engine = studioState().analysis;
  const said = outcome.say?.(result) ?? [];
  for (const line of said) engine.say(line);
  const fallback = outcome.fallback === undefined ? { tag: "Note" as const, text: `${result.summary}.` } : outcome.fallback?.(result);
  if (fallback) engine.fallback(fallback);
  engine.flush();
  announce(outcome.announce?.(result) ?? said[0]?.text ?? `${result.summary}.`);
  return result;
}

/** A composed op's result: several changes as one. */
export function combined(project: Project, next: Project, changed: boolean, summary: string): EditResult {
  return changed ? { project: next, changed: true, summary } : { project, changed: false, summary };
}

// ── Console parsing ──────────────────────────────────────────────────────────────────────────────────

export function ok<T>(value: T): Result<T, string> {
  return { ok: true, value };
}

export function err<T>(error: string): Result<T, string> {
  return { ok: false, error };
}

/** Strips one pair of matching quotes. */
export function unquote(text: string): string {
  const m = /^(["'‘“])(.*)(["'’”])$/s.exec(text.trim());
  return m?.[2] ?? text.trim();
}

/**
 * A facet name as typed in the console, resolved to its catalog spelling (C11's ops take exact names):
 * a placed facet first, then any catalog facet, case-insensitively. Unknown names come back as typed.
 */
export function resolveFacetName(typed: string): string {
  const wanted = unquote(typed);
  const lower = wanted.toLowerCase();
  const placed = doc.get().recipe.facets.find((name) => name.toLowerCase() === lower);
  if (placed) return placed;
  const catalog = getCatalog();
  return catalog?.facets.find((f) => f.name.toLowerCase() === lower)?.name ?? wanted;
}

/** A catalog facet by name as typed, or why not. */
export function parseFacet(typed: string | undefined, usage: string): Result<string, string> {
  if (typed === undefined || unquote(typed) === "") return err(`Name a facet: ${usage}`);
  const catalog = getCatalog();
  if (!catalog) return err(`${CATALOG_NOT_LOADED}.`);
  const name = resolveFacetName(typed);
  if (!facetOf(catalog, name)) return err(`‘${unquote(typed)}’ isn't a facet in ${catalogName(catalog)}.`);
  return ok(name);
}

type SelectorEntry = { hex: Hex4; signature: string };

/**
 * A selector as typed: its hex (`0xa9059cbb`), its signature (`transfer(address,uint256)`) or its function name
 * (`transfer`), among `candidates`. A name that several overloads share asks for the hex.
 */
export function resolveSelector(typed: string, candidates: readonly SelectorEntry[], where: string): Result<Hex4, string> {
  const token = unquote(typed);
  const lower = token.toLowerCase();
  const unique = new Map<Hex4, SelectorEntry>();
  for (const c of candidates) unique.set(c.hex, c);
  const all = [...unique.values()];
  if (/^0x[0-9a-f]{8}$/.test(lower)) {
    const hit = all.find((c) => c.hex === lower);
    return hit ? ok(hit.hex) : err(`${where} has no selector ${lower}.`);
  }
  const bySignature = all.filter((c) => c.signature.toLowerCase() === lower);
  const matches = bySignature.length > 0 ? bySignature : all.filter((c) => c.signature.slice(0, c.signature.indexOf("(")).toLowerCase() === lower);
  if (matches.length === 1 && matches[0]) return ok(matches[0].hex);
  if (matches.length > 1) {
    const listed = matches.map((m) => formatSelector(m, "full")).join(", ");
    return err(`${token} matches ${matches.length} selectors: ${listed}. Use the hex.`);
  }
  return err(`${where} has no selector ${token}.`);
}

/** Every selector the placed facets export, for `exclude` and `include`. */
export function placedSelectors(): SelectorEntry[] {
  const catalog = getCatalog();
  if (!catalog) return [];
  return doc.get().recipe.facets.flatMap((name) => facetOf(catalog, name)?.selectors ?? []);
}

/** The typed args, checked at the boundary: commands run from menus, fixes and toasts as well as the console. */
export function isString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

export function isHex4(value: unknown): value is Hex4 {
  return typeof value === "string" && /^0x[0-9a-f]{8}$/.test(value);
}
