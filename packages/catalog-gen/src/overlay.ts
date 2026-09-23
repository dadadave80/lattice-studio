/**
 * The metadata overlay (spec L15 decision 3, contracts §4 "Overlay files"): what Lattice's source states but no
 * compiler artifact carries, written once per area in `overlay/facets/<area>.yaml` and `overlay/inits/<area>.yaml`,
 * with a `source: <path>#L<a>-L<b>` citation at the pinned commit for every fact that comes from Lattice.
 *
 * This module holds the Zod schemas, the loader (`Bun.YAML`) and the projections onto the catalog's own shapes
 * (`Facet`'s overlay fields, `InitSpec`'s and `InitParam`'s). `overlay-lint.ts` checks the loaded overlay against
 * what the build knows. `overlay/README.md` documents the file format for authors.
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  AREAS,
  type Area,
  err,
  type Facet,
  type Hex4,
  type InitParam,
  type InitSpec,
  type Json,
  ok,
  type ParseIssue,
  type Result,
} from "@lattice-studio/core";
import * as z from "zod";

// ── citations ──────────────────────────────────────────────────────────────────────────────────────

/** `<path>#L<a>-L<b>`: a file in the Lattice checkout at the pin and an inclusive line range. */
export const SOURCE_PATTERN = /^([^\s#]+)#L([1-9]\d*)-L([1-9]\d*)$/;

/** A parsed citation. */
export type SourceRef = { path: string; from: number; to: number };

/** Parses `path#La-Lb`; `undefined` when it isn't one or the range runs backwards. */
export function parseSource(source: string): SourceRef | undefined {
  const m = SOURCE_PATTERN.exec(source);
  if (m === null) return undefined;
  const from = Number(m[2]);
  const to = Number(m[3]);
  if (to < from) return undefined;
  return { path: m[1] ?? "", from, to };
}

/** The `exampleSource` Studio writes on examples it made up (contracts §4); the UI says Studio wrote them. */
export const STUDIO_SOURCE = "studio";

const SourceSchema = z.string().refine((s) => parseSource(s) !== undefined, {
  message: "expected a citation like src/access/AccessControlInit.sol#L20-L24 (path#L<a>-L<b>, a ≤ b).",
});

const SelectorSchema = z.string().regex(/^0x[0-9a-f]{8}$/, {
  message: 'expected a quoted lowercase 4-byte selector like "0x06fdde03" (YAML reads 0x… unquoted as a number).',
});

const NameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, { message: "expected a Solidity identifier." });
const InitNameSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/, { message: "expected an init name like ERC20Init or DiamondIntrospectionInit.initUpgradeable." });
const TextSchema = z.string().trim().min(1, { message: "expected text." });

// ── facets/<area>.yaml ─────────────────────────────────────────────────────────────────────────────

const RequirementSchema = z.strictObject({
  anyOf: z.array(NameSchema).min(1, { message: "expected at least one facet." }),
  strength: z.enum(["hard", "convention"]),
  /** A lowercase clause that reads after "{facet} requires {option}: " (spec L321). */
  reason: TextSchema,
  source: SourceSchema,
});

const FacetOverlaySchema = z.strictObject({
  /** Overrides the NatSpec summary (spec L160) when the source's is missing or wrong. */
  summary: z.strictObject({ text: TextSchema, source: SourceSchema }).optional(),
  /** Present, even empty, once someone has reviewed the facet's requirements. */
  requires: z.array(RequirementSchema).optional(),
  family: z.strictObject({ name: z.enum(["upgrade", "access", "account"]), source: SourceSchema }).optional(),
  defaultOwnerOf: z
    .array(z.strictObject({ selectors: z.array(SelectorSchema).min(1), source: SourceSchema }))
    .min(1)
    .optional(),
  init: z.strictObject({ name: InitNameSchema, source: SourceSchema }).optional(),
  /** The seam review: what was checked about the selectors this facet shares, and what was found. */
  seamReview: TextSchema.optional(),
  notes: TextSchema.optional(),
});

/** One facet's overlay entry, as written. */
export type FacetOverlay = z.infer<typeof FacetOverlaySchema>;

const FacetsFileSchema = z.record(NameSchema, FacetOverlaySchema);

// ── inits/<area>.yaml ──────────────────────────────────────────────────────────────────────────────

/** Any YAML value except a number: numbers lose precision, so examples are quoted decimal strings. */
const ExampleSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([z.string(), z.boolean(), z.null(), z.array(ExampleSchema), z.record(z.string(), ExampleSchema)]),
);

/** One init parameter's overlay, as written. */
export type InitParamOverlay = {
  doc?: string | undefined;
  unit?: "seconds" | "percent" | "wei" | undefined;
  rule?: string | undefined;
  example?: Json | undefined;
  exampleSource?: string | undefined;
  authority?: true | undefined;
  role?: string | undefined;
  source?: string | undefined;
  components?: Record<string, InitParamOverlay> | undefined;
};

