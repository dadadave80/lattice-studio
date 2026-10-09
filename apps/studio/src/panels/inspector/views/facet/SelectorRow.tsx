import { formatSelector, type Hex4 } from "@lattice-studio/core";
import type { Ref } from "react";
import { commandRef } from "@/contracts";
import { cx, IconButton, Menu, MenuCommandItem, ReasonTooltip } from "@/ui";
import { CommandSelectorRow } from "./CommandSelectorRow";
import { plainCode } from "./facet-model";
import type { PinAction, PinState } from "./pin-action";
import styles from "./facet.module.css";
import { breakIdentifier } from "@/ui/text/Identifier";

export type SelectorRowProps = {
  selector: { hex: Hex4; signature: string };
  action: PinAction;
  /** Its facet, for Copy selector and Copy signature's `facet` hint. */
  facet: string;
  /** Read-only (Catalog preview): plain text, no pin action and no actions menu (FacetSheet's readOnly). */
  readOnly: boolean;
  /** Roving tabindex: 0 on the list's one Tab stop (its actions menu shares it), -1 elsewhere. */
  tabIndex?: number;
  onFocus?: () => void;
  rowRef?: Ref<HTMLButtonElement>;
};

/**
 * Copy selector, Copy signature and Show owner (ruling R3): a second way to reach the same commands as the
 * sheet's context menus (spec IR L49), so a row's actions never need a right-click.
 */
function RowActions({
  selector,
  facet,
  tabIndex,
  onFocus,
}: {
  selector: { hex: Hex4; signature: string };
  facet: string;
  tabIndex?: number;
  onFocus?: () => void;
}) {
  const label = `${selector.signature} actions`;
  return (
    <Menu
      label={label}
      align="end"
      trigger={
        <IconButton
          icon="more"
          label={label}
          size="small"
          className={cx(styles.actions)}
          {...(tabIndex === undefined ? {} : { tabIndex })}
          {...(onFocus ? { onFocus } : {})}
        />
      }
    >
      <MenuCommandItem command={commandRef("selector.copy", { selector: selector.hex, facet })} label="Copy selector" />
      <MenuCommandItem command={commandRef("selector.copySignature", { selector: selector.hex, facet })} label="Copy signature" />
      <MenuCommandItem command={commandRef("selector.showOwner", { selector: selector.hex })} label="Show owner" />
    </Menu>
  );
}

const STATE_CLASS: Record<PinState, string | undefined> = {
  excluded: styles.excluded,
  seam: undefined,
  default: styles.default,
  routed: styles.routed,
  served: undefined,
  contested: styles.contestedRow,
};

/**
 * One row of the Selectors list: `transfer · 0xa9059cbb` and its state in words. It acts like a pin (Flow 6):
 * Enter, Space or a click does what its tooltip says; a seam offers no route and says why.
 */
export function SelectorRow({ selector, action, facet, readOnly, tabIndex, onFocus, rowRef }: SelectorRowProps) {
  const dense = plainCode(formatSelector(selector, "dense"));
  const content = (
    <>
      <span className={styles.signature}>{breakIdentifier(dense)}</span>
      <span className={styles.state}>{action.label}</span>
    </>
  );
  const className = cx(styles.row, STATE_CLASS[action.state]);

  if (readOnly) {
    return (
      <li className={styles.rowItem}>
        <span className={className} data-selector={selector.hex} title={selector.signature}>
          {content}
        </span>
      </li>
    );
  }

  const command = action.command;
  const common = {
    ref: rowRef,
    type: "button" as const,
    className,
    "data-selector": selector.hex,
    ...(tabIndex === undefined ? {} : { tabIndex }),
    ...(onFocus ? { onFocus } : {}),
  };
  // The row's one Tab stop shares itself with the actions menu, so Tab reaches it right after the active row's
  // pin button and leaves the list on the next Tab, instead of stopping at every row's menu (spec L661, L770).
  const menuTabIndex = tabIndex === undefined ? undefined : tabIndex === 0 ? 0 : -1;

  if (!command) {
    return (
      <li className={styles.rowItem}>
        <ReasonTooltip reason={plainCode(action.tooltip)}>
          <button {...common}>{content}</button>
        </ReasonTooltip>
        <RowActions selector={selector} facet={facet} {...(menuTabIndex === undefined ? {} : { tabIndex: menuTabIndex })} {...(onFocus ? { onFocus } : {})} />
      </li>
    );
  }

  return (
    <li className={styles.rowItem}>
      <CommandSelectorRow command={command} tooltip={action.tooltip} content={content} button={common} />
      <RowActions selector={selector} facet={facet} {...(menuTabIndex === undefined ? {} : { tabIndex: menuTabIndex })} {...(onFocus ? { onFocus } : {})} />
    </li>
  );
}
