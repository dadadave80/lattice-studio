/**
 * Browser-test helpers for S13's tests: the fixture manifest, a recipe with two authority addresses from a link
 * (the spec's "2 addresses to confirm", L709), and a clean slate for the module's own state between tests.
 */
import type { Address, Catalog, CatalogManifest, Project, Recipe } from "@lattice-studio/core";
import { loadTemplate } from "@lattice-studio/core";
import { makeProject } from "@lattice-studio/core/testing";
import { setCatalogStatus } from "@/contracts";
import { resetCatalogPin } from "@/catalog/pin-store";
import { resetBanners } from "@/feedback/banner-store";
import { fixtureCatalog } from "../../test/harness";
import { resetOpenLink } from "./open-link";
import { resetReadOnly } from "./read-only";

/** The address the spec's examples use (L334), and a second one. */
export const ADMIN: Address = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";
export const SAFE: Address = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

/** Both fixture catalogs, `fixture` the default (fixtures/catalog/manifest.json). */
export function fixtureManifest(defaultId: "fixture" | "fixture-next" = "fixture"): CatalogManifest {
  const entry = (id: "fixture" | "fixture-next") => {
    const catalog = fixtureCatalog(id);
    return { id, tag: catalog.lattice.tag, commit: catalog.lattice.commit, hash: catalog.hash, path: `${id}/index.json` };
  };
  return { default: defaultId, catalogs: [entry("fixture"), entry("fixture-next")] };
}

/** Publishes `catalog` as loaded, with the fixture manifest (S14's pin needs one to tell bundled from not). */
export function loadWithManifest(catalog: Catalog, defaultId: "fixture" | "fixture-next" = "fixture"): void {
  setCatalogStatus({ status: "ready", id: catalog.lattice.tag, catalog, manifest: fixtureManifest(defaultId) });
}

export function template(name: string, catalog: Catalog = fixtureCatalog()): Recipe {
  const loaded = loadTemplate(catalog, name);
  if (!loaded.ok) throw new Error(loaded.error);
  return loaded.value;
}

/** SafeDiamondCut with its admin and Safe as literal addresses: both receive authority (LINK-01). */
export function linkedRecipe(catalog: Catalog = fixtureCatalog()): Recipe {
  return {
    ...template("SafeDiamondCut", catalog),
    init: { kind: "steps", steps: [{ spec: "SafeDiamondCutInit", args: { admin: ADMIN, safe: SAFE, minThreshold: "2" } }] },
  };
}

export function projectFor(recipe: Recipe, overrides: Partial<Project> = {}): Project {
  return { ...makeProject({ recipe }), ...overrides };
}

/** Forgets banners, the read-only controller's memory, the pin and the last link's watcher. */
export function resetFlows(): void {
  resetOpenLink();
  resetReadOnly();
  resetBanners();
  resetCatalogPin();
}
