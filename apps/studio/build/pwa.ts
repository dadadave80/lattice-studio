/**
 * The PWA and SRI plugins (spec L828-L837, L862). vite-plugin-pwa with `registerType: 'prompt'` (auto-update
 * can lose unsaved work) and no injected registration: `src/pwa/` registers the worker itself, because an
 * injected inline script would need its own CSP hash. The precache holds the shell, the catalog manifest and
 * indexes, the recipe schema, the icons and every first-party chunk except ELK and WalletConnect (see
 * `precache.ts`). Catalog detail shards and creation code go into a cache-first runtime cache.
 *
 * vite-plugin-sri-gen adds `integrity` to the entry, its CSS and modulepreload links, and lists every chunk's
 * integrity in an import map, which the CSP allows by hash (`csp.ts`). Its dynamic-chunk preloads stay off:
 * they would fetch ELK and WalletConnect at startup. With `base: './'` (IPFS) an import map can't be keyed, so
 * the plugin verifies each `import()` in JavaScript instead.
 *
 * Each build also emits `release.json` (its hashed files and what isn't precached), which the next release's
 * `carry-previous.ts` reads to copy this release's chunks forward (spec L831).
 */
import { join } from "node:path";
import { themeColors } from "@lattice-studio/tokens";
import type { ConfigEnv, HtmlTagDescriptor, Plugin, PluginOption } from "vite";
import { VitePWA, type VitePWAOptions } from "vite-plugin-pwa";
import sri from "vite-plugin-sri-gen";
import { appDir } from "../local-env.ts";
import { formatJson } from "./headers.ts";
import { ICONS } from "./icons.ts";
import {
  bundleGraph, hashedAssets, LAZY_ONLY, RELEASE_MANIFEST, splitPrecache, type ExcludeRules, type ReleaseManifest,
} from "./precache.ts";
import { writeRecipeSchema } from "./recipe-schema.ts";
import { isTestMode } from "./variant.ts";

/** What the precache holds besides the service worker's own files (paths relative to `dist/`). */
export const PRECACHE_GLOBS = [
  "**/*.{js,css,html,woff2,svg,png,ico}",
  "catalog/manifest.json",
  "catalog/*/index.json",
  "schema/*.json",
];

/** Catalog detail shards, creation code and standard JSON: cache-first, filled as the app asks for them. */
export const CATALOG_SHARDS = /\/catalog\/[^/]+\/(?:shards|code|json)\//;
export const CATALOG_SHARDS_CACHE = "lattice-catalog-shards";

export type PwaOptions = {
  /** Which modules and files load only on an explicit action. Default: ELK and WalletConnect. */
  lazyOnly?: ExcludeRules;
  /**
   * Where `schema/recipe.v1.json` is written. Default: `STUDIO_SCHEMA_DIR` when set (test builds, so they
   * never write into the committed file), else the app's `public/`.
   */
  publicDir?: string;
};

/** The web app manifest (the app opens in the Shop theme, so its ground colours the splash and title bar). */
export function webManifest(): NonNullable<VitePWAOptions["manifest"]> {
  const ground = themeColors.shop.ground;
  return {
    name: "Lattice Studio",
    short_name: "Lattice Studio",
    description: "Compose EIP-2535 diamonds from the Lattice library, check them on every edit and deploy them.",
    id: "./",
    start_url: "./",
    scope: "./",
    display: "standalone",
    theme_color: ground,
    background_color: ground,
    icons: ICONS.filter((i) => i.file !== "icons/apple-touch-icon.png").map((i) => ({
      src: i.file,
      sizes: `${i.size}x${i.size}`,
      type: "image/png",
      ...(i.file.includes("maskable") ? { purpose: "maskable" } : { purpose: "any" }),
    })),
  };
}

