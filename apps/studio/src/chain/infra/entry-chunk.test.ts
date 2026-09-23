/**
 * Build check (spec L822, decision 13): the wallet stack stays behind the lazy boundary. Builds the app with its
 * own Vite config into a scratch directory, then reads what the first load fetches (the entry script and its
 * module preloads, from `index.html`) and what the lazy chunks carry. viem itself is in the entry legitimately
 * (core's selector and ABI utilities); its clients, wagmi and the wallet protocols must not be.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { appDir } from "../../../local-env";

/** Strings only the wallet stack carries: wagmi's version tag, EIP-6963's events, wallet RPC methods, viem's fallback transport. */
const WALLET_MARKERS = ["@wagmi/core@", "eip6963:requestProvider", "eth_requestAccounts", "wallet_switchEthereumChain", "wallet_addEthereumChain"];
/** The probes' own code: the codehash program and the Multicall3 codehash. */
const PROBE_MARKERS = ["610025803803809160003960005b", "d5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891"];

let out = "";
let firstLoad = "";
let lazy: { name: string; text: string }[] = [];

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), "studio-entry-"));
  await build({ configFile: join(appDir, "vite.config.ts"), logLevel: "silent", build: { outDir: out, emptyOutDir: true } });
  const html = readFileSync(join(out, "index.html"), "utf8");
  const first = [...html.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+\.js)"/g)].map((m) => m[1] ?? "");
  expect(first.length).toBeGreaterThan(0);
  firstLoad = first.map((path) => readFileSync(join(out, path), "utf8")).join("\n");
  lazy = readdirSync(join(out, "assets"))
    .filter((name) => name.endsWith(".js") && !first.includes(`assets/${name}`))
    .map((name) => ({ name, text: readFileSync(join(out, "assets", name), "utf8") }));
}, 120_000);

afterAll(() => {
  if (out) rmSync(out, { recursive: true, force: true });
});

describe("the entry chunk", () => {
  test("carries none of wagmi, the wallet protocols or the probes", () => {
    for (const marker of [...WALLET_MARKERS, ...PROBE_MARKERS]) expect({ marker, found: firstLoad.includes(marker) }).toEqual({ marker, found: false });
  });

  test("a lazy chunk named for the chain module carries them", () => {
    const runtime = lazy.find((chunk) => chunk.name.startsWith("runtime-"));
    expect(runtime).toBeDefined();
    for (const marker of ["@wagmi/core@", ...PROBE_MARKERS]) expect(runtime?.text.includes(marker)).toBe(true);
  });

  test("the ENS normalizer loads on its own, only when a name is resolved", () => {
    const ens = lazy.find((chunk) => chunk.name.startsWith("ens-"));
    expect(ens).toBeDefined();
    expect(firstLoad.includes("ens-normalize")).toBe(false);
  });

  test("the end-to-end connector is its own chunk", () => {
    expect(lazy.some((chunk) => chunk.name.startsWith("e2e-"))).toBe(true);
  });
});
