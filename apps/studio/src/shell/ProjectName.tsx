import { useRef, useState, type KeyboardEvent } from "react";
import { commandRef, KEY_CONTEXT_ATTRIBUTE, runCommand, useCommandState, useDocument } from "@/contracts";
import { Button, cx } from "@/ui";
import styles from "./TitleBar.module.css";

/**
 * The project name, renamed in place (IR L65): click or Enter to edit; Enter commits, Esc reverts, and
 * leaving the field commits. The rename runs `project.rename`, which says what it did or why not ("A project
 * needs a name."). While the session is read-only the name says why it can't be renamed.
 */
export function ProjectName() {
  const name = useDocument((s) => s.project.name);
  const rename = useCommandState(commandRef("project.rename", { name }));
  const [draft, setDraft] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  /** Set once Enter or Esc has settled the edit, so the blur that follows doesn't commit again. */
  const settled = useRef(false);

  const start = () => {
    settled.current = false;
    setDraft(name);
  };

  const finish = (commit: boolean, refocus: boolean) => {
    if (settled.current) return;
    settled.current = true;
    const value = draft ?? name;
    setDraft(null);
    if (commit && value !== name) void runCommand(commandRef("project.rename", { name: value }), "button");
    if (refocus) requestAnimationFrame(() => button.current?.focus());
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true, true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      finish(false, true);
    }
  };

  if (draft !== null) {
    return (
      <input
        className={styles.nameInput}
        aria-label="Project name"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => finish(true, false)}
        onFocus={(event) => event.currentTarget.select()}
        spellCheck={false}
        autoComplete="off"
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- the field replaces the button that was just activated
        autoFocus
        {...{ [KEY_CONTEXT_ATTRIBUTE]: "text" }}
      />
    );
  }

  return (
    <Button
      ref={button}
      variant="quiet"
      className={cx(styles.name)}
      tooltip="Rename project"
      disabledReason={rename.ok ? null : rename.reason}
      onClick={start}
    >
      <span className={styles.nameText}>{name}</span>
    </Button>
  );
}
