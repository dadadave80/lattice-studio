import { commandRef, useDocument } from "@/contracts";
import { CommandButton } from "@/ui/buttons/CommandButton";

/**
 * Deploy… in the title bar below 1024 px (spec L349, IR L69): the view's one filled primary button. Once the
 * sheet differs from a live deploy it reads Deploy again… (spec L584). Disabled with its command's reason.
 */
export function DeployButton({ again }: { again: boolean }) {
  const upgrade = useDocument((state) => state.project.recipe.mode === "upgrade");
  if (upgrade) return <CommandButton command={commandRef("deploy.upgrade")} variant="primary" size="small">Upgrade…</CommandButton>;
  return again ? (
    <CommandButton command={commandRef("deploy.again")} variant="primary" size="small">
      Deploy again…
    </CommandButton>
  ) : (
    <CommandButton command={commandRef("deploy.open")} variant="primary" size="small">
      Deploy…
    </CommandButton>
  );
}
