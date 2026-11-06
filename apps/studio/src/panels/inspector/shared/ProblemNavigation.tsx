import { commandRef, runCommand, session } from "@/contracts";
import { Button, CommandButton } from "@/ui";
import styles from "./sheet.module.css";

async function backToComposition(): Promise<void> {
  const selected = await runCommand(commandRef("core.select"), "button");
  if (!selected.ok) return;
  session.set((s) => ({
    panes: { ...s.panes, inspector: { ...s.panes.inspector, view: null } },
  }));
  await runCommand(commandRef("region.focus", { region: "sheet" }), "button");
}

export function ProblemNavigation() {
  return (
    <nav aria-label="Problem navigation" className={styles.actions}>
      <CommandButton command={commandRef("problem.prev")} size="small">Previous problem</CommandButton>
      <CommandButton command={commandRef("problem.next")} size="small">Next problem</CommandButton>
      <Button onClick={() => void backToComposition()} size="small">Back to composition</Button>
    </nav>
  );
}
