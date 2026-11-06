import { err, findProtoKey, type Catalog, type CatalogManifest, type Facet, type FacetDetail, type Result, type ShardRef } from "@lattice-studio/core";
import { entryDir, fetchManifest, fetchVerified } from "@/catalog/lookup";

type DetailPorts = {
  manifest(): Promise<Result<CatalogManifest, string>>;
  /** The directory comes from this catalog's manifest entry, never the composition's selected pin. */
  read(entry: CatalogManifest["catalogs"][number], ref: ShardRef): Promise<Result<string, string>>;
};

export function createInspectionDetails(ports: DetailPorts) {
  const cache = new Map<string, Promise<Result<FacetDetail, string>>>();
  return {
    load(catalog: Catalog, facet: Facet): Promise<Result<FacetDetail, string>> {
      const key = `${catalog.hash}:${facet.name}:${facet.detail.hash}`;
      const cached = cache.get(key);
      if (cached) return cached;
      const loading = (async (): Promise<Result<FacetDetail, string>> => {
        try {
          const manifest = await ports.manifest();
          if (!manifest.ok) return err("The ABI catalog list couldn't be loaded. Retry loading the functions.");
          const entry = manifest.value.catalogs.find((item) => item.hash.toLowerCase() === catalog.hash.toLowerCase());
          if (!entry) return err("This facet's catalog isn't available in this build.");
          const read = await ports.read(entry, facet.detail);
          if (!read.ok) return err("This facet's ABI shard couldn't be verified. Retry loading the functions.");
          const value: unknown = JSON.parse(read.value);
          if (findProtoKey(value) !== null) return err("This facet's ABI shard doesn't match its catalog.");
          const { validateFacetDetail } = await import("@lattice-studio/core/schema");
          const parsed = validateFacetDetail(value);
          return parsed.ok && parsed.value.name === facet.name ? parsed : err("This facet's ABI shard doesn't match its catalog.");
        } catch { return err("This facet's ABI shard couldn't be loaded. Retry loading the functions."); }
      })();
      cache.set(key, loading);
      void loading.then((result) => { if (!result.ok && cache.get(key) === loading) cache.delete(key); });
      return loading;
    },
  };
}

export const inspectionDetails = createInspectionDetails({
  manifest: fetchManifest,
  read: (entry, ref) => fetchVerified(entry.id, entryDir(entry), ref),
});
