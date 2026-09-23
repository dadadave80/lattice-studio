import { useRef, type ReactNode } from "react";
import { useInspectorFocus } from "../focus-request";
import styles from "./sheet.module.css";

export type ViewHeaderProps = {
  /** The facet, the diamond's name, "3 facets selected". */
  title: ReactNode;
  /** The small-caps kind on the right: "Facet", "Assembly", "Problem". */
  kind: string;
};

/**
 * A view's title row. The heading takes focus when a command routes the inspector here (inspector.show and
 * friends), so keyboard and screen-reader users land on what changed.
 */
export function ViewHeader({ title, kind }: ViewHeaderProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useInspectorFocus({ kind: "heading" }, heading);
  return (
    <header className={styles.header}>
      <h2 ref={heading} tabIndex={-1} className={styles.title} data-inspector-heading="">
        {title}
      </h2>
      <span className={styles.eyebrow}>{kind}</span>
    </header>
  );
}
