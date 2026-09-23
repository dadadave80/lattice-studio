/** Settings → Data (Flow 16): Export all projects, and Clear data (which confirms in its own dialog). */
import { command, openDialog } from "@/contracts";
import { OK } from "./shared";

export const exportAllCommand = command({
  id: "data.exportAll",
  title: () => "Export all projects",
  category: "Session",
  enabled: () => OK,
  async run() {
    const { exportAllData } = await import("../actions");
    await exportAllData();
  },
});

export const clearCommand = command({
  id: "data.clear",
  title: () => "Clear data",
  category: "Session",
  enabled: () => OK,
  run() {
    openDialog("clear-data");
  },
});
