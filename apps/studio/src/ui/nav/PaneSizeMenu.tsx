import { IconButton } from "../buttons/IconButton";
import { Menu } from "../overlays/Menu";
import { MenuItem } from "../overlays/MenuItem";
import { narrower, wider } from "./splitter-model";

export type PaneSizeMenuProps = {
  /** The pane's name as the UI writes it: "Catalog", "Inspector", "Console". The trigger reads "{pane} menu". */
  pane: string;
  /**
   * `width` for side panes (Narrower, Wider); `height` for the console drawer (Shorter, Taller). Default
   * `width`.
   */
  dimension?: "width" | "height";
  value: number;
  min: number;
  max: number;
  /** One step in px (default 8, the grid). */
  step?: number;
  onChange: (next: number) => void;
  onCollapse: () => void;
};

const WORDS = {
  width: { less: "Narrower", more: "Wider", least: "narrowest", most: "widest" },
  height: { less: "Shorter", more: "Taller", least: "shortest", most: "tallest" },
} as const;

/**
 * The pane header's size menu: the single-pointer alternative to dragging a splitter (spec L764, WCAG
 * 2.5.7). Each step moves one grid step and, at a limit, says why not and what to do instead; Collapse hides
 * the pane.
 */
export function PaneSizeMenu({ pane, dimension = "width", value, min, max, step = 8, onChange, onCollapse }: PaneSizeMenuProps) {
  const w = WORDS[dimension];
  return (
    <Menu label={`${pane} menu`} trigger={<IconButton icon="more" label={`${pane} menu`} size="small" />}>
      <MenuItem
        label={w.less}
        disabledReason={value <= min ? `${pane} is at its ${w.least}; choose ${w.more} or Collapse` : null}
        onSelect={() => onChange(narrower(value, { min, step }))}
        keepOpen
      />
      <MenuItem
        label={w.more}
        disabledReason={value >= max ? `${pane} is at its ${w.most}; choose ${w.less} or Collapse` : null}
        onSelect={() => onChange(wider(value, { max, step }))}
        keepOpen
      />
      <MenuItem label="Collapse" onSelect={onCollapse} />
    </Menu>
  );
}
