/**
 * The Lattice Drafter: Qwen 3.8 Max drafts a recipe through Studio's own CLI and may finish only when `check` exits
 * 0. It never deploys and never signs.
 *
 *   bun scripts/agents/drafter/drafter.ts "<intent>" --out .drafts/<name>.recipe.json [--max-steps 12]
 *
 * Environment: DRAFTER_API_KEY (required), DRAFTER_BASE_URL, DRAFTER_MODEL, DRAFTER_DISABLE_THINKING=1.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { facetSummary, loadCatalog } from "./catalog";
import { buildSystemPrompt } from "./prompt";
import { makeRunTool } from "./tools";
import type { ChatMessage, ChatReply, ParsedArguments, ToolCall, ToolResult, ToolSchema } from "./types";

export const TOOL_SCHEMAS: readonly ToolSchema[] = [
  { type: "function", function: { name: "list_templates", description: "List the catalog's recipe templates with their facet counts.", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "get_template", description: "Get one template as a recipe to start from.", parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } } },
  { type: "function", function: { name: "check_recipe", description: "Run Lattice Studio's deterministic checks. Exit code 0 means no blockers.", parameters: { type: "object", properties: { recipe: { type: "object" } }, required: ["recipe"] } } },
  { type: "function", function: { name: "plan_recipe", description: "Show the cut plan for a recipe.", parameters: { type: "object", properties: { recipe: { type: "object" } }, required: ["recipe"] } } },
  { type: "function", function: { name: "submit_recipe", description: "Submit the final recipe. Accepted only if check exits 0.", parameters: { type: "object", properties: { recipe: { type: "object" } }, required: ["recipe"] } } },
];

export interface DrafterOptions {
  readonly maxSteps: number;
}
export interface StepRecord {
  readonly step: number;
  readonly tool: string;
  readonly exitCode: number | null;
  readonly ruleIds: readonly string[];
}
export interface DrafterResult {
  readonly recipe: unknown;
  readonly steps: number;
  readonly final: ToolResult | null;
}
export interface DrafterDeps {
  readonly catalogSummary: string;
  readonly chat: (messages: readonly ChatMessage[], tools: readonly ToolSchema[]) => Promise<ChatReply>;
  readonly runTool: (name: string, args: ParsedArguments) => Promise<ToolResult>;
  readonly record: (entry: StepRecord) => void;
}

const NUDGE = "Use the tools. Finish only with submit_recipe.";

export function parseArguments(text: string): ParsedArguments {
  try {
    const value: unknown = JSON.parse(text === "" ? "{}" : text);
    if (typeof value === "object" && value !== null && !Array.isArray(value)) return { ok: true, value: value as Record<string, unknown> };
    return { ok: false, error: "The arguments weren't a JSON object." };
  } catch {
    return { ok: false, error: "The arguments weren't valid JSON." };
  }
}

export async function runDrafter(intent: string, opts: DrafterOptions, deps: DrafterDeps): Promise<DrafterResult> {
  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(deps.catalogSummary) },
    { role: "user", content: intent },
  ];
  const runCalls = async (calls: readonly ToolCall[], index: number, step: number): Promise<DrafterResult | null> => {
    const call = calls[index];
    if (call === undefined) return null;
    const result = await deps.runTool(call.function.name, parseArguments(call.function.arguments));
    deps.record({ step, tool: call.function.name, exitCode: result.exitCode, ruleIds: result.ruleIds ?? [] });
    messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result).slice(0, 12_000) });
    if (call.function.name === "submit_recipe" && result.accepted === true) return { recipe: result.recipe ?? null, steps: step, final: result };
    return runCalls(calls, index + 1, step);
  };
  const turn = async (step: number): Promise<DrafterResult> => {
    if (step > opts.maxSteps) return { recipe: null, steps: opts.maxSteps, final: null };
    const reply = await deps.chat(messages, TOOL_SCHEMAS);
    const calls = reply.tool_calls ?? [];
    if (calls.length === 0) {
      messages.push({ role: "assistant", content: reply.content ?? "" });
      messages.push({ role: "user", content: NUDGE });
      return turn(step + 1);
    }
    messages.push({ role: "assistant", content: reply.content ?? "", tool_calls: calls });
    return (await runCalls(calls, 0, step)) ?? turn(step + 1);
  };
  return turn(1);
}

export class ModelApiError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`The model API answered ${status}.`);
    this.status = status;
  }
}

export async function chatCompletion(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: readonly ChatMessage[],
  tools: readonly ToolSchema[],
  disableThinking = false,
): Promise<ChatReply> {
  const body: Record<string, unknown> = { model, messages, tools, tool_choice: "auto", temperature: 0 };
  if (disableThinking) body["enable_thinking"] = false;
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new ModelApiError(res.status);
  const data = (await res.json()) as { choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[] };
  const message = data.choices?.[0]?.message;
  if (message === undefined) throw new Error("The model API returned no message.");
  const content = message.content ?? null;
  return message.tool_calls === undefined ? { content } : { content, tool_calls: message.tool_calls };
}

/** One retry, after 2 seconds, on 429 or a 5xx. Anything else is thrown. */
export async function withRetry(call: () => Promise<ChatReply>): Promise<ChatReply> {
  try {
    return await call();
  } catch (error) {
    const status = error instanceof ModelApiError ? error.status : 0;
    if (status !== 429 && status < 500) throw error;
    await Bun.sleep(2_000);
    return await call();
  }
}

