import { useId, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { runCommand, subscribeCommands } from "@/contracts";
import { platform } from "@/ui/shared/platform";
import { commandHistory, remember, submitLine } from "./command-line";
import styles from "./CommandLine.module.css";
import { verbWords } from "./definitions";
import { completion } from "./suggest";

export const COMMAND_LABEL = "Command line";
export const COMMAND_PLACEHOLDER = "place governor · route erc20 · tidy · help";

/**
 * The console's command line (IR L137): a "›" prompt; ↑ ↓ walk the history; Tab accepts the suggestion shown
 * after the caret, and otherwise moves focus as usual; Enter echoes the line and runs it. On macOS, Ctrl L clears
 * the log from here too, as in DevTools (IR L35).
 */
export function CommandLine() {
  const [value, setValue] = useState("");
  /** Where ↑ ↓ are in the history; null while editing a fresh line. */
  const [recall, setRecall] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const verbs = useSyncExternalStore(subscribeCommands, verbWords);
  const hintId = useId();
  const suggestion = recall === null ? completion(value, verbs) : null;

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const history = commandHistory();
    if (event.key === "Enter") {
      event.preventDefault();
      remember(value);
      setValue("");
      setRecall(null);
      setDraft("");
      void submitLine(value);
      return;
    }
    if (event.key === "ArrowUp" && history.length) {
      event.preventDefault();
      if (recall === null) setDraft(value);
      const at = recall === null ? history.length - 1 : Math.max(0, recall - 1);
      setRecall(at);
      setValue(history[at] ?? "");
      return;
    }
    if (event.key === "ArrowDown" && recall !== null) {
      event.preventDefault();
      const at = recall + 1;
      if (at >= history.length) {
        setRecall(null);
        setValue(draft);
      } else {
        setRecall(at);
        setValue(history[at] ?? "");
      }
      return;
    }
    if (event.key === "Tab" && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey && suggestion) {
      event.preventDefault();
      setValue(/\s/.test(suggestion) ? suggestion : `${suggestion} `);
      return;
    }
    // Esc clears a typed line, else does what Esc does elsewhere (IR L15); the dispatcher leaves text fields alone.
    if (event.key === "Escape" && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      event.stopPropagation();
      if (value !== "") {
        setValue("");
        setRecall(null);
      } else {
        void runCommand({ id: "ui.escape" }, "keys");
      }
      return;
    }
    if (event.key.toLowerCase() === "l" && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && platform() === "mac") {
      event.preventDefault();
      void runCommand({ id: "console.clear" }, "keys");
    }
  };

  return (
    <div className={styles.line}>
      <span className={styles.prompt} aria-hidden="true">
        ›
      </span>
      <div className={styles.field}>
        {suggestion ? (
          <span className={styles.ghost} aria-hidden="true">
            <span className={styles.typed}>{value}</span>
            {suggestion.slice(value.length)}
          </span>
        ) : null}
        <input
          className={styles.input}
          type="text"
          aria-label={COMMAND_LABEL}
          aria-describedby={hintId}
          data-keyctx="text"
          placeholder={COMMAND_PLACEHOLDER}
          value={value}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(event) => {
            setValue(event.currentTarget.value);
            setRecall(null);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      <span id={hintId} className={styles.hint}>
        {suggestion ? `Tab: ${suggestion}` : ""}
      </span>
    </div>
  );
}
