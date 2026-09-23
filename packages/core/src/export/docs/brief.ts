import { authorityTable } from "../../authority";
import { normalizeRecipe } from "../../canonical";
import { formatCutIndex, formatSelector, plural } from "../../format";
import { planInit } from "../../init/plan";
import type { ExportBriefFn } from "../../model/api";
import type { Facet } from "../../model/catalog";
import type { BriefExportArgs } from "../../model/io";
import type { Hex4 } from "../../model/hex";
import type { FieldModel, InitPlan, InitStepView } from "../../model/init";
import type { Problem } from "../../model/problems";
import type { Arg, Recipe } from "../../model/recipe";
import { buildPlan } from "../../plan";
import { cell, codeBlock, escapedLine, table } from "./markdown";
import { exportRecipeJson } from "./recipe-json";
import { slug } from "./slug";

function isRef(value: Arg): value is { $ref: "self" | "deployer" } {
  return typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, "$ref");
}

/**
 * An init argument in prose: `{$ref}` reads as what it names (spec L285); a tuple lists its fields. Every
 * string leaf goes through `escapedLine` (spec L21, L857: "every generated string is escaped") so a value
 * can't carry a literal newline into the Markdown list this renders into and inject a heading, a table row
 * or a fenced block of its own, and can't render as HTML (`<img onerror>`) where this list is read as prose.
 */
function describeArg(value: Arg): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return escapedLine(value);
  if (Array.isArray(value)) return value.length === 0 ? "[]" : `[${value.map(describeArg).join(", ")}]`;
  if (isRef(value)) return value.$ref === "self" ? "This diamond" : "Deploying account";
  const fields = Object.entries(value);
  // A tuple's field key is normally an ABI name, but the schema only forbids the literal "$ref" (model/schema.ts
  // ArgSchema), so a share link or file can still put hostile text here for a scalar-typed field or an
  // array element rendered as "invalid" (fields.ts): escape it exactly as a describeArg leaf.
  return fields.length === 0 ? "{}" : fields.map(([field, v]) => `${escapedLine(field)}: ${describeArg(v)}`).join("; ");
}

/** One field line, recursing into a tuple's components; a required field with no value is flagged missing. */
function fieldLines(field: FieldModel, value: Arg | undefined, missing: ReadonlySet<string>, indent: string): string[] {
  if (field.components && field.components.length > 0 && value !== undefined && !isRef(value) && !Array.isArray(value) && typeof value === "object") {
    const object = value as Record<string, Arg>;
    return [`${indent}- **${escapedLine(field.label)}**:`, ...field.components.flatMap((c) => fieldLines(c, object[c.name], missing, `${indent}  `))];
  }
  const shown = value === undefined ? "missing" : missing.has(field.path) ? `${describeArg(value)} — invalid` : describeArg(value);
  return [`${indent}- **${escapedLine(field.label)}** (\`${field.name}\`): ${shown}`];
}

function stepHeading(step: InitStepView): string {
  const label = step.automatic ? `\`${step.fn}\` on \`${step.contract}\` (automatic)` : `\`${step.fn}\` on \`${step.contract}\``;
  return step.locked && !step.automatic ? `${label} (locked)` : label;
}

function initPlanSection(plan: InitPlan, initTarget: string | undefined): string {
  if (plan.kind === "none") {
    return "No init call: this diamond deploys with an empty init (the zero address, no calldata).";
  }
  const missing = new Set(plan.steps.flatMap((step) => step.missing));
  const lines = plan.steps.map((step, i) => {
    const args = Object.entries(step.args);
    const body = step.fields.length > 0 ? step.fields.map((field) => fieldLines(field, step.args[field.name], missing, "   ")).flat() : [];
    return [`${i + 1}. ${stepHeading(step)}`, ...(body.length > 0 ? body : args.length === 0 ? ["   - no arguments"] : [])].join("\n");
  });
  const [only] = plan.steps;
  const shape =
    plan.steps.length <= 1
      ? `One call, direct${only ? ` to \`${only.contract}\`` : ""}${initTarget ? ` at \`${initTarget}\`` : ""}.`
      : `${plan.steps.length} calls through \`multiInit(address[],bytes[])\`${initTarget ? ` at \`${initTarget}\`` : ""}.`;
  const sequenceLine =
    plan.kind === "bundle" && plan.sequence
      ? `Locked bundle; internal order (read-only): ${escapedLine(plan.sequence.join(", "))}.`
      : undefined;
  const missingLine = missing.size > 0 ? `${plural(missing.size, "field needs", "fields need")} a value before this diamond can deploy.` : undefined;
  return [shape, sequenceLine, ...lines, missingLine].filter((line): line is string => line !== undefined).join("\n\n");
}

function describeHolder(row: { holder: Arg | null; anyone?: true }): string {
  if (row.anyone) return "anyone";
  if (row.holder === null) return "none";
  return describeArg(row.holder);
}

function selectorsOf(facet: Facet | undefined, hexes: readonly Hex4[]): string {
  return hexes
    .map((hex) => {
      const found = facet?.selectors.find((s) => s.hex.toLowerCase() === hex.toLowerCase());
      return formatSelector(found ?? { hex, signature: hex }, "dense");
    })
    .join(", ");
}

function cutPlanSection(
  recipe: Recipe,
  catalog: BriefExportArgs["catalog"],
  byName: ReadonlyMap<string, Facet>,
  routing: BriefExportArgs["analysis"]["routing"],
): string {
  const { entries, omitted } = buildPlan(recipe, catalog, routing);
  if (entries.length === 0) return "No cuts: no placed facet routes a selector.";
  const rows = entries.map((entry, i) => [
    cell(formatCutIndex(i)),
    cell(entry.facet),
    cell(entry.address),
    cell(entry.codehash),
    cell(entry.version),
    cell(selectorsOf(byName.get(entry.facet), entry.selectors)),
  ]);
  const head = table(["Cut", "Facet", "Address", "Codehash", "Version", "Selectors"], rows);
  const omittedLine =
    omitted.length > 0 ? `Placed but routes nothing, so no Add is cut for it: ${escapedLine(omitted.join(", "))}.` : undefined;
  return [head, omittedLine].filter((line): line is string => line !== undefined).join("\n\n");
}

function authoritySection(recipe: Recipe, catalog: BriefExportArgs["catalog"]): string {
  const rows = authorityTable(recipe, catalog);
  if (rows.length === 0) return "No authority rows: this diamond grants no role or right at init.";
  return table(
    ["Role", "Holder", "Via"],
    rows.map((row) => [cell(row.role), cell(describeHolder(row)), cell(row.via)]),
  );
}

function problemsSection(problems: readonly Problem[]): string {
  if (problems.length === 0) return "No open problems.";
  return problems.map((p) => `- **${p.severity}** \`${p.code}\` ${escapedLine(p.message)}`).join("\n");
}

