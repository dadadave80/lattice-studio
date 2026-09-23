/**
 * The overlay lint (spec L911): checks the loaded overlay against what the build knows about Lattice at the pin.
 *
 * Errors: names that don't resolve (facets, inits, params, selectors, modules), bad `rule`s and units, a facet
 * or init written under the wrong area, conflicting default owners, citations that point past the end of a file,
 * and copy that breaks the spec's voice rules. Warnings: what a facet or init still lacks (summary, requirements
 * review, seam review, init docs), so a new facet in `FacetInventory` shows up without failing the build.
 *
 * Pure: the caller passes what it knows (CG1's facets, CG4's inits) and, optionally, a line counter for the
 * checkout the citations point into.
 */
import { AREAS, type Area, type Hex4, lintCopy, type ParseIssue } from "@lattice-studio/core";
import { type InitParamOverlay, type Overlay, parseSource } from "./overlay";

// ── the rule grammar (contracts §4) ────────────────────────────────────────────────────────────────

/** One term of a `rule`. Numbers stay decimal strings: bounds can pass 2^53. */
export type RuleTerm =
  | { kind: "range"; min: string; max: string }
  | { kind: "gt"; n: string }
  | { kind: "gte"; n: string }
  | { kind: "nonzero" }
  | { kind: "maxlen"; n: number }
  | { kind: "code"; of: "safe" | "token" | "contract" }
  | { kind: "enum"; values: string[] };

const INTEGER = /^-?(0|[1-9]\d*)$/;

function parseTerm(term: string): RuleTerm | string {
  if (term === "nonzero") return { kind: "nonzero" };
  const m = /^([a-z]+)\((.*)\)$/.exec(term);
  if (m === null) return `"${term}" isn't a rule term (range(a,b), gt(n), gte(n), nonzero, maxlen(n), code(…), enum(…)).`;
  const [, name, body = ""] = m;
  switch (name) {
    case "range": {
      const [a, b, extra] = body.split(",");
      if (a === undefined || b === undefined || extra !== undefined || !INTEGER.test(a) || !INTEGER.test(b)) {
        return `"${term}" needs two whole numbers: range(a,b).`;
      }
      if (BigInt(a) > BigInt(b)) return `"${term}" runs backwards: ${a} is more than ${b}.`;
      return { kind: "range", min: a, max: b };
    }
    case "gt":
    case "gte":
      if (!INTEGER.test(body)) return `"${term}" needs one whole number.`;
      return { kind: name, n: body };
    case "maxlen":
      if (!/^[1-9]\d*$/.test(body)) return `"${term}" needs a positive whole number.`;
      return { kind: "maxlen", n: Number(body) };
    case "code":
      if (body !== "safe" && body !== "token" && body !== "contract") return `"${term}" takes safe, token or contract.`;
      return { kind: "code", of: body };
    case "enum": {
      const values = body.split("|");
      if (values.some((v) => !/^[A-Za-z0-9_]+$/.test(v))) return `"${term}" needs values like enum(a|b|c).`;
      if (new Set(values).size !== values.length) return `"${term}" lists a value twice.`;
      return { kind: "enum", values };
    }
    default:
      return `"${term}" isn't a rule term (range(a,b), gt(n), gte(n), nonzero, maxlen(n), code(…), enum(…)).`;
  }
}

/** Parses a `rule`: terms joined with `&`, each kind at most once. */
export function parseRule(rule: string): { ok: true; terms: RuleTerm[] } | { ok: false; error: string } {
  if (/\s/.test(rule)) return { ok: false, error: `"${rule}" has spaces; write it without them, like nonzero&code(safe).` };
  const terms: RuleTerm[] = [];
  for (const raw of rule.split("&")) {
    const term = parseTerm(raw);
    if (typeof term === "string") return { ok: false, error: term };
    if (terms.some((t) => t.kind === term.kind)) return { ok: false, error: `"${rule}" repeats ${term.kind}.` };
    terms.push(term);
  }
  return { ok: true, terms };
}