function flag(argv: readonly string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
}

function shortHash(hash: string | null | undefined): string {
  return typeof hash === "string" && hash.length > 12 ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : "unknown";
}

export async function main(argv: readonly string[]): Promise<number> {
  const head = argv[0];
  const intent = head !== undefined && !head.startsWith("--") ? head : undefined;
  const out = flag(argv, "--out");
  const maxSteps = Number(flag(argv, "--max-steps") ?? "12");
  if (intent === undefined || out === undefined || !Number.isSafeInteger(maxSteps) || maxSteps < 1) {
    process.stderr.write('Usage: bun scripts/agents/drafter/drafter.ts "<intent>" --out <file> [--max-steps 12]\n');
    return 2;
  }
  const apiKey = process.env["DRAFTER_API_KEY"] ?? "";
  if (apiKey === "") {
    process.stderr.write("Set DRAFTER_API_KEY to an Alibaba Cloud Model Studio key.\n");
    return 2;
  }
  const baseUrl = process.env["DRAFTER_BASE_URL"] ?? "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
  const model = process.env["DRAFTER_MODEL"] ?? "qwen3.8-max";
  const disableThinking = process.env["DRAFTER_DISABLE_THINKING"] === "1";

  const catalog = loadCatalog();
  const steps: StepRecord[] = [];
  const result = await runDrafter(intent, { maxSteps }, {
    catalogSummary: facetSummary(catalog),
    chat: (messages, tools) => withRetry(() => chatCompletion(baseUrl, apiKey, model, messages, tools, disableThinking)),
    runTool: makeRunTool(catalog),
    record: (entry) => {
      steps.push(entry);
    },
  });

  const checks = steps.filter((s) => s.tool === "check_recipe" || s.tool === "submit_recipe");
  const first = checks[0];
  const last = checks[checks.length - 1];
  const target = resolve(out);
  mkdirSync(dirname(target), { recursive: true });
  const pending = result.final?.pendingConfirmation ?? [];
  const transcript = {
    intent,
    model,
    disableThinking,
    steps,
    firstCheck: first === undefined ? null : { exitCode: first.exitCode, ruleIds: first.ruleIds },
    finalCheck: last === undefined ? null : { exitCode: last.exitCode, ruleIds: last.ruleIds },
    accepted: result.recipe !== null,
    recipeHash: result.final?.recipeHash ?? null,
    pendingConfirmation: pending,
  };
  writeFileSync(`${target}.transcript.json`, `${JSON.stringify(transcript, null, 2)}\n`);
  if (result.recipe === null) {
    process.stdout.write(`No recipe accepted in ${result.steps} steps. Transcript: ${out}.transcript.json\n`);
    return 1;
  }
  writeFileSync(target, `${JSON.stringify(result.recipe, null, 2)}\n`);
  const firstText = first === undefined ? "no check" : `first check exit ${first.exitCode}${first.ruleIds.length > 0 ? ` (${first.ruleIds.join(", ")})` : ""}`;
  const confirm = pending.length > 0 ? ` · confirm in Studio: ${pending.join(", ")}` : "";
  process.stdout.write(`Drafted ${out} in ${result.steps} steps · ${firstText} · final check exit ${last?.exitCode ?? "none"} · recipe ${shortHash(transcript.recipeHash)}${confirm}\n`);
  return 0;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
