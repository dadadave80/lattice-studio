/**
 * The person's last expand or collapse of the title block, with the default it overrode, for the page's life. It
 * wins until the default changes (the sheet fills, empties, or crosses `SHORT_SHEET`), then the default rules
 * again (David's decision on SH-01/SH-02). The frozen session store has no field for it yet (CCR:
 * `panes.titleBlock.collapsed`); until then the canvas remounting keeps it here. Apart from `TitleBlock.tsx`, so
 * the test harness can forget it without loading the chrome's styles.
 */
export type TitleBlockChoice = { collapsed: boolean; over: boolean };

let remembered: TitleBlockChoice | null = null;

export function rememberedTitleBlockChoice(): TitleBlockChoice | null {
  return remembered;
}

export function rememberTitleBlockChoice(choice: TitleBlockChoice | null): void {
  remembered = choice;
}

/** @internal Tests: forget the expand or collapse the last title block remembered. */
export function resetTitleBlockCollapse(): void {
  remembered = null;
}
