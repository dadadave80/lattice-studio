import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { COMMAND_IDS, COMMAND_OWNERS, NotImplemented } from "@lattice-studio/core";
import {
  command, commandContext, commandState, commandsVersion, defineCommands, getCommand, isPlaceholder, listBindings,
  listCommands, onCommandRun, overrideCommands, runCommand, subscribeCommands,
} from "./commands";
import { seedDeployState } from "./deploy";
import { bufferedServices } from "./services";
import { session } from "./stores";
import { isolateContracts } from "./test-support";

let restore: () => void;
beforeEach(() => {
  restore = isolateContracts();
});
afterEach(() => restore());

const texts = () => bufferedServices().log.map((l) => l.text);
const noop = () => {};

describe("placeholders", () => {
  test("every CommandId resolves to a placeholder naming its owner", () => {
    expect(COMMAND_IDS.length).toBeGreaterThan(100);
    for (const id of COMMAND_IDS) {
      expect(isPlaceholder(id)).toBe(true);
      expect(getCommand(id).id).toBe(id);
      expect(commandState({ id })).toEqual({ ok: false, reason: `Not built yet · WP-${COMMAND_OWNERS[id]}`, title: id });
    }
    expect(listCommands().map((c) => c.id)).toEqual(COMMAND_IDS);
  });

  test("running a placeholder reports Not built yet · WP-<owner> and runs nothing", async () => {
    expect(await runCommand({ id: "sheet.zoomIn" }, "keys")).toEqual({ ok: false, reason: "Not built yet · WP-S4b" });
    expect(texts()).toEqual(["Not built yet · WP-S4b"]);
    expect(bufferedServices().announce.map(([t]) => t)).toEqual(["Not built yet · WP-S4b"]);
  });
});

describe("registration", () => {
  test("a module-level commands.ts registration replaces the placeholder", async () => {
    expect(isPlaceholder("about.open")).toBe(true);
    await import("../../test/harness/fixtures/commands");
    expect(isPlaceholder("about.open")).toBe(false);
    expect(commandState({ id: "about.open" })).toEqual({ ok: true, title: "About Lattice Studio" });
    // Registration order decides console verbs: real commands follow the placeholders.
    expect(listCommands().at(-1)?.id).toBe("about.open");

    const ran: string[] = [];
    onCommandRun((ref, source) => ran.push(`${ref.id}:${source}`));
    expect(await runCommand({ id: "about.open" }, "palette")).toEqual({ ok: true });
    expect(texts()).toContain("Opened About.");
    expect(ran).toEqual(["about.open:palette"]);
  });

  test("a duplicate real registration throws and registers nothing", () => {
    const real = command({ id: "tour.start", title: () => "Take the tour", category: "Session", enabled: () => ({ ok: true }), run: noop });
    defineCommands([real]);
    expect(() => defineCommands([real])).toThrow("Command tour.start is already registered. WP-S10 registers it once.");
    expect(() => defineCommands([{ ...real, id: "tour.end" }, { ...real, id: "tour.end" }])).toThrow(
      "Command tour.end is already registered.",
    );
    expect(isPlaceholder("tour.end")).toBe(true);
  });

  test("an unknown id throws", () => {
    const bogus = { id: "nope.never", title: () => "", category: "Session", enabled: () => ({ ok: true }), run: noop };
    expect(() => defineCommands([bogus as unknown as Parameters<typeof defineCommands>[0][number]])).toThrow(
      "\"nope.never\" isn't a command id",
    );
  });

  test("registrations notify subscribers; the test's registrations don't outlive it", () => {
    let calls = 0;
    const stop = subscribeCommands(() => calls++);
    const before = commandsVersion();
    defineCommands([command({ id: "tour.end", title: () => "End tour", category: "Session", enabled: () => ({ ok: true }), run: noop })]);
    stop();
    expect(calls).toBe(1);
    expect(commandsVersion()).toBe(before + 1);
  });

  test("overrideCommands replaces a real command until disposed", () => {
    defineCommands([command({ id: "tour.end", title: () => "End tour", category: "Session", enabled: () => ({ ok: true }), run: noop })]);
    const dispose = overrideCommands([
      command({ id: "tour.end", title: () => "Fake end", category: "Session", enabled: () => ({ ok: false, reason: "No tour." }), run: noop }),
    ]);
    expect(commandState({ id: "tour.end" })).toEqual({ ok: false, reason: "No tour.", title: "Fake end" });
    dispose();
    expect(commandState({ id: "tour.end" })).toEqual({ ok: true, title: "End tour" });
  });
});

