import { IconButton } from "../buttons/IconButton";
import { Menu } from "../overlays/Menu";
import { MenuItem } from "../overlays/MenuItem";
import { narrower, wider } from "./splitter-model";

export type PaneSizeMenuProps = {
  /** The pane's name: "Left pane", "Inspector", "Console". The trigger reads "{pane} menu". */
  pane: string;
  value: number;
  min: number;
  max: number;
  /** One Narrower or Wider step in px (default 8, the grid). */
  step?: number;
  onChange: (next: number) => void;
  onCollapse: () => void;
};

/**
 * The pane header's size menu: the single-pointer alternative to dragging a splitter (spec L764, WCAG
 * 2.5.7). Narrower and Wider move one grid step and say why not at the limits; Collapse hides the pane.
 */
export function PaneSizeMenu({ pane, value, min, max, step = 8, onChange, onCollapse }: PaneSizeMenuProps) {
  return (
    <Menu label={`${pane} menu`} trigger={<IconButton icon="more" label={`${pane} menu`} size="small" />}>
      <MenuItem
        label="Narrower"
        disabledReason={value <= min ? `The ${pane.toLowerCase()} is at its narrowest.` : null}
        onSelect={() => onChange(narrower(value, { min, step }))}
        keepOpen
      />
      <MenuItem
        label="Wider"
        disabledReason={value >= max ? `The ${pane.toLowerCase()} is at its widest.` : null}
        onSelect={() => onChange(wider(value, { max, step }))}
        keepOpen
      />
      <MenuItem label="Collapse" onSelect={onCollapse} />
    </Menu>
  );
}