const InitParamOverlaySchema: z.ZodType<InitParamOverlay> = z.lazy(() =>
  z
    .strictObject({
      /** Help text; replaces the NatSpec `@param` when present. */
      doc: TextSchema.optional(),
      unit: z.enum(["seconds", "percent", "wei"]).optional(),
      /** Grammar in contracts §4; `overlay-lint.ts` parses it. */
      rule: TextSchema.optional(),
      example: z
        .unknown()
        .refine((v) => typeof v !== "number", { message: 'expected a quoted value like "300" (numbers lose precision).' })
        .pipe(ExampleSchema)
        .optional(),
      /** "studio", or the Lattice caller the example comes from. */
      exampleSource: z
        .string()
        .refine((s) => s === STUDIO_SOURCE || parseSource(s) !== undefined, {
          message: 'expected "studio" or a citation like script/base/defi/GrantExample.s.sol#L26-L26.',
        })
        .optional(),
      authority: z.literal(true).optional(),
      role: TextSchema.optional(),
      /** Cites where the unit, rule, authority or role comes from. */
      source: SourceSchema.optional(),
      components: z.record(NameSchema, InitParamOverlaySchema).optional(),
    })
    .superRefine((p, ctx) => {
      if ((p.example === undefined) !== (p.exampleSource === undefined)) {
        ctx.addIssue({ code: "custom", message: "example and exampleSource go together." });
      }
      if (p.role !== undefined && p.authority === undefined) {
        ctx.addIssue({ code: "custom", path: ["role"], message: "a role goes with authority: true." });
      }
      if (p.authority !== undefined && p.role === undefined) {
        ctx.addIssue({ code: "custom", path: ["authority"], message: "name the role an authority parameter receives." });
      }
      const sourced = p.unit !== undefined || p.rule !== undefined || p.authority !== undefined;
      if (sourced && p.source === undefined) {
        ctx.addIssue({ code: "custom", path: ["source"], message: "a unit, rule or authority needs a source." });
      }
    }),
);

const ModuleConstraintSchema = z.strictObject({ module: NameSchema, source: SourceSchema });

const InitOverlaySchema = z.strictObject({
  /** A bundle is one call whose order is fixed in Solidity (spec L178). */
  kind: z.enum(["step", "bundle"]),
  /** The init function at the pin: what `kind` and `registersInterfaces` are read from. */
  source: SourceSchema,
  params: z.record(NameSchema, InitParamOverlaySchema).optional(),
  /** Modules that must be initialized earlier (contracts §4: an init that initializes one itself satisfies it). */
  after: z.array(ModuleConstraintSchema).min(1).optional(),
  /** Modules that must initialize in the same `initialize()` call. */
  sameCall: z.array(ModuleConstraintSchema).min(1).optional(),
  /** Bundles: the internal order, shown read-only. */
  sequence: z.strictObject({ modules: z.array(TextSchema).min(1), source: SourceSchema }).optional(),
  /** True only when the init itself calls `DiamondLib.registerInterface()` (contracts §3.1). */
  registersInterfaces: z.literal(true).optional(),
  notes: TextSchema.optional(),
});

/** One init's overlay entry, as written. */
export type InitOverlay = z.infer<typeof InitOverlaySchema>;

const InitsFileSchema = z.record(InitNameSchema, InitOverlaySchema);

// ── the loaded overlay ─────────────────────────────────────────────────────────────────────────────

/** Where an entry was written. */
export type OverlayOrigin = { area: Area; file: string };

/** The whole overlay, keyed by facet and init name, each entry with the file it came from. */
export type Overlay = {
  facets: Record<string, FacetOverlay & OverlayOrigin>;
  inits: Record<string, InitOverlay & OverlayOrigin>;
};

/** Which half of the overlay a file belongs to. */
export type OverlayKind = "facets" | "inits";

function isArea(name: string): name is Area {
  return (AREAS as readonly string[]).includes(name);
}

function zodIssues(error: z.ZodError, file: string): ParseIssue[] {
  return error.issues.map((issue) => ({
    file,
    path: issue.path.map((p, i) => (typeof p === "number" ? `[${p}]` : i === 0 ? String(p) : `.${String(p)}`)).join(""),
    message: issue.message,
  }));
}

function parseYaml(text: string, file: string): Result<unknown, ParseIssue[]> {
  try {
    return ok(Bun.YAML.parse(text));
  } catch (e) {
    return err([{ file, path: "", message: `isn't valid YAML: ${e instanceof Error ? e.message : String(e)}` }]);
  }
}

/**
 * Parses one overlay file. `file` names it in issues (`overlay/facets/tokens.yaml`). An empty file is an empty
 * area. Returns the entries by name, or every schema issue with its path.
 */
