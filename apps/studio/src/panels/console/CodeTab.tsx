import { useAnalysis, useCatalog, useDocument, useSettings } from "@/contracts";
import { Button } from "@/ui/buttons/Button";
import { usePlatform } from "@/ui/shared/platform";
import { Banner } from "@/ui/status/Banner";
import { copyExport, saveExport } from "./actions";
import { CodeLines } from "./CodeLines";
import { blockerCount, CATALOG_NOT_LOADED, PLACE_FACETS_TO_GENERATE, resolveToExport } from "./export-enablement";
import { nextProblemKey } from "./export-gates";
import styles from "./CodeView.module.css";
import { recipeJsonHeader } from "./recipe-notes";
import { useExportFile, type CodeKind } from "./use-export-file";

export type CodeTabProps = { kind: CodeKind };

export const NOT_READY = "The file isn't ready yet";

/**
 * The Script tab (the live Foundry script) or the Recipe JSON tab (the live recipe.json), read-only in v1
 * (IR L135-L136). Copy and Download; while blockers exist the script shows a banner and its actions say why
 * they can't run, over the last script that could be built (spec L699). The recipe exports whatever the sheet
 * holds; its tab states the recipe hash, catalog tag, Studio version and what recipe.json leaves out, since the
 * file has no header of its own (spec L509, L515; ruling R6).
 */
export function CodeTab({ kind }: CodeTabProps) {
  const facets = useDocument((s) => s.project.recipe.facets.length);
  const catalog = useCatalog();
  const blockers = useAnalysis((a) => blockerCount(a));
  const recipeHash = useAnalysis((a) => a.recipeHash);
  const keymap = useSettings((s) => s.keymap);
  const singleKeys = useSettings((s) => s.singleKeys);
  const platform = usePlatform();
  const { file, error, changed } = useExportFile(kind);

  if (!catalog) return <p className={styles.empty}>{CATALOG_NOT_LOADED}.</p>;
  if (facets === 0) return <p className={styles.empty}>{PLACE_FACETS_TO_GENERATE}</p>;

  const blocked = kind === "script" && blockers > 0;
  const blockedReason = blocked ? resolveToExport(blockers, nextProblemKey({ keymap, singleKeys, platform })) : null;
  const reason = blockedReason ?? error ?? (file ? null : NOT_READY);
  const stale = Boolean(file) && (blocked || error !== null);

  return (
    <div className={styles.view}>
      <div className={styles.head}>
        {blockedReason ? (
          <Banner tone="warning" text={blockedReason} actions={[{ id: "problem.next" }]} />
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
        {kind === "recipe" ? (
          <p className={styles.note} data-recipe-notes="">
            {recipeJsonHeader(recipeHash, catalog.lattice.tag)}
          </p>
        ) : null}
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
