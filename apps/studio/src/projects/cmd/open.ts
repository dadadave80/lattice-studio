/**
 * Open (⌘/Ctrl O, the app menu's Open…, and a Projects row): with an `id` it opens that stored project
 * (Flow 10 step 5); without one it picks a file from disk (Flow 10 step 4). One command covers both, so
 * ⌘O stays in the keymap (IR L14) even though the file-picker path needs no argument ahead of time.
 *
 * `id` isn't in the frozen `CommandArgsMap["project.open"]` as optional (contracts §5.3 CCR in S7b's
 * report): this command's args are read loosely (`idArg`) rather than through `CommandArgsOf`, so a caller
 * without an id (S3's Open… menu item, `commandRef("project.open")`) still runs, even though the map marks
 * `id` required today.
 */
import { command, KEY_CONTEXTS } from "@/contracts";
import { idArg, OK } from "./shared";

export const openCommand = command({
  id: "project.open",
  title: (args) => (idArg(args) !== undefined ? "Open project" : "Open…"),
  category: "Session",
  keys: ["Mod+o"],
  keyContext: [...KEY_CONTEXTS],
  palette: true,
  enabled: () => OK,
  async run(_ctx, args) {
    const id = idArg(args);
    if (id !== undefined) {
      const { openStoredProject } = await import("../actions");
      await openStoredProject(id);
      return;
    }
    const [{ pickProjectFile }, { openImportedFile }] = await Promise.all([
      import("../file-io"),
      import("../actions"),
    ]);
    const picked = await pickProjectFile();
    if (picked) await openImportedFile(picked.filename, picked.text);
  },
});
