/**
 * project.exportFile (spec L515: "Project file | Save a copy… | Always"; contracts §6's command-title
 * ruling: a command's registry title is a verb and its object, and a menu may keep its shorter label).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { loadFixtureCatalog, makeProject } from "@lattice-studio/core/testing";
import { commandState, defineCommands, doc, runCommand, session, setCatalogStatus } from "@/contracts";
import { isolateContracts } from "@/contracts/test-support";
import { exportFileCommand } from "./export-file";

let restore: () => void;

beforeEach(() => {
  restore = isolateContracts();
  const loaded = loadFixtureCatalog();
  if (!loaded.ok) throw new Error(loaded.error);
  const catalog = loaded.value;
  setCatalogStatus({ status: "ready", id: catalog.lattice.tag, catalog, manifest: null });
  doc.load(makeProject({ name: "Vault" }));
  defineCommands([exportFileCommand]);
});

afterEach(() => restore());

describe("project.exportFile", () => {
  test("its title is a verb and its object, not the bare noun the menu shows", () => {
    expect(exportFileCommand.title({})).toBe("Export project file");
    expect(commandState({ id: "project.exportFile" })).toMatchObject({ ok: true, title: "Export project file" });
  });

  test("console syntax is `export project`, and takes no arguments", () => {
    expect(exportFileCommand.console).toMatchObject({ verb: "export", sub: "project", syntax: "export project" });
    expect(exportFileCommand.console?.parse([])).toEqual({ ok: true, value: {} });
    expect(exportFileCommand.console?.parse(["x"])).toEqual({ ok: false, error: "export project takes no arguments." });
  });

  test("always enabled (spec L515), and opens Save a copy with the project's file name", async () => {
    expect(commandState({ id: "project.exportFile" }).ok).toBe(true);
    await runCommand({ id: "project.exportFile" }, "console");
    expect(session.get().dialogs).toHaveLength(1);
    expect(session.get().dialogs[0]).toMatchObject({ id: "save-copy", props: { filename: "vault.lattice.json" } });
  });
});
