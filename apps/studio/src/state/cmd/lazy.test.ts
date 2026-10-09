import { afterEach, expect, test } from "bun:test";
import { commandContext, commandRef, doc } from "@/contracts";
import { settle, setupKit, type Kit } from "../testing";

let kit: Kit | null = null;
afterEach(() => {
  kit?.dispose();
  kit = null;
});

test("a command run before its body has loaded waits for it, then does what it says and says it", async () => {
  kit = setupKit();
  // A fresh copy of the loader, with no bodies loaded yet (the kit loads the app's copy up front).
  const fresh = "./lazy.ts?unloaded";
  const { lazyRun } = (await import(fresh)) as typeof import("./lazy");
  const ref = commandRef("facet.place", { facet: "ERC20" });
  const pending = lazyRun("place")(commandContext("api", ref), { facet: "ERC20" });
  expect(pending).toBeInstanceOf(Promise);
  expect(doc.get().recipe.facets).not.toContain("ERC20");
  await pending;
  await settle();
  expect(doc.get().recipe.facets).toContain("ERC20");
  expect(kit.texts().some((text) => text.startsWith("Placed ERC20"))).toBe(true);
});

test("once the bodies have loaded, a command runs at once", async () => {
  kit = setupKit();
  const { lazyRun } = await import("./lazy");
  const ref = commandRef("recipe.keepImmutable");
  expect(lazyRun("keepImmutable")(commandContext("api", ref), {})).toBeUndefined();
});
