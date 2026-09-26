import type { Hex4 } from "@lattice-studio/core";
import { useCommandState } from "@/contracts";
import { Button } from "@/ui/buttons/Button";
import { Icon } from "@/ui/icons/Icon";
import { Menu } from "@/ui/overlays/Menu";
import { MenuItem } from "@/ui/overlays/MenuItem";
import { routeRef, routeSet } from "./set-route";

export type OwnerMenuProps = {
  selectors: readonly Hex4[];
  /** Catalog order: the first is the one the menu names until someone chooses (spec L436). */
  contenders: readonly string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function OwnerItem({ selectors, facet }: { selectors: readonly Hex4[]; facet: string }) {
  const state = useCommandState(routeRef(selectors[0], facet), "menu");
  return (
    <MenuItem
      label={facet}
      disabledReason={state.ok ? null : state.reason}
      onSelect={() => routeSet(selectors, facet, undefined, "menu")}
    />
  );
}

/**
 * Three or more contenders: Keep and Route become one menu, "Owner: AxelarGatewayAdapter ▾" (spec L436), whose
 * items route the whole set to one contender (`selector.route`, one undo step).
 */
export function OwnerMenu({ selectors, contenders, open, onOpenChange }: OwnerMenuProps) {
  const [first = ""] = contenders;
  return (
    <Menu
      label="Owner"
      open={open}
      onOpenChange={onOpenChange}
      trigger={
        <Button size="small">
          {`Owner: ${first}`}
          <Icon name="chevron-down" size="small" />
        </Button>
      }
    >
      {contenders.map((facet) => (
        <OwnerItem key={facet} selectors={selectors} facet={facet} />
      ))}
    </Menu>
  );
}
