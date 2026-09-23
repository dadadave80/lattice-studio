/**
 * S7b's registrations (contracts §5.2): the four dialogs it owns (each a small `Suspense` wrapper around a
 * lazily loaded panel, so the entry chunk only grows by the wrapper) and the window drop target for opening
 * a file (Flow 10 step 4). Skipped under `env.test`: browser tests install it themselves when they need it
 * (`installFileDrop`), the way S7a's persistence stays off by default too.
 */
import { env, registerDialog } from "@/contracts";
import { ClearDataDialog } from "./dialogs/ClearDataDialog";
import { DeleteForGoodDialog } from "./dialogs/DeleteForGoodDialog";
import { ProjectsDialog } from "./dialogs/ProjectsDialog";
import { SaveCopyDialog } from "./dialogs/SaveCopyDialog";
import { installFileDrop } from "./file-drop";

registerDialog("save-copy", SaveCopyDialog);
registerDialog("projects", ProjectsDialog);
registerDialog("delete-for-good", DeleteForGoodDialog);
registerDialog("clear-data", ClearDataDialog);

if (!env.test && typeof window !== "undefined") installFileDrop(window);