/** The tab icons and theme colour, added to `index.html` (S11b owns the file itself). */
export function iconTags(base: string): HtmlTagDescriptor[] {
  const at = (path: string) => `${base}${path}`;
  return [
    { tag: "link", attrs: { rel: "icon", href: at("favicon.ico"), sizes: "32x32" }, injectTo: "head" },
    { tag: "link", attrs: { rel: "icon", href: at("favicon.svg"), type: "image/svg+xml" }, injectTo: "head" },
    { tag: "link", attrs: { rel: "apple-touch-icon", href: at("icons/apple-touch-icon.png") }, injectTo: "head" },
    { tag: "meta", attrs: { name: "theme-color", content: themeColors.shop.ground }, injectTo: "head" },
  ];
}

export function pwaPlugins(env: ConfigEnv, options: PwaOptions = {}): PluginOption[] {
  if (isTestMode(env)) return [];
  const rules = options.lazyOnly ?? LAZY_ONLY;
  /** Filled in `generateBundle`, read when vite-plugin-pwa writes `sw.js` in `closeBundle`. */
  let notPrecached = new Set<string>();
  let base = "/";

  const studio: Plugin = {
    name: "lattice-studio:pwa",
    apply: "build",
    buildStart() {
      const publicDir = options.publicDir || process.env.STUDIO_SCHEMA_DIR || join(appDir, "public");
      const result = writeRecipeSchema(publicDir);
      if (result.status === "skipped") this.warn(`${result.file} not written: ${result.reason}`);
      if (result.status === "written") this.info(`Wrote ${result.file}.`);
    },
    transformIndexHtml: {
      order: "post",
      handler: () => iconTags(base),
    },
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        const split = splitPrecache(bundleGraph(bundle), rules);
        for (const file of split.eager) {
          this.warn(`${file} loads at startup but belongs to ELK or WalletConnect, which must load only when chosen (spec L814).`);
        }
        notPrecached = new Set(split.excluded);
        const release: ReleaseManifest = { assets: hashedAssets(bundle), notPrecached: split.excluded };
        this.emitFile({ type: "asset", fileName: RELEASE_MANIFEST, source: formatJson(release) });
      },
    },
    configResolved(config) {
      base = config.base;
    },
  };

  const pwa = VitePWA({
    registerType: "prompt",
    injectRegister: false,
    strategies: "generateSW",
    filename: "sw.js",
    manifestFilename: "manifest.webmanifest",
    // The globs already cover the icons; vite-plugin-pwa adds the manifest itself.
    includeManifestIcons: false,
    manifest: webManifest(),
    workbox: {
      globPatterns: PRECACHE_GLOBS,
      manifestTransforms: [
        (entries) => ({ manifest: entries.filter((e) => !notPrecached.has(e.url.replace(/^\.?\//, ""))) }),
      ],
      dontCacheBustURLsMatching: /(?:^|\/)assets\//,
      navigateFallback: "index.html",
      navigateFallbackDenylist: [/\/catalog\//, /\/schema\//, /\/assets\//],
      runtimeCaching: [
        {
          urlPattern: CATALOG_SHARDS,
          handler: "CacheFirst",
          options: {
            cacheName: CATALOG_SHARDS_CACHE,
            expiration: { maxEntries: 2000 },
            cacheableResponse: { statuses: [200] },
          },
        },
      ],
      // The first install controls the page at once, so this session already works offline and warms shards.
      // Updates still wait for Reload: prompt mode never skips waiting on its own.
      //
      // The limit (spec L831): once any tab reloads into a new version, that worker controls every open tab and
      // this cleanup drops the old precache. An old tab still running the old build then fetches its lazy
      // chunks from the network, where each release carries the previous release's chunks. Online that works,
      // or shows "Studio was updated. Save and reload to continue." Offline the chunk can't load at all, and
      // `src/pwa/boot.ts` logs it on the offline path instead of claiming an update (L832).
      cleanupOutdatedCaches: true,
      clientsClaim: true,
      // The wallet stack is ~60 KB gz but larger raw; nothing precached may be skipped for size.
      maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
    },
  });

  const integrity = sri({ algorithm: "sha384", crossorigin: "anonymous", preloadDynamicChunks: false });
  return [studio, integrity, pwa];
}

export function studioPwa(env: ConfigEnv): PluginOption[] {
  return pwaPlugins(env);
}
