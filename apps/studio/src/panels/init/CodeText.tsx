import styles from "./InitEditor.module.css";
import { breakIdentifier } from "@/ui/text/Identifier";

/** Copy with `backticked` code spans, as core writes them ("holders of `DEFAULT_ADMIN_ROLE` cut at once"). */
export function CodeText({ text }: { text: string }) {
  const parts = text.split("`");
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <code key={i} className={styles.code}>
            {breakIdentifier(part)}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}