export function parseOverlayFile(kind: "facets", text: string, file: string): Result<Record<string, FacetOverlay>, ParseIssue[]>;
export function parseOverlayFile(kind: "inits", text: string, file: string): Result<Record<string, InitOverlay>, ParseIssue[]>;
export function parseOverlayFile(
  kind: OverlayKind,
  text: string,
  file: string,
): Result<Record<string, FacetOverlay> | Record<string, InitOverlay>, ParseIssue[]> {
  const yaml = parseYaml(text, file);
  if (!yaml.ok) return yaml;
  const value = yaml.value ?? {};
  const parsed = kind === "facets" ? FacetsFileSchema.safeParse(value) : InitsFileSchema.safeParse(value);
  return parsed.success ? ok(parsed.data) : err(zodIssues(parsed.error, file));
}

/** A file to load: its kind, area, display name and text. Pure, so tests and the generator share `buildOverlay`. */
export type OverlayFile = { kind: OverlayKind; area: string; file: string; text: string };

/**
 * Builds the overlay from its files. Issues: a file whose name isn't an area, YAML or schema errors, and a facet
 * or init written in two files. All files are read before failing, so every issue comes back at once.
 */
export function buildOverlay(files: OverlayFile[]): Result<Overlay, ParseIssue[]> {
  const overlay: Overlay = { facets: {}, inits: {} };
  const issues: ParseIssue[] = [];
  const sorted = [...files].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  for (const f of sorted) {
    if (!isArea(f.area)) {
      issues.push({ file: f.file, path: "", message: `is named after ${JSON.stringify(f.area)}, which isn't an area (${AREAS.join(", ")}).` });
      continue;
    }
    const area = f.area;
    if (f.kind === "facets") {
      const parsed = parseOverlayFile("facets", f.text, f.file);
      if (!parsed.ok) {
        issues.push(...parsed.error);
        continue;
      }
      for (const [name, entry] of Object.entries(parsed.value)) {
        const seen = overlay.facets[name];
        if (seen !== undefined) {
          issues.push({ file: f.file, path: name, message: `is already written in ${seen.file}.` });
          continue;
        }
        overlay.facets[name] = { ...entry, area, file: f.file };
      }
    } else {
      const parsed = parseOverlayFile("inits", f.text, f.file);
      if (!parsed.ok) {
        issues.push(...parsed.error);
        continue;
      }
      for (const [name, entry] of Object.entries(parsed.value)) {
        const seen = overlay.inits[name];
        if (seen !== undefined) {
          issues.push({ file: f.file, path: name, message: `is already written in ${seen.file}.` });
          continue;
        }
        overlay.inits[name] = { ...entry, area, file: f.file };
      }
    }
  }
  return issues.length > 0 ? err(issues) : ok(overlay);
}

/** The overlay directory in this repo. */
export const OVERLAY_DIR = join(import.meta.dir, "..", "..", "..", "overlay");

async function yamlFiles(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((n) => n.endsWith(".yaml")).sort();
  } catch {
    return [];
  }
}

/**
 * Reads `<dir>/facets/*.yaml` and `<dir>/inits/*.yaml` with `Bun.YAML` and builds the overlay. Other files
 * (`seams.yaml`, `recipes/`) belong to CG6 and are left alone. Issue files are relative to `dir`'s parent.
 */
export async function loadOverlay(dir: string = OVERLAY_DIR): Promise<Result<Overlay, ParseIssue[]>> {
  const files: OverlayFile[] = [];
  for (const kind of ["facets", "inits"] as const) {
    for (const name of await yamlFiles(join(dir, kind))) {
      const text = await Bun.file(join(dir, kind, name)).text();
      files.push({ kind, area: name.slice(0, -".yaml".length), file: `overlay/${kind}/${name}`, text });
    }
  }
  return buildOverlay(files);
}

// ── projections onto the catalog ───────────────────────────────────────────────────────────────────

/** The overlay's part of a `Facet` (spec L160-L166): `summary` only when the overlay overrides NatSpec. */
export type FacetOverlayFields = Pick<Facet, "requires"> &
  Partial<Pick<Facet, "summary" | "family" | "defaultOwnerOf" | "init">>;

/** A facet's overlay fields, citations dropped. No entry, or no `requires` yet, gives `requires: []`. */
export function facetOverlayFields(entry: FacetOverlay | undefined): FacetOverlayFields {
  const out: FacetOverlayFields = {
    requires: (entry?.requires ?? []).map((r) => ({ anyOf: [...r.anyOf], strength: r.strength, reason: r.reason })),
  };
  if (entry === undefined) return out;
  if (entry.summary !== undefined) out.summary = entry.summary.text;
  if (entry.family !== undefined) out.family = entry.family.name;
  if (entry.defaultOwnerOf !== undefined) out.defaultOwnerOf = entry.defaultOwnerOf.flatMap((d) => d.selectors as Hex4[]);
  if (entry.init !== undefined) out.init = entry.init.name;
  return out;
}

