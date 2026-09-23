/**
 * Open (⌘/Ctrl O, the app menu's Open…, and a Projects row): with an `id` it opens that stored project
 * (Flow 10 step 5); without one it picks a file from disk (Flow 10 step 4). One command covers both, so
 * ⌘O stays in the keymap (IR L14) even though the file-picker path needs no argument ahead of time.
 */
import { command, KEY_CONTEXTS, type CommandArgsOf } from "@/contracts";
import { OK } from "./shared";

type OpenArgs = CommandArgsOf<"project.open">;

export const openCommand = command<OpenArgs>({
  id: "project.open",
  title: (args) => (args.id !== undefined ? "Open project" : "Open…"),
  category: "Session",
  keys: ["Mod+o"],
  keyContext: [...KEY_CONTEXTS],
  palette: true,
  enabled: () => OK,
  async run(_ctx, args) {
    if (args.id !== undefined) {
      const { openStoredProject } = await import("../actions");
      await openStoredProject(args.id);
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
