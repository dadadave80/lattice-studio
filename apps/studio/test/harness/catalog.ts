/**
 * The fixture catalogs for component tests (`fixtures/catalog/<id>/index.json`, K3), bundled into the test
 * through Vite so they load synchronously in the browser. Under `bun test`, use core's `loadFixtureCatalog`.
 */
import type { Catalog } from "@lattice-studio/core";
import { validateCatalog } from "@lattice-studio/core";

const indexes: Record<string, unknown> = import.meta.glob("../../../../fixtures/catalog/*/index.json", {
  eager: true,
  import: "default",
});

const cache = new Map<string, Catalog>();

/** The fixture catalog `id` ("fixture" or "fixture-next"), validated. Throws when it doesn't exist or validate. */
export function fixtureCatalog(id: "fixture" | "fixture-next" = "fixture"): Catalog {
  const cached = cache.get(id);
  if (cached) return cached;
  const entry = Object.entries(indexes).find(([path]) => path.endsWith(`/catalog/${id}/index.json`));
  if (!entry) throw new Error(`fixtures/catalog/${id}/index.json doesn't exist.`);
  const parsed = validateCatalog(entry[1]);
  if (!parsed.ok) {
    const issues = parsed.error.map((i) => `${i.path || "(root)"} ${i.message}`).join("; ");
    throw new Error(`fixtures/catalog/${id}/index.json doesn't validate: ${issues}`);
  }
  cache.set(id, parsed.value);
  return parsed.value;
}
