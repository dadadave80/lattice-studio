/**
 * Vite config for Lattice Studio (contracts §1: K2, then frozen). React 19 with React Compiler through
 * `@rolldown/plugin-babel` (spec L902), CSS Modules, the `@/` alias, the catalog served and copied at
 * `/catalog/` (contracts §4), and S11a's CSP and PWA plugins from `build/`.
 */
import { join } from "node:path";
import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type UserConfig } from "vite";
import { studioCsp } from "./build/csp.ts";
import { studioPwa } from "./build/pwa.ts";
import { studioCatalog } from "./catalog-plugin.ts";
import { appDir, localPort, repoRoot } from "./local-env.ts";
import { isE2EFlag } from "./src/contracts/e2e-flag.ts";

/** Where catalogs come from, in lookup order: the generated catalog (CG8), then the fixtures (K3). */
const catalogSources = [join(repoRoot, "catalog"), join(repoRoot, "fixtures", "catalog")];

/**
 * `VITE_STUDIO_E2E` adds the Anvil chain and the mock connector, which only an end-to-end build may carry
 * (contracts §5.5). An allowlist: a build with the variable set to anything fails unless its mode is `e2e`.
 * The dev server and Vitest (`serve`) may use it.
 */
export function e2eGuard(mode: string, command: "build" | "serve", flag: string | undefined): void {
  if (command === "build" && isE2EFlag(flag) && mode !== "e2e") {
    throw new Error(
      `VITE_STUDIO_E2E is set, so this build would include the Anvil chain and the mock connector. ` +
        `Only an end-to-end build can (this one's mode is "${mode}"): build with --mode e2e.`,
    );
  }
}

export default defineConfig(async (configEnv): Promise<UserConfig> => {
  const { mode, command } = configEnv;
  const env = { ...loadEnv(mode, appDir, "VITE_"), ...process.env };
  e2eGuard(mode, command, env.VITE_STUDIO_E2E);
  const port = localPort("STUDIO_PORT");

  return {
    root: appDir,
    // One dependency cache per port, so two dev servers in one worktree never race on it. Under node_modules/,
    // so @rolldown/plugin-babel's default exclude keeps the React Compiler off pre-bundled dependencies.
    cacheDir: join(appDir, "node_modules", `.vite-${port}`),
    plugins: [
      react(),
      await babel({ presets: [reactCompilerPreset()] }),
      studioCatalog(catalogSources),
      ...studioCsp(configEnv),
      ...studioPwa(configEnv),
    ],
    resolve: {
      alias: { "@": join(appDir, "src") },
    },
    css: {
      modules: { localsConvention: "camelCase" },
    },
    server: {
      port,
      strictPort: true,
      fs: { allow: [repoRoot] },
      watch: {
        ignored: [".claude", ".handoff", ".integration", "lattice"].map((d) => join(repoRoot, d, "**")),
      },
    },
    preview: {
      port,
      strictPort: true,
    },
    build: {
      reportCompressedSize: true,
      // Every lazy chunk that shares core, contracts or state with the entry split them into small first-load files
      // (25 of them); one group for what the entry loads at start keeps first load in two files (FX17: 342.7 → 328.7 KB).
      rolldownOptions: { output: { codeSplitting: { groups: [{ name: "app", tags: ["$initial"] }] } } },
    },
  };
});
