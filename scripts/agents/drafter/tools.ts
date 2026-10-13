import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getTemplate, listTemplates, type LoadedCatalog } from "./catalog";
import type { ParsedArguments, ToolResult } from "./types";

const REPO = join(import.meta.dir, "..", "..", "..");
const CLI = join(REPO, "packages", "cli", "src", "main.ts");

export type CliRun = { exitCode: number; stdout: string; stderr: string };
export type Checked = { exitCode: number; output: string; ruleIds: string[]; pendingConfirmation: string[]; recipeHash: string | null };
type Problem = { code?: unknown; params?: Record<string, unknown> };

/** Runs Studio's CLI from the repo root. The child never sees the model key. */
export async function runCli(args: readonly string[]): Promise<CliRun> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "DRAFTER_API_KEY"));
  const child = Bun.spawn([process.execPath, CLI, ...args], { cwd: REPO, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { exitCode, stdout, stderr };
}

function parsed(stdout: string): { problems?: unknown; recipeHash?: unknown } {
  try {
    return JSON.parse(stdout) as { problems?: unknown; recipeHash?: unknown };
  } catch {
    return {};
  }
}

async function withRecipeFile<T>(recipe: unknown, runWithFile: (file: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "drafter-"));
  const file = join(dir, "draft.recipe.json");
  try {
    writeFileSync(file, `${JSON.stringify(recipe, null, 2)}\n`);
    return await runWithFile(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * `check --json` on a recipe. LINK-01 (an authority address that came from a file) is a person's confirmation in
 * Studio, not a fix for the model: when check exits 1 with LINK-01 findings, it runs again with `--confirm` for
 * those paths, and the paths come back as pendingConfirmation so the person confirms them before deploying.
 */
export async function checkRecipe(recipe: unknown): Promise<Checked> {
  return withRecipeFile(recipe, async (file) => {
    const first = await runCli(["check", file, "--json"]);
    const report = parsed(first.stdout);
    const problems: Problem[] = Array.isArray(report.problems) ? (report.problems as Problem[]) : [];
    const ruleIds = [...new Set(problems.map((p) => p.code).filter((code): code is string => typeof code === "string"))];
    const confirms = problems
      .filter((p) => p.code === "LINK-01")
      .map((p) => ({ path: p.params?.["path"], address: p.params?.["address"] }))
      .filter((c): c is { path: string; address: string } => typeof c.path === "string" && typeof c.address === "string")
      .map((c) => `${c.path}=${c.address}`);
    const output = (first.stdout === "" ? first.stderr : first.stdout).slice(0, 12_000);
    const hashOf = (text: string): string | null => {
      const hash = parsed(text).recipeHash;
      return typeof hash === "string" ? hash : null;
    };
    if (first.exitCode !== 1 || confirms.length === 0) {
      return { exitCode: first.exitCode, output, ruleIds, pendingConfirmation: [], recipeHash: hashOf(first.stdout) };
    }
    const second = await runCli(["check", file, "--json", ...confirms.flatMap((c) => ["--confirm", c])]);
    return { exitCode: second.exitCode, output, ruleIds, pendingConfirmation: second.exitCode === 0 ? confirms : [], recipeHash: hashOf(second.stdout) };
  });
}

/** The tools as one dispatcher: catalog reads for templates, Studio's CLI for check and plan. */
export function makeRunTool(catalog: LoadedCatalog): (name: string, args: ParsedArguments) => Promise<ToolResult> {
  return async (name, args) => {
    if (!args.ok) return { exitCode: null, error: args.error };
    if (name === "list_templates") return { exitCode: null, output: JSON.stringify(listTemplates(catalog)) };
    if (name === "get_template") {
      const template = args.value["name"];
      if (typeof template !== "string") return { exitCode: null, error: "get_template needs { name }." };
      const recipe = getTemplate(catalog, template);
      return recipe === null ? { exitCode: null, error: `No loadable template is named ${template}. Call list_templates.` } : { exitCode: null, recipe };
    }
    const recipe = args.value["recipe"];
    if (typeof recipe !== "object" || recipe === null) return { exitCode: null, error: `${name} needs { recipe }.` };
    if (name === "plan_recipe") {
      const plan = await withRecipeFile(recipe, (file) => runCli(["plan", file]));
      return { exitCode: plan.exitCode, output: (plan.stdout === "" ? plan.stderr : plan.stdout).slice(0, 6_000) };
    }
    if (name !== "check_recipe" && name !== "submit_recipe") return { exitCode: null, error: `There's no tool named ${name}.` };
    const checked = await checkRecipe(recipe);
    const result: ToolResult = {
      exitCode: checked.exitCode,
      output: checked.output,
      ruleIds: checked.ruleIds,
      pendingConfirmation: checked.pendingConfirmation,
      recipeHash: checked.recipeHash,
    };
    if (name === "check_recipe") return result;
    if (checked.exitCode === 0) return { ...result, accepted: true, recipe };
    return { ...result, accepted: false, error: "Refused: check doesn't exit 0. Fix the findings, run check_recipe, then submit again." };
  };
}
