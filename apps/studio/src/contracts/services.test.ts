import { beforeEach, describe, expect, test } from "bun:test";
import type { ConsoleLine } from "@lattice-studio/core";
import { makeRecipe } from "@lattice-studio/core/testing";
import { deployController, provideDeployController, resetDeploy, type DeployController } from "./deploy";
import {
  announce, chainService, closeDialog, createProject, isOnline, log, now, openDialog, openProblemDoc,
  provideServices, putDeployment, listDeployments, resetServices, showBanner, hideBanner, toast, bufferedServices,
  clearServiceBuffers, type BannerProps,
} from "./services";
import { doc, resetStores, session } from "./stores";

beforeEach(() => {
  resetServices();
  resetStores();
  resetDeploy();
});

describe("buffering defaults", () => {
  test("log stamps drafts with the injected clock", () => {
    provideServices({ now: () => Date.parse("2026-09-23T12:00:00.000Z") });
    log({ tag: "Placed", text: "Placed ERC20 · 9 selectors" });
    expect(bufferedServices().log).toEqual([{ tag: "Placed", text: "Placed ERC20 · 9 selectors", at: "2026-09-23T12:00:00.000Z" }]);
    expect(now()).toBe(Date.parse("2026-09-23T12:00:00.000Z"));
  });

  test("buffered lines, announcements, toasts and banners replay into the real implementation", () => {
    log({ tag: "Note", text: "one", at: "t" });
    announce("Placed ERC20", { merge: "place" });
    toast({ text: "Copied 0x1234…abcd" });
    showBanner("offline", { text: "Offline. Composing works; deploy needs a connection." });
    showBanner("gone", { text: "Hidden before anyone saw it." });
    hideBanner("gone");

    const lines: ConsoleLine[] = [];
    const said: string[] = [];
    const toasts: string[] = [];
    const banners: [string, BannerProps][] = [];
    provideServices({
      log: (l) => lines.push(l),
      announce: (t) => said.push(t),
      toast: (t) => toasts.push(t.text),
      showBanner: (id, props) => banners.push([id, props]),
    });
    expect(lines.map((l) => l.text)).toEqual(["one"]);
    expect(said).toEqual(["Placed ERC20"]);
    expect(toasts).toEqual(["Copied 0x1234…abcd"]);
    expect(banners).toEqual([["offline", { text: "Offline. Composing works; deploy needs a connection." }]]);
    log({ tag: "Note", text: "two", at: "t" });
    expect(lines.map((l) => l.text)).toEqual(["one", "two"]);
  });

  test("a disposer restores only what it provided", () => {
    const a: string[] = [];
    const b: string[] = [];
    const disposeA = provideServices({ announce: (t) => a.push(t) });
    const disposeB = provideServices({ toast: (t) => b.push(t.text) });
    disposeA();
    announce("x");
    toast({ text: "y" });
    expect(a).toEqual([]);
    expect(b).toEqual(["y"]);
    disposeB();
    clearServiceBuffers();
    toast({ text: "z" });
    expect(bufferedServices().toast.map((t) => t.text)).toEqual(["z"]);
  });

  test("services that aren't built say so", async () => {
    openProblemDoc("SEL-01");
    expect(bufferedServices().log.map((l) => l.text)).toEqual(["Not built yet · WP-S12"]);
    await expect(chainService()).rejects.toThrow("Not built yet · WP-S8a");
  });
});

describe("working defaults", () => {
  test("dialogs push onto and pop off the session's stack", () => {
    openDialog("settings");
    openDialog("keyboard-shortcuts", { query: "zoom" });
    openDialog("settings", { group: "Keyboard" });
    expect(session.get().dialogs.map((d) => d.id)).toEqual(["settings", "keyboard-shortcuts", "settings"]);
    closeDialog("settings");
    expect(session.get().dialogs.map((d) => [d.id, d.props])).toEqual([
      ["settings", {}],
      ["keyboard-shortcuts", { query: "zoom" }],
    ]);
    const keys = session.get().dialogs.map((d) => d.key);
    expect(new Set(keys).size).toBe(2);
  });

  test("createProject opens a new document with fresh entropy", async () => {
    provideServices({ randomBytes: (n) => new Uint8Array(n).fill(0xab) });
    const created = await createProject(makeRecipe(), "Treasury");
    expect(created.ok).toBe(true);
    expect(doc.get().name).toBe("Treasury");
    expect(doc.get().deploy.entropy).toBe(`0x${"ab".repeat(11)}`);
  });

  test("deployment records round-trip in memory", async () => {
    const record = {
      projectId: "p1", chainId: 11155111, address: "0x5FbDB2315678afecb367f032d93F642f64180aa3", path: "factory",
      deployer: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", salt: "0x01", status: "confirmed", recipeHash: "0x02",
      catalogHash: "0x03", at: "2026-09-23T12:00:00.000Z", verification: "pending", revision: 1,
    } as const;
    await putDeployment(record);
    expect(await listDeployments("p1")).toEqual([record]);
    expect(await listDeployments("p2")).toEqual([]);
  });

  test("connection follows navigator.onLine where there is one", () => {
    expect(isOnline()).toBe(typeof navigator === "undefined" ? true : navigator.onLine);
  });
});

describe("deploy controller", () => {
  test("K2's default stays idle and logs Not built yet · WP-S8c", async () => {
    const controller = await deployController();
    expect(controller.state()).toEqual({ phase: "idle" });
    controller.open();
    await controller.sign();
    expect(bufferedServices().log.map((l) => l.text)).toEqual(["Not built yet · WP-S8c", "Not built yet · WP-S8c"]);
  });

  test("a provided controller loads once and its state is mirrored", async () => {
    let loads = 0;
    let emit: (phase: "review") => void = () => {};
    const fake = {
      state: () => ({ phase: "idle" as const }),
      subscribe: (fn: (s: { phase: "review" }) => void) => {
        emit = (phase) => fn({ phase });
        return () => {};
      },
    } as unknown as DeployController;
    provideDeployController(async () => {
      loads += 1;
      return fake;
    });
    expect(await deployController()).toBe(fake);
    expect(await deployController()).toBe(fake);
    expect(loads).toBe(1);
    emit("review");
  });
});
