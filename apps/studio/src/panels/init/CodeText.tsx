import styles from "./InitEditor.module.css";

/** Copy with `backticked` code spans, as core writes them ("holders of `DEFAULT_ADMIN_ROLE` cut at once"). */
export function CodeText({ text }: { text: string }) {
  const parts = text.split("`");
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <code key={i} className={styles.code}>
            {part}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}
