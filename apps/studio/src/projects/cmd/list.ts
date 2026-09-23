/** Projects (App menu): the projects dialog, recent projects first with Recently deleted alongside. */
import { command, openDialog } from "@/contracts";
import { OK } from "./shared";

export const listCommand = command({
  id: "project.list",
  title: () => "Projects",
  category: "Session",
  palette: true,
  enabled: () => OK,
  run() {
    openDialog("projects", { tab: "recent" });
  },
});
