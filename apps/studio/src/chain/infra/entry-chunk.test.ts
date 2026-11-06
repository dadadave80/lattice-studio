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
let runtimeFile = "";
const imports = new Map<string, readonly string[]>();

function staticFiles(roots: readonly string[]): string[] {
  const files = new Set<string>();
  const queue = [...roots];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (files.has(file)) continue;
    files.add(file);
    queue.push(...(imports.get(file) ?? []));
  }
  return [...files];
}

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), "studio-entry-"));
  await build({ configFile: join(appDir, "vite.config.ts"), logLevel: "silent", build: { outDir: out, emptyOutDir: true }, plugins: [{
    name: "trace-chain-boundary",
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk") continue;
        imports.set(chunk.fileName, chunk.imports);
        if (Object.keys(chunk.modules).some((id) => id.replace(/\\/g, "/").endsWith("/src/chain/infra/runtime.ts"))) runtimeFile = chunk.fileName;
      }
    },
  }] });
  const html = readFileSync(join(out, "index.html"), "utf8");
  const first = [...html.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+\.js)"/g)].map((m) => m[1] ?? "");
  expect(first.length).toBeGreaterThan(0);
  const initial = staticFiles(first);
  firstLoad = initial.map((path) => readFileSync(join(out, path), "utf8")).join("\n");
  lazy = readdirSync(join(out, "assets"))
    .filter((name) => name.endsWith(".js") && !initial.includes(`assets/${name}`))
    .map((name) => ({ name, text: readFileSync(join(out, "assets", name), "utf8") }));
}, 120_000);

afterAll(() => {
  if (out) rmSync(out, { recursive: true, force: true });
});

/**
 * Chunk names and shared-module placement vary with other lazy consumers. Follow the actual chain entry's
 * static import graph; its wallet and probe code must remain behind that boundary together.
 */
function chainRuntime(): { name: string; text: string } | undefined {
  return runtimeFile && lazy.some((chunk) => `assets/${chunk.name}` === runtimeFile)
    ? { name: runtimeFile, text: staticFiles([runtimeFile]).map((path) => readFileSync(join(out, path), "utf8")).join("\n") }
    : undefined;
}

describe("the entry chunk", () => {
  test("carries none of wagmi, the wallet protocols or the probes", () => {
    for (const marker of [...WALLET_MARKERS, ...PROBE_MARKERS]) expect({ marker, found: firstLoad.includes(marker) }).toEqual({ marker, found: false });
  });

  test("the actual chain module loads its wallet and probes through lazy static dependencies", () => {
    const runtime = chainRuntime();
    expect(runtime).toBeDefined();
    expect(runtime?.text.includes("eip6963:requestProvider")).toBe(true);
    for (const marker of PROBE_MARKERS) expect(runtime?.text.includes(marker)).toBe(true);
    expect(lazy.some((chunk) => chunk.text.includes("@wagmi/core@"))).toBe(true);
  });

  test("WalletConnect's SDK is in neither the entry nor the chain module: it loads only when chosen", () => {
    const runtime = chainRuntime();
    // Chunk file names ("assets/w3m-modal-….js" in Vite's preload map) name the SDK's chunks without carrying it.
    const code = (text: string) => text.replace(/assets\/[\w.-]+\.js/g, "");
    for (const marker of WALLETCONNECT_MARKERS) {
      expect({ marker, entry: code(firstLoad).includes(marker), runtime: runtime && code(runtime.text).includes(marker) }).toEqual({ marker, entry: false, runtime: false });
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
