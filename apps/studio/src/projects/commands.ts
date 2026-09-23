/**
 * S7b's command registrations (contracts §5.3). Definitions live in `cmd/`; each `run()` reaches the actual
 * persistence, File System Access and parsing work through a dynamic `import()`, so this file (evaluated
 * eagerly, contracts/discover.ts) stays a set of small shells.
 */
import { defineCommands } from "@/contracts";
import { exportAllCommand, clearCommand } from "./cmd/data";
import { exportFileCommand } from "./cmd/export-file";
import { deleteCommand, deleteForGoodCommand, duplicateCommand, restoreCommand } from "./cmd/manage";
import { listCommand } from "./cmd/list";
import { newProjectCommand } from "./cmd/new";
import { openCommand } from "./cmd/open";
import { saveCommand, saveCopyCommand } from "./cmd/save";

defineCommands([
  newProjectCommand, openCommand, saveCommand, saveCopyCommand, listCommand, duplicateCommand, exportFileCommand,
  deleteCommand, restoreCommand, deleteForGoodCommand, exportAllCommand, clearCommand,
]);
