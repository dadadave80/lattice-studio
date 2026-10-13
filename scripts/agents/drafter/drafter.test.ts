import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { catalogPin, getTemplate, listTemplates, loadCatalog } from "./catalog";
import { chatCompletion, type DrafterDeps, parseArguments, runDrafter, type StepRecord } from "./drafter";
import { checkPassport, feedbackCommand } from "./erc8004";
import { checkRecipe } from "./tools";
import type { ChatReply, ToolResult } from "./types";

function call(id: string, name: string, args: unknown): ChatReply {
  return { content: null, tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] };
}

/** A fake model that replies from a script, and fake tools that answer from per-tool queues. */
function scripted(replies: readonly ChatReply[], results: Readonly<Record<string, readonly ToolResult[]>>) {
  const steps: StepRecord[] = [];
  const sent: number[] = [];
  const used = new Map<string, number>();
  let turn = 0;
  const deps: DrafterDeps = {
    catalogSummary: "ERC20: a fungible token",
    chat: async (messages) => {
      sent.push(messages.length);
      const reply = replies[Math.min(turn, replies.length - 1)];
      turn += 1;
      return reply ?? { content: "done" };
    },
    runTool: async (name) => {
      const queue = results[name] ?? [];
      const at = used.get(name) ?? 0;
      used.set(name, at + 1);
      return queue[Math.min(at, queue.length - 1)] ?? { exitCode: null, error: "No scripted result." };
    },
    record: (entry) => {
      steps.push(entry);
    },
  };
  return { deps, steps, sent };
}

describe("runDrafter", () => {
  test("fixes a failing check, then submits and is accepted", async () => {
    const recipe = { name: "Draft" };
    const s = scripted(
      [call("1", "get_template", { name: "ERC20" }), call("2", "check_recipe", { recipe }), call("3", "check_recipe", { recipe }), call("4", "submit_recipe", { recipe })],
      {
        get_template: [{ exitCode: null, recipe }],
        check_recipe: [{ exitCode: 1, ruleIds: ["INIT-05"] }, { exitCode: 0, ruleIds: [] }],
        submit_recipe: [{ exitCode: 0, accepted: true, recipe }],
      },
    );
    const result = await runDrafter("an ERC20", { maxSteps: 8 }, s.deps);
    expect(result.recipe).toEqual(recipe);
    expect(result.steps).toBe(4);
    expect(s.steps.map((step) => step.exitCode)).toEqual([null, 1, 0, 0]);
  });

  test("a refused submission isn't accepted", async () => {
    const s = scripted([call("1", "submit_recipe", { recipe: {} })], { submit_recipe: [{ exitCode: 1, accepted: false, error: "Refused" }] });
    expect((await runDrafter("an ERC20", { maxSteps: 3 }, s.deps)).recipe).toBeNull();
  });

  test("a model that never calls a tool is nudged each step and stops at --max-steps", async () => {
    const s = scripted([{ content: "Here is a recipe." }], {});
    const result = await runDrafter("an ERC20", { maxSteps: 3 }, s.deps);
    expect(result.recipe).toBeNull();
    expect(result.steps).toBe(3);
    expect(s.sent).toEqual([2, 4, 6]);
  });
});

describe("parseArguments", () => {
  test("bad JSON becomes an error the model sees", () => {
    expect(parseArguments("{oops").ok).toBe(false);
    expect(parseArguments('{"name":"ERC20"}')).toEqual({ ok: true, value: { name: "ERC20" } });
  });
});

describe("chatCompletion", () => {
  test("an API error names the status, never the key", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response("denied", { status: 401 })) as unknown as typeof fetch;
    try {
      const error = await chatCompletion("https://example.invalid/v1", "sk-SECRET-KEY", "qwen3.8-max", [], []).catch((e: unknown) => e);
      expect(String(error)).toContain("401");
      expect(String(error)).not.toContain("sk-SECRET-KEY");
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("erc8004", () => {
  const digest = `0x${"ab".repeat(32)}`;
  test("feedback is refused when a claim failed, and carries the digest when none did", () => {
    expect(checkPassport({ kind: "lattice-passport/v1", digest, claims: [{ id: "PP-03", status: "fail" }] })).toContain("PP-03");
    expect(checkPassport({ kind: "lattice-passport/v1", digest, claims: [{ id: "PP-01", status: "pass" }] })).toBeNull();
    expect(feedbackCommand("7", digest, "https://example.invalid/passport.json")).toContain(digest);
  });
});

describe("the bundled catalog", () => {
  test("offers the ERC20 template, pinned to the catalog it came from", () => {
    const catalog = loadCatalog();
    expect(listTemplates(catalog).some((template) => template.name === "ERC20")).toBe(true);
    expect(getTemplate(catalog, "ERC20")?.["catalog"]).toEqual(catalogPin(catalog));
  });
});

describe("check_recipe on the real CLI", () => {
  test("reads the example recipe and returns its hash", async () => {
    const example = join(import.meta.dir, "..", "..", "..", "docs", "examples", "erc20.recipe.json");
    const checked = await checkRecipe(JSON.parse(readFileSync(example, "utf8")));
    expect([0, 1]).toContain(checked.exitCode);
    expect(checked.recipeHash ?? "").toMatch(/^0x[0-9a-fA-F]{64}$/);
  }, 60_000);

  test("accepts the ERC20 template as a recipe file", async () => {
    const checked = await checkRecipe(getTemplate(loadCatalog(), "ERC20"));
    expect([0, 1]).toContain(checked.exitCode);
  }, 60_000);
});
