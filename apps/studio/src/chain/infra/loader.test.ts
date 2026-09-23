import { describe, expect, test } from "bun:test";
import type { ChainService } from "@/contracts";
import { createChainLoader, type ChainLoadState } from "./loader";

const service = { chains: () => [] } as unknown as ChainService;

describe("the lazy boundary", () => {
  test("idle until asked; loading says so; loads once", async () => {
    let imports = 0;
    let finish: (value: ChainService) => void = () => {};
    const loader = createChainLoader(() => {
      imports += 1;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const seen: ChainLoadState["status"][] = [];
    loader.subscribe(() => seen.push(loader.state().status));
    expect(loader.state()).toEqual({ status: "idle" });
    const first = loader.load();
    const second = loader.load();
    expect(loader.state()).toEqual({ status: "loading", text: "Loading wallet support…" });
    finish(service);
    expect(await first).toBe(service);
    expect(await second).toBe(service);
    expect(await loader.load()).toBe(service);
    expect(imports).toBe(1);
    expect(seen).toEqual(["loading", "ready"]);
  });

  test("a failed load says why and is tried again on the next call", async () => {
    let attempt = 0;
    const loader = createChainLoader(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("Failed to fetch dynamically imported module");
      return service;
    });
    await expect(loader.load()).rejects.toThrow("Failed to fetch");
    expect(loader.state()).toEqual({
      status: "failed",
      text: "Couldn't load wallet support.",
      reason: "Failed to fetch dynamically imported module",
    });
    expect(await loader.load()).toBe(service);
    expect(loader.state()).toEqual({ status: "ready" });
  });
});
