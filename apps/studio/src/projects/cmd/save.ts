/**
 * ⌘/Ctrl S and Save a copy… (Flow 10 steps 1-3, spec L497-L500): with a linked file, ⌘S writes it directly;
 * otherwise it opens Save a copy, which always does (App menu, ⌘S with nothing linked, `export project`).
 */
import { exportProjectFile } from "@lattice-studio/core";
import { command, doc, KEY_CONTEXTS, openDialog } from "@/contracts";
import { OK } from "./shared";

function openSaveCopy(filename: string): void {
  openDialog("save-copy", { filename });
}

export const saveCommand = command({
  id: "project.save",
  title: () => "Save",
  category: "Session",
  keys: ["Mod+s"],
  keyContext: [...KEY_CONTEXTS],
  enabled: () => OK,
  async run() {
    const { saveOrPrompt } = await import("../actions");
    await saveOrPrompt(doc.get(), openSaveCopy);
  },
});

export const saveCopyCommand = command({
  id: "project.saveCopy",
  title: () => "Save a copy…",
  category: "Session",
  palette: true,
  enabled: () => OK,
  run() {
    openSaveCopy(exportProjectFile(doc.get(), []).filename);
  },
});
