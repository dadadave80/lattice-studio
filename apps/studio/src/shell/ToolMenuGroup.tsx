import { commandRef, isPlaceholder, runCommand, useCommandState, useSession } from "@/contracts";
import { MenuRadioGroup, MenuRadioItem } from "@/ui";

const SELECT = commandRef("tool.select");
const HAND = commandRef("tool.hand");

/**
 * The tool strip's Select and Hand (IR L110) as menu radios: the checked one is the tool in use. Each shows
 * its command's title once S4b registers it, "Select" and "Hand" until then.
 */
export function ToolMenuGroup() {
  const tool = useSession((s) => s.tool);
  const select = useCommandState(SELECT, "menu");
  const hand = useCommandState(HAND, "menu");
  return (
    <MenuRadioGroup
      value={tool}
      onValueChange={(next) => {
        if (next === "select") void runCommand(SELECT, "menu");
        else if (next === "hand") void runCommand(HAND, "menu");
      }}
    >
      <MenuRadioItem
        value="select"
        label={isPlaceholder(SELECT.id) ? "Select" : select.title}
        disabledReason={select.ok ? null : select.reason}
      />
      <MenuRadioItem
        value="hand"
        label={isPlaceholder(HAND.id) ? "Hand" : hand.title}
        disabledReason={hand.ok ? null : hand.reason}
      />
    </MenuRadioGroup>
  );
}
