import { useRef } from "react";
import { runCommand, settings, useSettings } from "@/contracts";
import { IconButton } from "@/ui/buttons/IconButton";
import { ToggleButton } from "@/ui/fields/ToggleButton";
import { Menu } from "@/ui/overlays/Menu";
import { MenuCheckboxItem } from "@/ui/overlays/MenuCheckboxItem";
import { MenuItem } from "@/ui/overlays/MenuItem";
import { showingText } from "./filter";
import { LOG_TAGS, type LogTag } from "./log-store";
import styles from "./LogView.module.css";
import { useRovingFocus } from "./roving";

export type LogToolbarProps = {
  tags: ReadonlySet<LogTag>;
  onTagsChange: (tags: ReadonlySet<LogTag>) => void;
  query: string;
  onQueryChange: (query: string) => void;
  /** "Showing x of y" while a filter is on; null otherwise. */
  showing: { shown: number; total: number } | null;
  /** Why Copy line can't run now, or null. */
  copyLineReason: string | null;
  onCopyLine: () => void;
  onCopyAll: () => void;
  copyAllReason: string | null;
};

export const FILTER_LABEL = "Filter the log";
export const FILTER_HINT = "Text, -exclude or /regex/";
export const KEEP_LOG = "Keep log across reloads";
export const TAGS_LABEL = "Show only these tags";
export const ACTIONS_LABEL = "Log actions";

/**
 * The Log's controls (IR L134): tag chips, the text filter and its count, Clear, Copy line, and the Log menu.
 * The chips and the actions are one Tab stop each (← → Home End within), so the command line is a few Tab
 * presses from the console's header rather than twenty.
 */
export function LogToolbar(props: LogToolbarProps) {
  const { tags, onTagsChange, query, onQueryChange, showing } = props;
  const keepLog = useSettings((s) => s.keepLog);
  const chipsRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const chips = useRovingFocus(chipsRef);
  const actions = useRovingFocus(actionsRef);
  const toggle = (tag: LogTag, pressed: boolean) => {
    const next = new Set(tags);
    if (pressed) next.add(tag);
    else next.delete(tag);
    onTagsChange(next);
  };
  return (
    <div className={styles.toolbar}>
      <div
        ref={chipsRef}
        role="toolbar"
        tabIndex={-1}
        aria-label={TAGS_LABEL}
        className={styles.chips}
        onKeyDown={chips.onKeyDown}
        onFocus={chips.onFocus}
      >
        {LOG_TAGS.map((tag) => (
          <ToggleButton
            key={tag}
            size="small"
            pressed={tags.has(tag)}
            onPressedChange={(pressed) => toggle(tag, pressed)}
            className={styles.chip}
          >
            {tag}
          </ToggleButton>
        ))}
      </div>
      <input
        type="search"
        className={styles.filter}
        aria-label={FILTER_LABEL}
        placeholder={FILTER_HINT}
        value={query}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => onQueryChange(event.currentTarget.value)}
      />
      {showing ? (
        <output className={styles.showing}>{showingText(showing.shown, showing.total)}</output>
      ) : null}
      <span className={styles.spacer} />
      <div
        ref={actionsRef}
        role="toolbar"
        tabIndex={-1}
        aria-label={ACTIONS_LABEL}
        className={styles.actions}
        onKeyDown={actions.onKeyDown}
        onFocus={actions.onFocus}
      >
        <IconButton icon="trash" label="Clear the log" size="small" onClick={() => void runCommand({ id: "console.clear" }, "button")} />
        <IconButton icon="copy" label="Copy line" size="small" disabledReason={props.copyLineReason} onClick={props.onCopyLine} />
        <Menu label="Log menu" align="end" trigger={<IconButton icon="more" label="Log menu" size="small" />}>
          <MenuItem label="Copy all" disabledReason={props.copyAllReason} onSelect={props.onCopyAll} />
          <MenuCheckboxItem label={KEEP_LOG} checked={keepLog} onCheckedChange={(checked) => settings.set({ keepLog: checked })} />
        </Menu>
      </div>
    </div>
  );
}
