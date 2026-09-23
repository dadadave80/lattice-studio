import { describe, expect, test, vi } from "vitest";
import {
  commandState, getCommand, isPlaceholder, provideServices, runCommand, type ProjectsService, type SaveStatus,
} from "@/contracts";
import { bufferedServices, onCleanup } from "../../test/harness";
import {
  notSavedReason, reloadEnablement, reloadStudio, saveAndReload, saveAndReloadEnablement, type ReloadDeps,
} from "./reload";
import { isolatePwaState, pwaState } from "./state";
import { fakeSaveStatus, manualTimers, READ_ONLY, SAVED, SAVING, STORAGE_FULL } from "./test-support";

function deps(initial: SaveStatus, updates: ReloadDeps["updates"] = () => null) {
  const save = fakeSaveStatus(initial);
  const timers = manualTimers();
  const reloadPage = vi.fn();
  const log = vi.fn();
  const announce = vi.fn();
  const d: ReloadDeps = {
    saveStatus: save.get,
    subscribeSaveStatus: save.subscribe,
    updates,
    reloadPage,
    log,
    announce,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  };
  return { d, save, timers, reloadPage, log, announce };
}

describe("enablement", () => {
  test("Reload is enabled once nothing would be lost", () => {
    expect(reloadEnablement(SAVED)).toEqual({ ok: true });
    expect(reloadEnablement(READ_ONLY)).toEqual({ ok: true });
  });

  test("Reload waits for a pending save, offering Save and reload", () => {
    expect(reloadEnablement(SAVING)).toEqual({
      ok: false,
      reason: "Reload waits until the project is saved",
      fix: { id: "app.saveAndReload" },
    });
  });

  test("neither reloads a project that can't be saved; both point to Save a copy", () => {
    const refused = { ok: false, reason: "Not saved: browser storage is full", fix: { id: "project.saveCopy" } };
    expect(reloadEnablement(STORAGE_FULL)).toEqual(refused);
    expect(saveAndReloadEnablement(STORAGE_FULL)).toEqual(refused);
    expect(notSavedReason({ state: "not-saved", text: "Not saved", detail: "Not built yet · WP-S7a" })).toBe(
      "Not saved · Not built yet · WP-S7a",
    );
  });

  test("Save and reload is enabled while saving", () => {
    expect(saveAndReloadEnablement(SAVING)).toEqual({ ok: true });
    expect(saveAndReloadEnablement(SAVED)).toEqual({ ok: true });
  });
});

describe("saveAndReload", () => {
  test("reloads at once when the project is saved", async () => {
    const { d, reloadPage } = deps(SAVED);
    expect(await saveAndReload(d)).toBe("reloaded");
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  test("waits for the pending save, then reloads", async () => {
    const { d, save, reloadPage } = deps(SAVING);
    const outcome = saveAndReload(d);
    await Promise.resolve();
    expect(reloadPage).not.toHaveBeenCalled();
    save.set(SAVED);
    expect(await outcome).toBe("reloaded");
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  test("activates the waiting update through the update controller", async () => {
    const reload = vi.fn(async () => true);
    const { d, reloadPage } = deps(SAVED, () => ({ reload }));
    await saveAndReload(d);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reloadPage).not.toHaveBeenCalled();
  });

  test("says why and stays when the save fails", async () => {
    const { d, save, reloadPage, log, announce } = deps(SAVING);
    const outcome = saveAndReload(d);
    save.set(STORAGE_FULL);
    expect(await outcome).toBe("not-saved");
    expect(reloadPage).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith({ tag: "Note", text: "Didn't reload: Not saved: browser storage is full." });
    expect(announce).toHaveBeenCalledWith("Didn't reload: Not saved: browser storage is full.");
  });

  test("gives up after 10 s of saving and says so", async () => {
    const { d, timers, reloadPage, log } = deps(SAVING);
    const outcome = saveAndReload(d);
    timers.advance(10_000);
    expect(await outcome).toBe("still-saving");
    expect(reloadPage).not.toHaveBeenCalled();
    expect(log.mock.calls[0]?.[0].text).toBe("Didn't reload: the project is still saving. Try Save and reload again.");
  });
});

describe("reloadStudio", () => {
  test("says the project is still saving when the update controller gave up waiting", async () => {
    const { d, save, log, announce, reloadPage } = deps(SAVED, () => ({
      reload: async () => {
        save.set(SAVING);
        return false;
      },
    }));
    expect(await reloadStudio(d)).toBe("still-saving");
    expect(reloadPage).not.toHaveBeenCalled();
    const text = "Didn't reload: the project is still saving. Try Save and reload again.";
    expect(log).toHaveBeenCalledWith({ tag: "Note", text });
    expect(announce).toHaveBeenCalledWith(text);
  });

  test("says why when the update controller couldn't reload after an edit", async () => {
    const { d, save, log } = deps(SAVED, () => ({
      reload: async () => {
        save.set(STORAGE_FULL);
        return false;
      },
    }));
    expect(await reloadStudio(d)).toBe("not-saved");
    expect(log).toHaveBeenCalledWith({ tag: "Note", text: "Didn't reload: Not saved: browser storage is full." });
  });

  test("refuses with the reason while saving", async () => {
    const { d, reloadPage, log } = deps(SAVING);
    expect(await reloadStudio(d)).toBe("still-saving");
    expect(reloadPage).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith({ tag: "Note", text: "Didn't reload: reload waits until the project is saved." });
  });
});

describe("the commands", () => {
  function withSaveStatus(initial: SaveStatus) {
    const save = fakeSaveStatus(initial);
    const projects: ProjectsService = {
      createProject: () => Promise.reject(new Error("unused")),
      openProject: () => Promise.reject(new Error("unused")),
      saveStatus: save.get,
      subscribeSaveStatus: save.subscribe,
      loadViewport: async () => null,
      saveViewport: () => {},
    };
    onCleanup(provideServices({ projects }));
    const reloadPage = vi.fn();
    onCleanup(isolatePwaState(reloadPage));
    return { save, reloadPage };
  }

  test("are registered with the spec's labels", () => {
    expect(isPlaceholder("app.reload")).toBe(false);
    expect(isPlaceholder("app.saveAndReload")).toBe(false);
    expect(getCommand("app.reload").title({})).toBe("Reload");
    expect(getCommand("app.saveAndReload").title({})).toBe("Save and reload");
  });

  test("Reload runs the update controller's reload when the project is saved", async () => {
    withSaveStatus(SAVED);
    const reload = vi.fn(async () => true);
    pwaState.setUpdates({ reload });
    expect(await runCommand({ id: "app.reload" }, "button")).toEqual({ ok: true });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test("Reload is disabled with its reason while saving, and says so if run", async () => {
    const { reloadPage } = withSaveStatus(SAVING);
    expect(commandState({ id: "app.reload" })).toMatchObject({ ok: false, reason: "Reload waits until the project is saved" });
    const result = await runCommand({ id: "app.reload" }, "palette");
    expect(result.ok).toBe(false);
    expect(reloadPage).not.toHaveBeenCalled();
    expect(bufferedServices().log.at(-1)?.text).toBe("Reload waits until the project is saved");
  });

  test("Save and reload waits for the save, then reloads the page", async () => {
    const { save, reloadPage } = withSaveStatus(SAVING);
    const run = runCommand({ id: "app.saveAndReload" }, "button");
    await Promise.resolve();
    expect(reloadPage).not.toHaveBeenCalled();
    save.set(SAVED);
    expect(await run).toEqual({ ok: true });
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });
});
