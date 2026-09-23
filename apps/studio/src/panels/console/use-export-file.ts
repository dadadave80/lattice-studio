/**
 * The live export a code tab shows (IR L135-L136): rebuilt through the exporter's lazy chunk whenever what the
 * export reads changes (the recipe, the project's name and deploy settings, the catalog, the analysis), with the
 * lines that changed since the previous build. Layout edits don't rebuild it, so dragging cards stays cheap with
 * the tab open. When a build fails (blockers, for the script) the last good file stays, so the tab keeps showing
 * it under its banner.
 */
import type { ExportFile } from "@lattice-studio/core";
import { useEffect, useState } from "react";
import { doc, useAnalysis, useCatalog, useDocument } from "@/contracts";
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
  const recipe = useDocument((s) => s.project.recipe);
  const name = useDocument((s) => s.project.name);
  const deploy = useDocument((s) => s.project.deploy);
  const catalog = useCatalog();
  const analysis = useAnalysis();
  const [view, setView] = useState<ExportView>(NOTHING);
  const empty = recipe.facets.length === 0;

  useEffect(() => {
    if (!catalog || empty) return;
    let current = true;
    // The rest of the project (layout, provenance) doesn't reach either file.
    const project = { ...doc.get(), recipe, name, deploy };
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
  }, [kind, recipe, name, deploy, catalog, analysis, empty]);

  return empty ? NOTHING : view;
}
