import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { COMMAND_IDS, COMMAND_OWNERS, NotImplemented } from "@lattice-studio/core";
import {
  command, commandState, defineCommands, getCommand, isPlaceholder, listCommands, onCommandRun, runCommand,
  snapshotCommands,
} from "./commands";
import { bufferedServices, resetServices } from "./services";
import { resetStores, session } from "./stores";

let restore: () => void;

beforeEach(() => {
  resetServices();
  resetStores();
  restore = snapshotCommands();
});

afterEach(() => restore());

const texts = () => bufferedServices().log.map((l) => l.text);

describe("placeholders", () => {
  test("every CommandId resolves to a placeholder naming its owner", () => {
    expect(COMMAND_IDS.length).toBeGreaterThan(100);
    for (const id of COMMAND_IDS) {
      expect(isPlaceholder(id)).toBe(true);
      const c = getCommand(id);
      expect(c.id).toBe(id);
      const state = commandState({ id });
      expect(state).toEqual({ ok: false, reason: `Not built yet · WP-${COMMAND_OWNERS[id]}`, title: id });
    }
    expect(listCommands().map((c) => c.id)).toEqual(COMMAND_IDS);
  });

  test("running a placeholder reports Not built yet · WP-<owner> and runs nothing", async () => {
    const outcome = await runCommand({ id: "sheet.zoomIn" }, "keys");
    expect(outcome).toEqual({ ok: false, reason: "Not built yet · WP-S4b" });
    expect(texts()).toEqual(["Not built yet · WP-S4b"]);
    expect(bufferedServices().announce.map(([t]) => t)).toEqual(["Not built yet · WP-S4b"]);
  });
});

describe("registration", () => {
  test("a module-level commands.ts registration replaces the placeholder", async () => {
    expect(isPlaceholder("about.open")).toBe(true);
    await import("./test-fixtures/commands");
    expect(isPlaceholder("about.open")).toBe(false);
    expect(getCommand("about.open").title({})).toBe("About Lattice Studio");
    expect(commandState({ id: "about.open" })).toEqual({ ok: true, title: "About Lattice Studio" });
    // Registration order decides console verbs: real commands follow the placeholders.
    expect(listCommands().at(-1)?.id).toBe("about.open");

    const ran: string[] = [];
    onCommandRun((ref, source) => ran.push(`${ref.id}:${source}`));
    expect(await runCommand({ id: "about.open" }, "palette")).toEqual({ ok: true });
    expect(texts()).toContain("Opened About.");
    expect(ran).toEqual(["about.open:palette"]);
  });

  test("a duplicate real registration throws", () => {
    const real = command({
      id: "tour.start",
      title: () => "Take the tour",
      category: "Session",
      enabled: () => ({ ok: true }),
      run: () => {},
    });
    defineCommands([real]);
    expect(() => defineCommands([real])).toThrow("Command tour.start is already registered. WP-S10 registers it once.");
    expect(() => defineCommands([{ ...real, id: "tour.end" }, { ...real, id: "tour.end" }])).toThrow(
      "Command tour.end is already registered.",
    );
    // A throwing call registers nothing.
    expect(isPlaceholder("tour.end")).toBe(true);
  });

  test("an unknown id throws", () => {
    const bogus = { id: "nope.never", title: () => "", category: "Session", enabled: () => ({ ok: true }), run: () => {} };
    expect(() => defineCommands([bogus as unknown as Parameters<typeof defineCommands>[0][number]])).toThrow(
      "\"nope.never\" isn't a command id",
    );
  });
});

describe("runCommand", () => {
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
    const outcome = await runCommand({ id: "layout.tidy" }, "keys");
    expect(outcome).toEqual({ ok: false, reason: "Read-only: another tab is editing this project." });
    expect(ran).toBe(false);
    expect(texts()).toEqual(["Read-only: another tab is editing this project."]);
  });

  test("failures are logged, never thrown; NotImplemented reads Not built yet", async () => {
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
    const [line] = bufferedServices().log;
    expect(line?.tag).toBe("Note");
    expect(line?.text).toBe("Not built yet · WP-C7a");
  });

  test("args reach enabled, title and run", async () => {
    const seen: unknown[] = [];
    defineCommands([
      command<{ facet: string }>({
        id: "facet.place",
        title: (args) => `Place ${args.facet}`,
        category: "Build",
        enabled: (_ctx, args) => (args.facet ? { ok: true } : { ok: false, reason: "Name a facet." }),
        run: (_ctx, args) => {
          seen.push(args);
        },
      }),
    ]);
    expect(commandState({ id: "facet.place", args: { facet: "ERC20" } }).title).toBe("Place ERC20");
    await runCommand({ id: "facet.place", args: { facet: "ERC20" } }, "console");
    expect(seen).toEqual([{ facet: "ERC20" }]);
  });
});
