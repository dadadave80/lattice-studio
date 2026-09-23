import { afterEach, describe, expect, test } from "bun:test";
import type { CommandId } from "@lattice-studio/core";
import { command, defineCommands, type Command } from "@/contracts";
import { bufferedServices } from "@/contracts/services";
import { isolateContracts } from "@/contracts/test-support";
import { setupKit, type Kit } from "@/state/testing";
import { formsOf, helpLines, listVerbs, route, runConsoleLine, tokenize } from "./router";

const ok = () => ({ ok: true as const });

/** An export form: `export <sub>` with no further words. */
function exporter(id: CommandId, sub: string, ran: string[]): Command {
  return command({
    id,
    title: () => `Export ${sub}`,
    category: "Export",
    console: {
      verb: "export",
      sub,
      syntax: `export ${sub}`,
      parse: (argv) => (argv.length ? { ok: false, error: `export ${sub} takes no more words.` } : { ok: true, value: {} }),
    },
    enabled: ok,
    run: () => void ran.push(id),
  });
}

let restore: (() => void) | null = null;
let kit: Kit | null = null;
afterEach(() => {
  kit?.dispose();
  kit = null;
  restore?.();
  restore = null;
});

describe("tokenize", () => {
  test("words, with quotes keeping spaces and coming off", () => {
    expect(tokenize("  place   erc20 ")).toEqual(["place", "erc20"]);
    expect(tokenize('set erc20init.name "My vault"')).toEqual(["set", "erc20init.name", "My vault"]);
    expect(tokenize("set name ‘Vault’ 'a b'")).toEqual(["set", "name", "Vault", "a b"]);
    expect(tokenize('set name ""')).toEqual(["set", "name", ""]);
    expect(tokenize("")).toEqual([]);
  });
});

describe("shared verbs", () => {
  test("a sub names the form: export project runs project.exportFile", async () => {
    restore = isolateContracts();
    const ran: string[] = [];
    defineCommands([
      exporter("export.foundry", "foundry", ran),
      exporter("export.brief", "brief", ran),
      exporter("export.recipeJson", "json", ran),
      exporter("project.exportFile", "project", ran),
      exporter("export.safe", "safe", ran),
    ]);
    const routed = route(tokenize("export project"));
    expect(routed.ok && routed.ref).toEqual({ id: "project.exportFile" });
    expect(route(["EXPORT", "Foundry"]).ok && (route(["EXPORT", "Foundry"]) as { ref: { id: string } }).ref.id).toBe("export.foundry");
    await runConsoleLine("export project");
    expect(ran).toEqual(["project.exportFile"]);

    const unknown = route(["export", "image"]);
    expect(unknown).toMatchObject({ ok: false, error: "export takes one of: foundry, brief, json, project, safe." });
    expect(route(["export", "project", "now"])).toMatchObject({ ok: false, error: "export project takes no more words." });
    expect(helpLines("export")?.map((l) => [l.syntax, l.id])).toEqual([
      ["export foundry", "export.foundry"],
      ["export brief", "export.brief"],
      ["export json", "export.recipeJson"],
      ["export project", "project.exportFile"],
      ["export safe", "export.safe"],
    ]);
  });

  test("without a sub, the first form whose parse accepts: route <facet> and route <facet> <selector>", () => {
    kit = setupKit();
    const all = route(tokenize("route hyperlanegatewayadapter"));
    expect(all.ok && all.ref).toEqual({ id: "facet.routeContested", args: { facet: "HyperlaneGatewayAdapter" } });
    const one = route(tokenize("route HyperlaneGatewayAdapter sendMessage"));
    expect(one.ok && one.ref.id).toBe("selector.route");
    expect(one.ok && one.ref.args?.facet).toBe("HyperlaneGatewayAdapter");
    expect(one.ok && typeof one.ref.args?.selector === "string" && /^0x[0-9a-f]{8}$/.test(one.ref.args.selector)).toBe(true);
    expect(helpLines("route")?.map((l) => l.id)).toEqual(["selector.route", "facet.routeContested"]);
  });

  test("when no form accepts, the error of the form the words fit", () => {
    kit = setupKit();
    // Two words fit route <facet> <selector>: its error, not the one-word form's.
    expect(route(tokenize("route HyperlaneGatewayAdapter 0x12345678"))).toMatchObject({
      ok: false,
      error: "HyperlaneGatewayAdapter has no selector 0x12345678.",
    });
    const three = route(tokenize("route a b c"));
    expect(three.ok).toBe(false);
    expect(three.ok ? [] : three.forms.map((f) => f.command.id)).toEqual(["selector.route", "facet.routeContested"]);
  });
});

describe("verbs and aliases", () => {
  test("aliases reach the same command; verbs are case-insensitive", () => {
    kit = setupKit();
    const placed = route(["ADD", "erc20"]);
    expect(placed.ok && placed.ref.id).toBe("facet.place");
    expect(formsOf("rm").map((f) => f.command.id)).toEqual(["facet.remove"]);
    const verbs = listVerbs();
    expect(verbs.find((v) => v.verb === "place")?.aliases).toEqual(["add"]);
    expect(helpLines("add")?.[0]).toEqual({ syntax: "place <facet>", id: "facet.place", aliases: ["add"] });
    expect(helpLines()?.some((l) => l.syntax === "undo")).toBe(true);
  });

  test("unknown and empty input say what to do; runConsoleLine logs it", async () => {
    kit = setupKit();
    expect(route(["frobnicate"])).toEqual({ ok: false, error: "“frobnicate” isn't a command. Type help for commands.", forms: [] });
    expect(route([])).toMatchObject({ ok: false, error: "Type a command. Type help for commands." });
    expect(helpLines("frobnicate")).toBeNull();
    const outcome = await runConsoleLine("frobnicate now");
    expect(outcome).toEqual({ ok: false, reason: "“frobnicate” isn't a command. Type help for commands." });
    expect(bufferedServices().log.at(-1)).toMatchObject({ tag: "Note", text: "“frobnicate” isn't a command. Type help for commands." });
  });

  test("a routed line runs through the registry with source console", async () => {
    kit = setupKit();
    kit.clearLines();
    const outcome = await runConsoleLine("place ERC20");
    expect(outcome).toEqual({ ok: true });
    expect(kit.state).toBeDefined();
    expect(kit.texts().length).toBeGreaterThan(0);
  });
});
