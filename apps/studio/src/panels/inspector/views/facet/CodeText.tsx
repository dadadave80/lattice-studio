import { Fragment } from "react";
import styles from "./facet.module.css";
import { breakIdentifier } from "@/ui/text/Identifier";

/** Renders text whose backticked spans are code ("`sendMessage(bytes,bytes,bytes[])` 0xcdfe7f5c is …"). */
export function CodeText({ text }: { text: string }) {
  const parts = text.split("`");
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <code key={index} className={styles.code}>
            {breakIdentifier(part)}
          </code>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}