describe("key bindings", () => {
  const nudge = command<{ dir: string; step: string }>({
    id: "sheet.nudge",
    title: (a) => `Nudge ${a.dir}`,
    category: "Sheet",
    keyContext: ["sheet"],
    bindings: [
      { name: "left", keys: ["ArrowLeft"], args: { dir: "left", step: "small" } },
      { name: "left-large", keys: ["Shift+ArrowLeft"], args: { dir: "left", step: "large" } },
    ],
    enabled: () => ({ ok: true }),
    run: noop,
  });

  test("bindings carry their command's arguments, and plain keys bind the bare command", () => {
    defineCommands([
      nudge,
      command({ id: "palette.open", title: () => "Open the palette", category: "Session", keys: ["Mod+k"], enabled: () => ({ ok: true }), run: noop }),
    ]);
    const bindings = listBindings({});
    expect(bindings.find((b) => b.id === "sheet.nudge#left-large")).toEqual({
      id: "sheet.nudge#left-large",
      ref: { id: "sheet.nudge", args: { dir: "left", step: "large" } },
      defaults: ["Shift+ArrowLeft"],
      keys: ["Shift+ArrowLeft"],
      keyContext: ["sheet"],
    });
    expect(bindings.find((b) => b.id === "palette.open")).toMatchObject({ ref: { id: "palette.open" }, keys: ["Mod+k"] });
  });

  test("a remap targets one binding; an empty list unbinds it", () => {
    defineCommands([nudge]);
    const bindings = listBindings({ "sheet.nudge#left": ["h"], "sheet.nudge#left-large": [] });
    expect(bindings.find((b) => b.id === "sheet.nudge#left")?.keys).toEqual(["h"]);
    expect(bindings.find((b) => b.id === "sheet.nudge#left-large")?.keys).toEqual([]);
  });

  test("two bindings with one name throw", () => {
    expect(() =>
      defineCommands([{ ...nudge, bindings: [{ name: "x", keys: ["a"] }, { name: "x", keys: ["b"] }] }]),
    ).toThrow("two bindings with one name");
  });
});

describe("runCommand and commandState", () => {
  test("the context carries the ref, its args and the deploy state", async () => {
    seedDeployState({ phase: "proposed" });
    let seen: unknown = null;
    defineCommands([
      command<{ facet: string }>({
        id: "facet.place",
        title: (args) => `Place ${args.facet}`,
        category: "Build",
        enabled: (ctx) => (ctx.deploy.phase === "proposed" ? { ok: true } : { ok: false, reason: "no" }),
        run: (ctx) => {
          seen = ctx.ref;
        },
      }),
    ]);
    expect(commandContext("api", { id: "facet.place", args: { facet: "ERC20" } }).ref.args).toEqual({ facet: "ERC20" });
    expect(commandState({ id: "facet.place", args: { facet: "ERC20" } }).title).toBe("Place ERC20");
    await runCommand({ id: "facet.place", args: { facet: "ERC20" } }, "console");
    expect(seen).toEqual({ id: "facet.place", args: { facet: "ERC20" } });
  });

  test("a disabled command logs and announces its reason and doesn't run", async () => {
    let ran = false;
    defineCommands([
      command({
        id: "layout.tidy",
        title: () => "Tidy",
        category: "Sheet",
        enabled: (ctx) => (ctx.session.readOnly ? { ok: false, reason: ctx.session.readOnly } : { ok: true }),
        run: () => {
          ran = true;
        },
      }),
    ]);
    session.set({ readOnly: "Read-only: another tab is editing this project." });
    expect(await runCommand({ id: "layout.tidy" }, "keys")).toEqual({ ok: false, reason: "Read-only: another tab is editing this project." });
    expect(ran).toBe(false);
    expect(texts()).toEqual(["Read-only: another tab is editing this project."]);
  });

  test("an enabled() that throws disables the command and logs an Error, never throws", async () => {
    defineCommands([
      command({
        id: "layout.tidy",
        title: () => "Tidy",
        category: "Sheet",
        enabled: () => {
          throw new Error("layout is broken");
        },
        run: noop,
      }),
    ]);
    const original = console.error;
    console.error = noop;
    try {
      expect(commandState({ id: "layout.tidy" })).toEqual({ ok: false, reason: "layout is broken", title: "Tidy" });
      expect(await runCommand({ id: "layout.tidy" }, "menu")).toEqual({ ok: false, reason: "layout is broken" });
    } finally {
      console.error = original;
    }
    expect(bufferedServices().log.filter((l) => l.tag === "Error").map((l) => l.text)).toEqual([
      "layout.tidy: layout is broken",
      "layout.tidy: layout is broken",
    ]);
  });

  test("run failures are logged, never thrown; NotImplemented reads Not built yet", async () => {
    defineCommands([
      command({
        id: "export.foundry",
        title: () => "Export Foundry script",
        category: "Export",
        enabled: () => ({ ok: true }),
        run: () => {
          throw new NotImplemented("C7a", "exportFoundry");
        },
      }),
    ]);
    expect(await runCommand({ id: "export.foundry" }, "menu")).toEqual({ ok: false, reason: "Not built yet · WP-C7a" });
    expect(bufferedServices().log.map((l) => [l.tag, l.text])).toEqual([["Note", "Not built yet · WP-C7a"]]);
  });
});
