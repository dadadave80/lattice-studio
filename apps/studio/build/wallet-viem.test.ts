import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../local-env.ts";
import { WALLET_SDK, WALLET_VIEM_EXPORTS, walletViem } from "./wallet-viem.ts";

type Hooks = {
  resolveId: (source: string, importer: string | undefined, options: { kind: string }) => string | null;
  load: (id: string) => string | null;
};

const plugin = walletViem() as unknown as Hooks;
const APPKIT = join(repoRoot, "node_modules", "@reown", "appkit-controllers", "dist", "esm", "src", "utils", "ViemUtil.js");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.m?js$/.test(entry)) out.push(path);
  }
  return out;
}

describe("walletViem", () => {
  test("sends the wallet SDK's import() of viem to its own module", () => {
    const id = plugin.resolveId("viem", APPKIT, { kind: "dynamic-import" });
    expect(id).not.toBeNull();
    expect(plugin.load(id ?? "")).toBe('export { createPublicClient, defineChain, http } from "viem";');
  });

  test("leaves static imports, other packages and the app's own imports alone", () => {
    expect(plugin.resolveId("viem", APPKIT, { kind: "import-statement" })).toBeNull();
    expect(plugin.resolveId("viem/actions", APPKIT, { kind: "dynamic-import" })).toBeNull();
    expect(plugin.resolveId("viem", join(repoRoot, "apps", "studio", "src", "chain", "infra", "clients.ts"), { kind: "dynamic-import" })).toBeNull();
  });

  test("re-exports everything AppKit takes from import(\"viem\")", () => {
    const code = readFileSync(APPKIT, "utf8");
    const taken = /const \{([^}]*)\} = await import\(['"]viem['"]\)/.exec(code)?.[1];
    expect(taken, "AppKit's ViemUtil no longer destructures import(\"viem\"): re-check wallet-viem.ts").toBeDefined();
    const names = (taken ?? "").split(",").map((n) => n.trim()).filter(Boolean).sort();
    expect(names).toEqual([...WALLET_VIEM_EXPORTS]);
  });

  test("no other wallet SDK module imports viem's whole namespace", () => {
    const roots = ["@reown", "@walletconnect"].map((scope) => join(repoRoot, "node_modules", scope));
    const namespace = /import\(['"]viem['"]\)|import \* as [\w$]+ from ['"]viem['"]/;
    const found = roots
      .flatMap((root) => readdirSync(root).map((pkg) => join(root, pkg, "dist")))
      .filter((dir) => statSync(dir, { throwIfNoEntry: false })?.isDirectory())
      .flatMap(walk)
      // The ES builds Vite bundles, not the UMD and CommonJS ones beside them.
      .filter((file) => !/\.umd\.|[\\/](?:cjs|umd)[\\/]/.test(file))
      .filter((file) => WALLET_SDK.test(file) && namespace.test(readFileSync(file, "utf8")));
    expect(found).toEqual([APPKIT]);
  });
});
