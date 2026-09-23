/**
 * New project (App menu, console `new`, Flow 10 step 5, PA #5 and #16): a blank sheet, own id, modes,
 * selection and viewport reset. Never a confirmation (spec L734: opens a new project, so nothing is lost).
 */
import { command } from "@/contracts";
import { OK } from "./shared";

export const newProjectCommand = command({
  id: "project.new",
  title: () => "New project",
  category: "Session",
  console: { verb: "new", syntax: "new", parse: (argv) => (argv.length === 0 ? { ok: true, value: {} } : { ok: false, error: "new takes no arguments." }) },
  palette: true,
  enabled: () => OK,
  async run() {
    const { startNewProject } = await import("../actions");
    await startNewProject();
  },
});
