/**
 * The live export a code tab shows (IR L135-L136): rebuilt through the exporter's lazy chunk whenever the
 * project, the catalog or the analysis changes, with the lines that changed since the previous build. When a
 * build fails (blockers, for the script) the last good file stays, so the tab keeps showing it under its banner.
 */
import type { ExportFile } from "@lattice-studio/core";
import { useEffect, useState } from "react";
import { useAnalysis, useCatalog, useDocument } from "@/contracts";
import { recipeFile, scriptFile } from "./actions";
import { changedLines } from "./line-diff";

export type CodeKind = "script" | "recipe";

export type ExportView = {
  /** The newest file built, or null before the first one. */
  file: ExportFile | null;
  /** Why the newest build failed, or null when `file` is current. */
  error: string | null;
  /** 0-based indexes of lines new or changed since the previous build. */
  changed: ReadonlySet<number>;
};

const NOTHING: ExportView = { file: null, error: null, changed: new Set() };

export function useExportFile(kind: CodeKind): ExportView {
  const project = useDocument((s) => s.project);
  const catalog = useCatalog();
  const analysis = useAnalysis();
  const [view, setView] = useState<ExportView>(NOTHING);
  const empty = project.recipe.facets.length === 0;

  useEffect(() => {
    if (!catalog || empty) return;
    let current = true;
    const build = kind === "script" ? scriptFile({ project, catalog, analysis }) : recipeFile({ project, catalog });
    build.then(
      (result) => {
        if (!current) return;
        setView((previous) => {
          if (!result.ok) return { ...previous, error: result.error };
          if (previous.file?.text === result.value.text && previous.file.filename === result.value.filename) {
            return previous.error === null ? previous : { ...previous, error: null };
          }
          const changed = previous.file
            ? changedLines(previous.file.text.split("\n"), result.value.text.split("\n"))
            : new Set<number>();
          return { file: result.value, error: null, changed };
        });
      },
      (error: unknown) => {
        if (current) setView((previous) => ({ ...previous, error: error instanceof Error ? error.message : String(error) }));
      },
    );
    return () => {
      current = false;
    };
  }, [kind, project, catalog, analysis, empty]);

  return empty ? NOTHING : view;
}
