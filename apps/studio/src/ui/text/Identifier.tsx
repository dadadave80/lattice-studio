import { Fragment, type ReactNode } from "react";
import { cx } from "../shared/cx";
import { isHexValue, splitIdentifier } from "./identifier-parts";
import styles from "./Identifier.module.css";

/** An identifier's text with a `<wbr>` after each ".", "/", "(", "," and "_", so it wraps between tokens. */
export function breakIdentifier(text: string): ReactNode {
  const parts = splitIdentifier(text);
  if (parts.length < 2) return text;
  return parts.map((part, index) => (
    <Fragment key={index}>
      {part}
      {index < parts.length - 1 ? <wbr /> : null}
    </Fragment>
  ));
}

/** The class for a text run: hex may break anywhere, an identifier only at its `<wbr>` points. */
export function identifierClass(text: string): string | undefined {
  return isHexValue(text) ? styles.hex : styles.identifier;
}

export type IdentifierProps = {
  text: string;
  className?: string | undefined;
  /** Rendered as this element; a `<span>` by default. */
  as?: "span" | "code";
};

/**
 * A namespace, path, signature or hex value set so it never breaks mid-token: `lattice.storage.` /
 * `GovernedVault`, not `lattice.storage.Governe` / `dVault`. Hex keeps breaking anywhere.
 */
export function Identifier({ text, className, as: Tag = "span" }: IdentifierProps) {
  return <Tag className={cx(identifierClass(text), className)}>{breakIdentifier(text)}</Tag>;
}