/** Why a rule term or unit doesn't fit an ABI type, or `undefined` when it does. */
function misfit(kind: RuleTerm["kind"] | "unit", type: string): string | undefined {
  const integer = /^u?int\d*$/.test(type);
  const address = type === "address";
  const sized = type === "string" || type === "bytes" || type.endsWith("[]");
  const fits: Record<RuleTerm["kind"] | "unit", boolean> = {
    range: integer,
    gt: integer,
    gte: integer,
    unit: integer,
    nonzero: integer || address || /^bytes\d+$/.test(type),
    maxlen: sized,
    code: address,
    enum: integer || type === "string",
  };
  return fits[kind] ? undefined : `${kind === "unit" ? "a unit" : kind} doesn't apply to ${type}.`;
}

// ── inputs and issues ──────────────────────────────────────────────────────────────────────────────

/** A parameter as the build knows it (CG4): its NatSpec `doc` may be empty. */
export type KnownParam = { name: string; type?: string; doc?: string; components?: KnownParam[] };

/** What the build knows about Lattice at the pin. Anything left out isn't checked. */
export type LintFacts = {
  /** Every facet in `FacetInventory` (CG1), with its selectors and its NatSpec summary. */
  facets: { name: string; area?: Area; selectors: readonly Hex4[]; summary?: string }[];
  /** Every init spec (CG4). Absent: init names are checked against the overlay's own `inits/`. */
  inits?: {
    name: string;
    area?: Area;
    params?: KnownParam[];
    /** Modules the init initializes (`InitSpec.initializes`). */
    initializes?: readonly string[];
    registersInterfaces?: boolean;
  }[];
  /**
   * Every module an init can initialize (the `X` of each `__X_init`, plus `Ownable`). Absent: the union of the
   * inits' `initializes`, when any init lists them; otherwise `after` and `sameCall` names aren't checked.
   */
  modules?: readonly string[];
  /** Seams (CG6's `seams.yaml`), checked for names and selectors when given. */
  seams?: { selector: Hex4; when: readonly string[]; anyOf: readonly string[] }[];
  /** Line count of a file in the checkout the citations point into; `undefined` when it doesn't exist. */
  sourceLines?: (path: string) => number | undefined;
};

export type LintCode =
  // errors
  | "facet-unknown"
  | "init-unknown"
  | "param-unknown"
  | "wrong-area"
  | "requires-unknown"
  | "requires-self"
  | "selector-unknown"
  | "default-conflict"
  | "rule-invalid"
  | "rule-type"
  | "module-unknown"
  | "sequence-step"
  | "registers-interfaces"
  | "seam-unknown"
  | "source-missing"
  | "source-range"
  | "copy"
  // warnings
  | "no-entry"
  | "summary-missing"
  | "requires-unreviewed"
  | "seams-unreviewed"
  | "init-docs";

export type LintIssue = {
  severity: "error" | "warning";
  code: LintCode;
  /** The facet or init the issue is about. */
  subject: string;
  kind: "facet" | "init" | "seam";
  area?: Area;
  file?: string;
  /** Where in the entry: "requires[0].anyOf", "params.p.components.asset". */
  path?: string;
  message: string;
};

export type LintResult = { errors: LintIssue[]; warnings: LintIssue[] };

const WARNINGS = new Set<LintCode>(["no-entry", "summary-missing", "requires-unreviewed", "seams-unreviewed", "init-docs"]);

// ── the lint ───────────────────────────────────────────────────────────────────────────────────────

