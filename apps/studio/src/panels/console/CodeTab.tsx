import { useAnalysis, useCatalog, useDocument } from "@/contracts";
import { Button } from "@/ui/buttons/Button";
import { Banner } from "@/ui/status/Banner";
import { copyExport, saveExport } from "./actions";
import { CodeLines } from "./CodeLines";
import { blockerCount, CATALOG_NOT_LOADED, PLACE_FACETS_TO_GENERATE, resolveToExport } from "./export-enablement";
import styles from "./CodeView.module.css";
import { useExportFile, type CodeKind } from "./use-export-file";

export type CodeTabProps = { kind: CodeKind };

export const NOT_READY = "The file isn't ready yet";

/**
 * The Script tab (the live Foundry script) or the Recipe JSON tab (the live recipe.json), read-only in v1
 * (IR L135-L136). Copy and Download; while blockers exist the script shows a banner and its actions say why
 * they can't run, over the last script that could be built (spec L699). The recipe exports whatever the sheet
 * holds.
 */
export function CodeTab({ kind }: CodeTabProps) {
  const facets = useDocument((s) => s.project.recipe.facets.length);
  const catalog = useCatalog();
  const blockers = useAnalysis((a) => blockerCount(a));
  const recipeHash = useAnalysis((a) => a.recipeHash);
  const { file, error, changed } = useExportFile(kind);

  if (!catalog) return <p className={styles.empty}>{CATALOG_NOT_LOADED}.</p>;
  if (facets === 0) return <p className={styles.empty}>{PLACE_FACETS_TO_GENERATE}</p>;

  const blocked = kind === "script" && blockers > 0;
  const reason = blocked ? resolveToExport(blockers) : (error ?? (file ? null : NOT_READY));
  const stale = Boolean(file) && (blocked || error !== null);

  return (
    <div className={styles.view}>
      <div className={styles.head}>
        {blocked ? (
          <Banner tone="warning" text={resolveToExport(blockers)} actions={[{ id: "problem.next" }]} />
        ) : error ? (
          <Banner tone="error" text={error} />
        ) : null}
        <div className={styles.bar}>
          <span className={styles.filename}>{file?.filename ?? (kind === "script" ? "Foundry script" : "recipe.json")}</span>
          <span className={styles.spacer} />
          <Button size="small" icon="copy" disabledReason={reason} onClick={() => file && void copyExport(file)}>
            Copy
          </Button>
          <Button size="small" icon="download" disabledReason={reason} onClick={() => file && saveExport(file, recipeHash)}>
            Download
          </Button>
        </div>
      </div>
      {file ? (
        <CodeLines
          text={file.text}
          lang={kind === "script" ? "solidity" : "json"}
          label={file.filename}
          changed={changed}
          stale={stale}
        />
      ) : null}
    </div>
  );
}
