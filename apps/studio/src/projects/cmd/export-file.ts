/**
 * Export ▸ Project file and `export project` (Flow 11's table: "Project file | Save a copy… | Always"):
 * the same Save a copy dialog project.saveCopy opens.
 */
import { exportProjectFile } from "@lattice-studio/core";
import { command, doc, openDialog } from "@/contracts";
import { OK } from "./shared";

export const exportFileCommand = command({
  id: "project.exportFile",
  title: () => "Project file",
  category: "Export",
  console: { verb: "export", sub: "project", syntax: "export project", parse: (argv) => (argv.length === 0 ? { ok: true, value: {} } : { ok: false, error: "export project takes no arguments." }) },
  palette: true,
  enabled: () => OK,
  run() {
    openDialog("save-copy", { filename: exportProjectFile(doc.get(), []).filename });
  },
});