/** Lints the overlay against the facts. Deterministic: issues come sorted by kind, area, subject, code, path. */
export function lintOverlay(overlay: Overlay, facts: LintFacts): LintResult {
  const issues: LintIssue[] = [];
  const add = (i: Omit<LintIssue, "severity">) => {
    const clean: LintIssue = { severity: WARNINGS.has(i.code) ? "warning" : "error", ...i };
    for (const k of Object.keys(clean) as (keyof LintIssue)[]) if (clean[k] === undefined) delete clean[k];
    issues.push(clean);
  };

  const facets = new Map(facts.facets.map((f) => [f.name, f]));
  const inits = facts.inits === undefined ? undefined : new Map(facts.inits.map((i) => [i.name, i]));
  const initNames = inits ?? new Map(Object.keys(overlay.inits).map((n) => [n, { name: n }]));
  const modules =
    facts.modules !== undefined
      ? new Set(facts.modules)
      : facts.inits?.some((i) => i.initializes !== undefined)
        ? new Set(facts.inits.flatMap((i) => i.initializes ?? []))
        : undefined;

  // Who else exports each selector, for the seam review.
  const exporters = new Map<Hex4, string[]>();
  for (const f of facts.facets) for (const s of f.selectors) exporters.set(s, [...(exporters.get(s) ?? []), f.name]);

  const copy = (subject: string, kind: LintIssue["kind"], area: Area, file: string, path: string, text: string) => {
    for (const c of lintCopy(text)) add({ code: "copy", subject, kind, area, file, path, message: c.message });
  };

  const cite = (subject: string, kind: LintIssue["kind"], area: Area, file: string, path: string, source: string | undefined) => {
    if (source === undefined || facts.sourceLines === undefined) return;
    const ref = parseSource(source);
    if (ref === undefined) return;
    const lines = facts.sourceLines(ref.path);
    if (lines === undefined) {
      add({ code: "source-missing", subject, kind, area, file, path, message: `cites ${ref.path}, which isn't in the checkout.` });
    } else if (ref.to > lines) {
      add({ code: "source-range", subject, kind, area, file, path, message: `cites lines ${ref.from}-${ref.to} of ${ref.path}, which has ${lines}.` });
    }
  };

  // ── facets
  const defaults = new Map<Hex4, string>();
  for (const [name, entry] of Object.entries(overlay.facets)) {
    const { area, file } = entry;
    const at = { subject: name, kind: "facet" as const, area, file };
    const known = facets.get(name);
    if (known === undefined) {
      add({ ...at, code: "facet-unknown", message: `${name} isn't in FacetInventory at the pin.` });
    } else if (known.area !== undefined && known.area !== area) {
      add({ ...at, code: "wrong-area", message: `${name} is in ${known.area}; move it to overlay/facets/${known.area}.yaml.` });
    }
    if (entry.summary !== undefined) {
      cite(name, "facet", area, file, "summary", entry.summary.source);
      copy(name, "facet", area, file, "summary", entry.summary.text);
    }
    entry.requires?.forEach((r, i) => {
      const path = `requires[${i}]`;
      for (const option of r.anyOf) {
        if (option === name) add({ ...at, path, code: "requires-self", message: `${name} can't require itself.` });
        else if (!facets.has(option)) add({ ...at, path, code: "requires-unknown", message: `${option} isn't in FacetInventory at the pin.` });
      }
      cite(name, "facet", area, file, path, r.source);
      copy(name, "facet", area, file, `${path}.reason`, r.reason);
    });
    if (entry.family !== undefined) cite(name, "facet", area, file, "family", entry.family.source);
    entry.defaultOwnerOf?.forEach((d, i) => {
      const path = `defaultOwnerOf[${i}]`;
      for (const s of d.selectors as Hex4[]) {
        if (known !== undefined && !known.selectors.includes(s)) {
          add({ ...at, path, code: "selector-unknown", message: `${name} doesn't export ${s}.` });
        }
        const other = defaults.get(s);
        if (other !== undefined) {
          add({ ...at, path, code: "default-conflict", message: `${s} is already ${other}'s by default; one facet wins a selector.` });
        } else {
          defaults.set(s, name);
        }
      }
      cite(name, "facet", area, file, path, d.source);
    });
    if (entry.init !== undefined) {
      if (!initNames.has(entry.init.name)) {
        add({ ...at, path: "init", code: "init-unknown", message: `${entry.init.name} isn't an init contract at the pin.` });
      }
      cite(name, "facet", area, file, "init", entry.init.source);
    }
    if (entry.seamReview !== undefined) copy(name, "facet", area, file, "seamReview", entry.seamReview);
  }

  for (const f of facts.facets) {
    const entry = overlay.facets[f.name];
    const at = { subject: f.name, kind: "facet" as const, ...(entry ? { area: entry.area, file: entry.file } : f.area ? { area: f.area } : {}) };
    if (entry === undefined) {
      add({ ...at, code: "no-entry", message: `${f.name} has no overlay entry: requirements, seams and init aren't reviewed.` });
    }
    if (entry?.summary === undefined && (f.summary === undefined || f.summary.trim() === "")) {
      add({ ...at, code: "summary-missing", message: `${f.name} has no NatSpec notice and no overlay summary.` });
    }
    if (entry !== undefined && entry.requires === undefined) {
      add({ ...at, code: "requires-unreviewed", message: `${f.name}'s requirements aren't reviewed: write requires (an empty list when none apply).` });
    }
    const shared = f.selectors.filter((s) => (exporters.get(s) ?? []).length > 1);
    if (entry !== undefined && entry.seamReview === undefined && shared.length > 0) {
      const others = [...new Set(shared.flatMap((s) => exporters.get(s) ?? []))].filter((n) => n !== f.name).sort();
      add({
        ...at,
        code: "seams-unreviewed",
        message: `${f.name} shares ${shared.length} selector${shared.length === 1 ? "" : "s"} with ${others.join(", ")}; write a seamReview.`,
      });
    }
  }

  // ── inits
  for (const [name, entry] of Object.entries(overlay.inits)) {
    const { area, file } = entry;
    const at = { subject: name, kind: "init" as const, area, file };
    const known = inits?.get(name);
    if (inits !== undefined && known === undefined) {
      add({ ...at, code: "init-unknown", message: `${name} isn't an init contract at the pin.` });
    } else if (known?.area !== undefined && known.area !== area) {
      add({ ...at, code: "wrong-area", message: `${name} is in ${known.area}; move it to overlay/inits/${known.area}.yaml.` });
    }
    cite(name, "init", area, file, "source", entry.source);
    if (entry.sequence !== undefined) {
      if (entry.kind !== "bundle") add({ ...at, path: "sequence", code: "sequence-step", message: "only a bundle has a read-only sequence." });
      cite(name, "init", area, file, "sequence", entry.sequence.source);
    }
    for (const key of ["after", "sameCall"] as const) {
      entry[key]?.forEach((c, i) => {
        const path = `${key}[${i}]`;
        if (modules !== undefined && !modules.has(c.module)) {
          add({ ...at, path, code: "module-unknown", message: `no init at the pin initializes ${c.module}.` });
        }
        cite(name, "init", area, file, path, c.source);
      });
    }
    if (known?.registersInterfaces !== undefined && known.registersInterfaces !== (entry.registersInterfaces === true)) {
      add({
        ...at,
        path: "registersInterfaces",
        code: "registers-interfaces",
        message: known.registersInterfaces
          ? `${name} calls DiamondLib.registerInterface() itself; set registersInterfaces: true.`
          : `${name} doesn't call DiamondLib.registerInterface() itself; drop registersInterfaces.`,
      });
    }
    lintParams(entry.params, known?.params, `params`, { ...at }, add, cite, copy);
  }

  if (inits !== undefined) {
    for (const i of facts.inits ?? []) {
      const entry = overlay.inits[i.name];
      const at = { subject: i.name, kind: "init" as const, ...(entry ? { area: entry.area, file: entry.file } : i.area ? { area: i.area } : {}) };
      if (entry === undefined) {
        add({ ...at, code: "no-entry", message: `${i.name} has no overlay entry: kind, units, rules and order aren't reviewed.` });
      }
      for (const path of undocumented(i.params ?? [], entry?.params, "params")) {
        add({ ...at, path, code: "init-docs", message: `${path.split(".").pop()} has no NatSpec @param and no overlay doc.` });
      }
    }
  }

  // ── seams
  for (const seam of facts.seams ?? []) {
    for (const f of [...seam.when, ...seam.anyOf]) {
      if (!facets.has(f)) add({ subject: seam.selector, kind: "seam", code: "seam-unknown", message: `${f} isn't in FacetInventory at the pin.` });
    }
    for (const f of seam.anyOf) {
      const known = facets.get(f);
      if (known !== undefined && !known.selectors.includes(seam.selector)) {
        add({ subject: seam.selector, kind: "seam", code: "seam-unknown", message: `${f} doesn't export ${seam.selector}.` });
      }
    }
  }

  const order = (i: LintIssue) => [i.kind, i.area ?? "", i.subject, i.code, i.path ?? "", i.message].join("\u0000");
  issues.sort((a, b) => (order(a) < order(b) ? -1 : order(a) > order(b) ? 1 : 0));
  return { errors: issues.filter((i) => i.severity === "error"), warnings: issues.filter((i) => i.severity === "warning") };
}

