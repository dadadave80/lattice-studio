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

/** Where catalogs come from, in lookup order: the generated catalog (CG8), then the fixtures (K3). */
const catalogSources = [join(repoRoot, "catalog"), join(repoRoot, "fixtures", "catalog")];

/** `VITE_STUDIO_E2E=1` adds the Anvil chain and the mock connector; a production build must never carry them (contracts §5.5). */
function e2eGuard(mode: string, command: "build" | "serve", flag: string | undefined): void {
  if (command === "build" && mode === "production" && flag === "1") {
    throw new Error(
      "VITE_STUDIO_E2E is set, so this build would include the Anvil chain and the mock connector. " +
        "Production builds can't: build with --mode e2e instead.",
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
    },
  };
});
