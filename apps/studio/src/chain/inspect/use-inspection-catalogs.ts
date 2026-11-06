import type { Catalog } from "@lattice-studio/core";
import { useEffect, useState } from "react";
import { inspectionCatalogs } from "./app";
import { getCatalogStatus } from "@/contracts";

const EMPTY: readonly Catalog[] = [];

/** Catalog metadata is matched by runtime hash, independently of the composition's pin. */
export function useInspectionCatalogs(): readonly Catalog[] {
  const [catalogs, setCatalogs] = useState<readonly Catalog[]>(() => {
    const status = getCatalogStatus();
    return status.status === "ready" ? [status.catalog] : EMPTY;
  });
  useEffect(() => {
    let current = true;
    void inspectionCatalogs().then((result) => {
      if (current && result.ok) setCatalogs(result.value);
    });
    return () => { current = false; };
  }, []);
  return catalogs;
}