/** An init parameter as extracted from Lattice (CG4): name, ABI type, NatSpec, tuple components. */
export type InitParamSkeleton = { name: string; type: string; doc: string; components?: InitParamSkeleton[] };

/** Merges one parameter's overlay onto its skeleton: the overlay's `doc` replaces NatSpec when present. */
export function applyParamOverlay(param: InitParamSkeleton, overlay: InitParamOverlay | undefined): InitParam {
  const out: InitParam = { name: param.name, type: param.type, doc: overlay?.doc ?? param.doc };
  if (overlay?.unit !== undefined) out.unit = overlay.unit;
  if (overlay?.rule !== undefined) out.rule = overlay.rule;
  if (overlay?.example !== undefined) out.example = overlay.example;
  if (overlay?.exampleSource !== undefined) out.exampleSource = overlay.exampleSource;
  if (overlay?.authority !== undefined) out.authority = true;
  if (overlay?.role !== undefined) out.role = overlay.role;
  if (param.components !== undefined) {
    out.components = param.components.map((c) => applyParamOverlay(c, overlay?.components?.[c.name]));
  }
  return out;
}

/** The overlay's part of an `InitSpec` (spec L175-L191). */
export type InitOverlayFields = Pick<InitSpec, "kind" | "after" | "sameCall"> & Partial<Pick<InitSpec, "sequence" | "registersInterfaces">>;

/** An init's overlay fields, citations dropped. No entry gives a step with no constraints. */
export function initOverlayFields(entry: InitOverlay | undefined): InitOverlayFields {
  const out: InitOverlayFields = {
    kind: entry?.kind ?? "step",
    after: (entry?.after ?? []).map((a) => a.module),
    sameCall: (entry?.sameCall ?? []).map((a) => a.module),
  };
  if (entry?.sequence !== undefined) out.sequence = [...entry.sequence.modules];
  if (entry?.registersInterfaces !== undefined) out.registersInterfaces = true;
  return out;
}

/**
 * Completes an InitSpec skeleton with its overlay entry: kind, `after`, `sameCall`, `sequence`, and each param's
 * doc, unit, rule, example, authority and role. `registersInterfaces` stays the skeleton's (CG4 reads it from the
 * source); the lint reports an overlay that disagrees.
 */
export function applyInitOverlay<T extends { params: InitParamSkeleton[]; registersInterfaces?: true }>(
  skeleton: T,
  entry: InitOverlay | undefined,
): Omit<T, "params" | "kind" | "after" | "sameCall" | "sequence"> & Omit<InitOverlayFields, "registersInterfaces"> & { params: InitParam[] } {
  const { registersInterfaces: _declared, ...fields } = initOverlayFields(entry);
  return {
    ...skeleton,
    ...fields,
    params: skeleton.params.map((p) => applyParamOverlay(p, entry?.params?.[p.name])),
  };
}

/** Every citation in the overlay, with where it is written, for checking against the checkout. */
export function overlaySources(overlay: Overlay): { file: string; at: string; source: string }[] {
  const out: { file: string; at: string; source: string }[] = [];
  const push = (file: string, at: string, source: string | undefined) => {
    if (source !== undefined && source !== STUDIO_SOURCE) out.push({ file, at, source });
  };
  for (const [name, f] of Object.entries(overlay.facets)) {
    push(f.file, `${name}.summary`, f.summary?.source);
    f.requires?.forEach((r, i) => push(f.file, `${name}.requires[${i}]`, r.source));
    push(f.file, `${name}.family`, f.family?.source);
    f.defaultOwnerOf?.forEach((d, i) => push(f.file, `${name}.defaultOwnerOf[${i}]`, d.source));
    push(f.file, `${name}.init`, f.init?.source);
  }
  const params = (file: string, at: string, ps: Record<string, InitParamOverlay> | undefined) => {
    for (const [p, v] of Object.entries(ps ?? {})) {
      push(file, `${at}.${p}`, v.source);
      push(file, `${at}.${p}.exampleSource`, v.exampleSource);
      params(file, `${at}.${p}.components`, v.components);
    }
  };
  for (const [name, i] of Object.entries(overlay.inits)) {
    push(i.file, name, i.source);
    params(i.file, `${name}.params`, i.params);
    i.after?.forEach((a, k) => push(i.file, `${name}.after[${k}]`, a.source));
    i.sameCall?.forEach((a, k) => push(i.file, `${name}.sameCall[${k}]`, a.source));
    push(i.file, `${name}.sequence`, i.sequence?.source);
  }
  return out;
}
