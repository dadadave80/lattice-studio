/** Copy with `backticked` code spans, as core writes its messages, with the spans set in code type. */
export function CodeText({ text, codeClassName }: { text: string; codeClassName: string }) {
  const parts = text.split("`");
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <code key={i} className={codeClassName}>
            {part}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}