/**
 * The brief's section order (spec L920-L923): C7b's own structure, never another WP's copy, so
 * `index.test.ts` can snapshot it without pinning the cut plan, the authority table or a problem's message.
 */
export const SECTION_HEADINGS = [
  "## Recipe",
  "## Cut plan",
  "## Init plan",
  "## Authority table",
  "## Open problems",
  "## Acceptance checks",
  "## What this leaves out",
] as const;

const ACCEPTANCE_CALL = 'cast call <diamond> "facets()((address,bytes4[])[])" --rpc-url $RPC_URL';

/** All fixed prose, so `index.test.ts` can snapshot it directly instead of the whole (partly foreign) brief. */
export function acceptanceSection(): string {
  return [
    "Compare what the diamond returns with the plan above:",
    codeBlock(ACCEPTANCE_CALL, "bash"),
    "Compare per facet as sets, address and selectors together: the factory applies registry cuts before custom cuts, so `facets()` can list them in a different order than the plan.",
    "Check each facet's codehash on the selected chain before trusting it, one `cast codehash <address> --rpc-url $RPC_URL` per row of the plan.",
    "Do not redeploy facets; check their codehashes.",
  ].join("\n\n");
}

/** Fixed prose plus one line whose count varies with open blockers; no other WP's copy. */
export function leavesOutSection(blockers: number): string {
  const lines = [
    "This brief leaves out the project's layout, deploy path, salt and scope, and its deployment records.",
    '"This diamond" and "Deploying account" are shown symbolically: no deploy context is set to resolve them to addresses.',
  ];
  if (blockers > 0) lines.push(`${plural(blockers, "blocker")} still open above; deploy and export stay blocked until they're resolved.`);
  return lines.join("\n\n");
}

/**
 * Self-contained agent brief (spec L920-L923, contracts §3.4): header, recipe JSON, cut plan, init plan,
 * authority table, open problems and acceptance checks written as commands, closing on
 * "Do not redeploy facets; check their codehashes." and what the brief leaves out.
 */
export const exportBrief: ExportBriefFn = (args) => {
  const { catalog, analysis, studioVersion } = args;
  const recipe = normalizeRecipe(args.recipe, catalog);
  const byName = new Map(catalog.facets.map((f) => [f.name, f]));
  const title = recipe.name ? escapedLine(recipe.name) : "Untitled diamond";
  const facetVersions =
    recipe.facets.length === 0
      ? "none"
      : recipe.facets.map((name) => `${name} ${byName.get(name)?.release.version ?? "unknown"}`).join(", ");
  const header = [
    `# ${title} agent brief`,
    [
      `- Recipe hash: \`${analysis.recipeHash}\``,
      `- Catalog: \`${catalog.lattice.tag}\``,
      `- Studio: ${studioVersion}`,
      `- Facets: ${escapedLine(facetVersions)}`,
    ].join("\n"),
  ].join("\n\n");
  const plan = planInit(recipe, catalog);
  const blockers = analysis.problems.filter((p) => p.severity === "blocker").length;
  const [recipeHeading, cutPlanHeading, initPlanHeading, authorityHeading, problemsHeading, acceptanceHeading, leavesOutHeading] =
    SECTION_HEADINGS;
  const sections = [
    header,
    recipeHeading,
    codeBlock(exportRecipeJson(recipe, catalog).text, "json"),
    cutPlanHeading,
    cutPlanSection(recipe, catalog, byName, analysis.routing),
    initPlanHeading,
    initPlanSection(plan, analysis.init?.target),
    authorityHeading,
    authoritySection(recipe, catalog),
    problemsHeading,
    problemsSection(analysis.problems),
    acceptanceHeading,
    acceptanceSection(),
    leavesOutHeading,
    leavesOutSection(blockers),
  ];
  return { filename: `${slug(recipe.name)}.brief.md`, mime: "text/markdown", text: `${sections.join("\n\n")}\n` };
};
