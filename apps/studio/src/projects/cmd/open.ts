/**
 * Open (⌘/Ctrl O, the app menu's Open…, and a Projects row): with an `id` it opens that stored project
 * (Flow 10 step 5); without one it opens the address, link and file dialog. The existing guarded import
 * path still owns files, and opening the dialog never replaces the current project.
 */
import { command, KEY_CONTEXTS, openDialog, session, type CommandArgsOf } from "@/contracts";
import { OK, sayNote } from "./shared";

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
      const result = await openStoredProject(args.id);
      if (!result.ok) throw new Error(result.error);
      return;
    }
    const chainId = session.get().chainId;
    openDialog("open-diamond", chainId === null ? {} : { chainId });
    sayNote("Opened Open.");
  },
});
