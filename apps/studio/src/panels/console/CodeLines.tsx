import { useDeferredValue, useEffect, useSyncExternalStore, type CSSProperties } from "react";
import { VisuallyHidden } from "@/ui/shared/VisuallyHidden";
import { cx } from "@/ui/shared/cx";
import { highlighter, loadHighlighter, subscribeHighlighter, type CodeLang } from "./highlight";
import styles from "./CodeView.module.css";

export type CodeLinesProps = {
  text: string;
  lang: CodeLang;
  /** The file's name (the tab panel around the code is named by its tab). */
  label: string;
  /** 0-based indexes of lines to mark as changed. */
  changed: ReadonlySet<number>;
  /** The code is kept for reference while it can't be exported (blockers): shown muted. */
  stale?: boolean;
};

/**
 * Code with line numbers and change marks. Plain text first; Shiki's tokens replace it once Shiki has loaded
 * (spec L699), rendered as React elements whose colors come from the token themes by `data-theme` (spec L863).
 */
export function CodeLines({ text, lang, label, changed, stale = false }: CodeLinesProps) {
  const ready = useSyncExternalStore(subscribeHighlighter, highlighter);
  // Tokenizing waits for a quiet moment, so typing elsewhere stays responsive while the tab is open.
  const deferred = useDeferredValue(text);

  useEffect(() => {
    loadHighlighter().catch(() => {
      // Plain text stays readable; the next open tries again.
    });
  }, []);

  const tokens = ready ? ready.tokenize(deferred, lang) : null;
  const current = deferred === text ? tokens : null;
  const lines = text.split("\n");

  return (
    <pre className={cx(styles.code, stale && styles.stale)} data-file={label} data-highlighted={current ? "" : undefined}>
      <code className={styles.lines}>
        {lines.map((line, i) => {
          const row = current?.[i];
          return (
          <span key={i} className={cx(styles.row, changed.has(i) && styles.changed)} data-changed={changed.has(i) ? "" : undefined}>
            <span className={styles.gutter} aria-hidden="true">
              {i + 1}
            </span>
            <span className={styles.mark}>
              {changed.has(i) ? (
                <>
                  <span aria-hidden="true">+</span>
                  <VisuallyHidden>changed: </VisuallyHidden>
                </>
              ) : null}
            </span>
            <span className={styles.source}>
              {row
                ? row.map((token, j) => (
                    <span key={j} className={styles.token} style={token.style as CSSProperties}>
                      {token.content}
                    </span>
                  ))
                : line || " "}
            </span>
          </span>
          );
        })}
      </code>
    </pre>
  );
}
