import type { Anchor } from "@lattice-studio/core";
import { formatSelector } from "@lattice-studio/core";
import { commandRef } from "@/contracts";
import { CommandButton, VisuallyHidden } from "@/ui";
import sheet from "../../shared/sheet.module.css";
import type { SignatureOf } from "../comparison/comparison-text";
import { InlineCode } from "./InlineCode";
import styles from "./ProblemView.module.css";
import { breakIdentifier } from "@/ui/text/Identifier";

export type AnchorItemProps = {
  anchor: Anchor;
  signatureOf: SignatureOf;
  /** "Sepolia", or "Chain 11155111" when the chain module doesn't know it (or isn't loaded). */
  chainName(chainId: number): string;
};

/** One place a problem points at, in words, with a way to get there: Locate on the sheet, Fill in a field. */
export function AnchorItem({ anchor, signatureOf, chainName }: AnchorItemProps) {
  switch (anchor.kind) {
    case "diamond":
      return (
        <li className={styles.anchor}>
          <span className={sheet.text}>The diamond</span>
        </li>
      );
    case "facet":
      return (
        <li className={styles.anchor}>
          <span className={`${sheet.text} ${sheet.strong}`}>{anchor.facet}</span>
          <CommandButton size="small" icon="locate" command={commandRef("sheet.locate", { facet: anchor.facet })}>
            Locate<VisuallyHidden> {anchor.facet}</VisuallyHidden>
          </CommandButton>
        </li>
      );
    case "selector": {
      const signature = signatureOf(anchor.selector);
      const named = signature === undefined ? anchor.selector : formatSelector({ hex: anchor.selector, signature });
      return (
        <li className={styles.anchor}>
          <span className={sheet.text}>
            <InlineCode text={named} codeClassName={sheet.mono} />
            {anchor.facet === undefined ? null : (
              <>
                {" on "}
                <span className={sheet.strong}>{anchor.facet}</span>
              </>
            )}
          </span>
          {anchor.facet === undefined ? null : (
            <CommandButton
              size="small"
              icon="locate"
              command={commandRef("sheet.locate", { facet: anchor.facet, selector: anchor.selector })}
            >
              Locate<VisuallyHidden> {anchor.facet}</VisuallyHidden>
            </CommandButton>
          )}
        </li>
      );
    }
    case "init":
      return (
        <li className={styles.anchor}>
          <code className={sheet.mono}>{breakIdentifier(anchor.path)}</code>
          <CommandButton size="small" command={commandRef("init.focusField", { path: anchor.path })}>
            Fill in<VisuallyHidden> {anchor.path}</VisuallyHidden>
          </CommandButton>
        </li>
      );
    case "chain":
      return (
        <li className={styles.anchor}>
          <span className={sheet.text}>{chainName(anchor.chainId)}</span>
        </li>
      );
  }
}