type Add = (i: Omit<LintIssue, "severity">) => void;
type At = { subject: string; kind: "init"; area: Area; file: string };

function lintParams(
  params: Record<string, InitParamOverlay> | undefined,
  known: readonly KnownParam[] | undefined,
  base: string,
  at: At,
  add: Add,
  cite: (subject: string, kind: LintIssue["kind"], area: Area, file: string, path: string, source: string | undefined) => void,
  copy: (subject: string, kind: LintIssue["kind"], area: Area, file: string, path: string, text: string) => void,
): void {
  for (const [pname, p] of Object.entries(params ?? {})) {
    const path = `${base}.${pname}`;
    const k = known?.find((q) => q.name === pname);
    if (known !== undefined && k === undefined) {
      add({ ...at, path, code: "param-unknown", message: `${at.subject} has no parameter ${pname}.` });
    }
    const type = k?.type;
    if (p.rule !== undefined) {
      const parsed = parseRule(p.rule);
      if (!parsed.ok) add({ ...at, path: `${path}.rule`, code: "rule-invalid", message: parsed.error });
      else if (type !== undefined) {
        for (const t of parsed.terms) {
          const why = misfit(t.kind, type);
          if (why !== undefined) add({ ...at, path: `${path}.rule`, code: "rule-type", message: why });
        }
      }
    }
    if (p.unit !== undefined && type !== undefined) {
      const why = misfit("unit", type);
      if (why !== undefined) add({ ...at, path: `${path}.unit`, code: "rule-type", message: why });
    }
    if (p.components !== undefined && k !== undefined && k.components === undefined) {
      add({ ...at, path: `${path}.components`, code: "param-unknown", message: `${pname} isn't a tuple.` });
    }
    cite(at.subject, "init", at.area, at.file, path, p.source);
    if (p.exampleSource !== undefined) cite(at.subject, "init", at.area, at.file, `${path}.exampleSource`, p.exampleSource);
    if (p.doc !== undefined) copy(at.subject, "init", at.area, at.file, `${path}.doc`, p.doc);
    lintParams(p.components, k?.components, `${path}.components`, at, add, cite, copy);
  }
}

