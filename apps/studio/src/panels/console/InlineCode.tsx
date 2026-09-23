import type { ReactNode } from "react";
import styles from "./LogView.module.css";

/** A console line's text with its `code` spans (selectors, signatures) set in code style. Text only, never HTML. */
export function InlineCode({ text }: { text: string }) {
  const parts = text.split("`");
  // An odd count of backticks leaves the last one literal.
  const balanced = parts.length % 2 === 1;
  const out: ReactNode[] = [];
  parts.forEach((part, i) => {
    const code = i % 2 === 1 && (balanced || i < parts.length - 1);
    if (code) out.push(<code key={i} className={styles.code}>{part}</code>);
    else out.push(i % 2 === 1 ? `\`${part}` : part);
  });
  return <>{out}</>;
}
