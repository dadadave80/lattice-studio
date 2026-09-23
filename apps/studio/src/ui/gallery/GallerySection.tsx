import { useId, type ReactNode } from "react";
import styles from "./Gallery.module.css";

/** One primitive family in the `#/__ui` gallery: a heading and its specimens. */
export function GallerySection({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className={styles.section} aria-labelledby={id} data-gallery-section={title}>
      <h2 id={id} className={styles.sectionTitle}>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** One state of a primitive: a small-caps label ("Disabled with a reason") over the rendered control(s). */
export function Specimen({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.specimen} data-specimen={label}>
      <span className={styles.specimenLabel}>{label}</span>
      <div className={styles.row}>{children}</div>
    </div>
  );
}