/** Paths of known params (and tuple components) with neither a NatSpec doc nor an overlay doc. */
function undocumented(known: readonly KnownParam[], overlay: Record<string, InitParamOverlay> | undefined, base: string): string[] {
  const out: string[] = [];
  for (const k of known) {
    const o = overlay?.[k.name];
    const path = `${base}.${k.name}`;
    if ((k.doc === undefined || k.doc.trim() === "") && o?.doc === undefined) out.push(path);
    if (k.components !== undefined) out.push(...undocumented(k.components, o?.components, `${path}.components`));
  }
  return out;
}

// ── reporting ──────────────────────────────────────────────────────────────────────────────────────

/** Error and warning counts per area, every area listed, plus seam issues (no area). */
export function lintCounts(result: LintResult): Record<Area | "other", { errors: number; warnings: number }> {
  const counts = Object.fromEntries([...AREAS, "other"].map((a) => [a, { errors: 0, warnings: 0 }])) as Record<
    Area | "other",
    { errors: number; warnings: number }
  >;
  for (const i of [...result.errors, ...result.warnings]) {
    const bucket = counts[i.area ?? "other"];
    if (i.severity === "error") bucket.errors++;
    else bucket.warnings++;
  }
  return counts;
}

/** One line per issue: `error overlay/facets/tokens.yaml ERC20 requires[0]: ERC20X isn't in FacetInventory at the pin.` */
export function formatIssue(i: LintIssue): string {
  const where = [i.file ?? i.area ?? i.kind, i.subject, i.path].filter((s) => s !== undefined && s !== "").join(" ");
  return `${i.severity} ${i.code} ${where}: ${i.message}`;
}

/** The summary `bun run catalog` prints: totals, then counts per area that has any, then every error. */
export function formatLintSummary(result: LintResult): string {
  const lines = [`Overlay lint: ${result.errors.length} error${result.errors.length === 1 ? "" : "s"}, ${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"}.`];
  for (const [area, c] of Object.entries(lintCounts(result))) {
    if (c.errors + c.warnings > 0) lines.push(`  ${area}: ${c.errors} error${c.errors === 1 ? "" : "s"}, ${c.warnings} warning${c.warnings === 1 ? "" : "s"}`);
  }
  for (const e of result.errors) lines.push(`  ${formatIssue(e)}`);
  return lines.join("\n");
}

/** Schema and file issues from `loadOverlay`, one per line, for the same summary. */
export function formatParseIssues(issues: readonly ParseIssue[]): string {
  return issues.map((i) => `error ${i.file ?? ""} ${i.path}: ${i.message}`.replace(/\s+/g, " ")).join("\n");
}
