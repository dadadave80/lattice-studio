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
/** WalletConnect's SDK: its relay and its modal. */
const WALLETCONNECT_MARKERS = ["relay.walletconnect", "@walletconnect/", "w3m-modal"];
/**
 * The probes' own code: the codehash program. (The Multicall3 codehash is core's constant now, and core ships in
 * the entry chunk, so it's no marker of the chain module.)
 */
const PROBE_MARKERS = ["610025803803809160003960005b"];

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

/**
 * The chain module's chunk: named runtime-*, and other modules name theirs runtime.ts too (S4e), so pick by content,
 * the probes' program. (wagmi's core moves to a chunk it shares with WalletConnect when a build carries it.)
 */
function chainRuntime(): { name: string; text: string } | undefined {
  return lazy.find((chunk) => chunk.name.startsWith("runtime-") && PROBE_MARKERS.every((marker) => chunk.text.includes(marker)));
}

describe("the entry chunk", () => {
  test("carries none of wagmi, the wallet protocols or the probes", () => {
    for (const marker of [...WALLET_MARKERS, ...PROBE_MARKERS]) expect({ marker, found: firstLoad.includes(marker) }).toEqual({ marker, found: false });
  });

  test("a lazy chunk named for the chain module carries them", () => {
    const runtime = chainRuntime();
    expect(runtime).toBeDefined();
    expect(runtime?.text.includes("eip6963:requestProvider")).toBe(true);
    expect(lazy.some((chunk) => chunk.text.includes("@wagmi/core@"))).toBe(true);
  });

  test("WalletConnect's SDK is in neither the entry nor the chain module: it loads only when chosen", () => {
    const runtime = chainRuntime();
    for (const marker of WALLETCONNECT_MARKERS) {
      expect({ marker, entry: firstLoad.includes(marker), runtime: runtime?.text.includes(marker) }).toEqual({ marker, entry: false, runtime: false });
    }
  });

  test("WalletConnect's chunk and SDK are in the build only when it has a project id (VITE_WALLETCONNECT_PROJECT_ID)", () => {
    const withId = Boolean(process.env.VITE_WALLETCONNECT_PROJECT_ID);
    expect(lazy.some((chunk) => chunk.name.startsWith("walletconnect-"))).toBe(withId);
    expect(lazy.some((chunk) => chunk.text.includes("relay.walletconnect"))).toBe(withId);
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
