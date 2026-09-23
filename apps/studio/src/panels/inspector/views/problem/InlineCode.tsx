import type { ReactNode } from "react";

/**
 * Text whose `backticked` spans are code: problem messages and `formatSelector` output mark signatures and
 * namespaces that way ("`transfer(address,uint256)` 0xa9059cbb"). Only text nodes and `<code>`, never HTML.
 */
export function InlineCode({ text, codeClassName }: { text: string; codeClassName?: string | undefined }) {
  const nodes: ReactNode[] = [];
  const parts = text.split("`");
  // An unmatched backtick leaves an odd tail: show it as written rather than code to the end.
  const closed = parts.length % 2 === 1;
  parts.forEach((part, index) => {
    if (part === "") return;
    const isCode = index % 2 === 1 && (closed || index < parts.length - 1);
    if (isCode) {
      nodes.push(
        <code key={index} className={codeClassName}>
          {part}
        </code>,
      );
    } else {
      nodes.push(index % 2 === 1 ? `\`${part}` : part);
    }
  });
  return <>{nodes}</>;
}
