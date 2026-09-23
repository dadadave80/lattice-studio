import { useCommandState } from "@/contracts";
import { MenuCommandItem } from "@/ui/overlays/MenuCommandItem";
import { MenuItem } from "@/ui/overlays/MenuItem";
import { MenuSeparator } from "@/ui/overlays/MenuSeparator";
import { briefFile, copyExport, exportFailed } from "./actions";

export const IMAGE_LATER = "Arrives in v1.1";

async function copyBrief(): Promise<void> {
  const file = await briefFile();
  if (file.ok) await copyExport(file.value);
  else exportFailed(file.error);
}

/**
 * The Export menu's items (spec L509-L518, IR L132): Foundry script, Agent brief, Copy agent brief, Recipe JSON,
 * Project file (S7b's `project.exportFile`), Safe batch…, and Image, which arrives in v1.1. Each item is its
 * command, disabled with the command's reason. Part of the console body's chunk; `ExportMenu` in the header
 * holds the trigger and the popup.
 */
export function ExportItems() {
  const brief = useCommandState({ id: "export.brief" }, "menu");
  return (
    <>
      <MenuCommandItem command={{ id: "export.foundry" }} label="Foundry script" />
      <MenuCommandItem command={{ id: "export.brief" }} label="Agent brief" />
      <MenuItem
        label="Copy agent brief"
        icon="copy"
        disabledReason={brief.ok ? null : brief.reason}
        onSelect={() => void copyBrief()}
      />
      <MenuCommandItem command={{ id: "export.recipeJson" }} label="Recipe JSON" />
      <MenuCommandItem command={{ id: "project.exportFile" }} label="Project file" />
      <MenuCommandItem command={{ id: "export.safe" }} label="Safe batch…" />
      <MenuSeparator />
      <MenuItem label="Image" disabledReason={IMAGE_LATER} onSelect={() => {}} />
    </>
  );
}
